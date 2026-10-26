package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Config struct {
	Transport string            `json:"transport"`
	Mode      string            `json:"mode"`
	URL       string            `json:"url"`
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	Headers   map[string]string `json:"headers"`
	Cwd       string            `json:"cwd"`
}
type Params struct {
	ConnectionID  string         `json:"connectionId"`
	Config        Config         `json:"config"`
	Name          string         `json:"name"`
	Arguments     map[string]any `json:"arguments"`
	Operation     Operation      `json:"operation"`
	ProgressToken string         `json:"progressToken"`
}
type Entry struct {
	Session       *mcp.ClientSession
	cancelSession context.CancelFunc
	Process       *exec.Cmd
	Fingerprint   string
	LastError     string
}
type Manager struct {
	mu        sync.Mutex
	entries   map[string]*Entry
	ctx       context.Context
	stderr    io.Writer
	transport http.RoundTripper
	notifyMu  sync.RWMutex
	notify    func(Notification)
}

func New(ctx context.Context, stderr io.Writer, transport http.RoundTripper) *Manager {
	return &Manager{entries: make(map[string]*Entry), ctx: ctx, stderr: stderr, transport: transport}
}
func (m *Manager) Execute(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	var p Params
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.ConnectionID == "" {
		return nil, fmt.Errorf("connectionId is required")
	}
	if method == "close" {
		return map[string]bool{"closed": true}, m.Close(p.ConnectionID)
	}
	session, err := m.connect(ctx, p)
	if err != nil {
		return nil, err
	}
	switch method {
	case "catalog":
		return discoverCatalog(ctx, session)
	case "mcp.request":
		return requestOperation(ctx, session, p)
	case "discover":
		result, err := collect(session.Tools(ctx, nil))
		return &mcp.ListToolsResult{Tools: result}, err
	case "call":
		params := &mcp.CallToolParams{Name: p.Name, Arguments: p.Arguments}
		if p.ProgressToken != "" {
			params.SetProgressToken(p.ProgressToken)
		}
		result, err := session.CallTool(ctx, params)
		if err != nil {
			m.recordError(p.ConnectionID, err)
			return nil, &DeliveryError{Cause: err}
		}
		return result, err
	default:
		return nil, fmt.Errorf("unknown MCP method: %s", method)
	}
}
func (m *Manager) recordError(id string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e := m.entries[id]; e != nil {
		e.LastError = err.Error()
	}
}
func (m *Manager) connect(ctx context.Context, p Params) (*mcp.ClientSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	encoded, err := json.Marshal(p.Config)
	if err != nil {
		return nil, err
	}
	e := m.entries[p.ConnectionID]
	if e != nil && e.Fingerprint != string(encoded) {
		if err := closeEntry(e); err != nil {
			return nil, err
		}
		delete(m.entries, p.ConnectionID)
		e = nil
	}
	if e == nil {
		e = &Entry{Fingerprint: string(encoded)}
		m.entries[p.ConnectionID] = e
	}
	if e.Session != nil {
		return e.Session, nil
	}
	transport, err := m.makeTransport(p.Config, e)
	if err != nil {
		e.LastError = err.Error()
		return nil, err
	}
	e.Session, e.cancelSession, err = m.openSessionFor(ctx, transport, p.ConnectionID)
	if err != nil {
		e.LastError = err.Error()
		return nil, err
	}
	e.LastError = ""
	return e.Session, nil
}
func (m *Manager) openSessionFor(ctx context.Context, transport mcp.Transport, connectionID string) (*mcp.ClientSession, context.CancelFunc, error) {
	// The SSE GET must outlive discovery, while request cancellation still interrupts initialization.
	sessionCtx, cancel := context.WithCancel(m.ctx)
	stop := context.AfterFunc(ctx, cancel)
	client := mcp.NewClient(&mcp.Implementation{Name: "mcp-platform-connector", Version: "0.1.0"}, m.clientOptions(connectionID))
	session, err := client.Connect(sessionCtx, transport, nil)
	detached := stop()
	if err != nil {
		cancel()
		return nil, nil, err
	}
	if !detached {
		cancel()
		return nil, nil, errors.Join(ctx.Err(), session.Close())
	}
	return session, cancel, nil
}
func (m *Manager) command(c Config) *exec.Cmd {
	cmd := exec.CommandContext(m.ctx, c.Command, c.Args...)
	cmd.Dir = c.Cwd
	cmd.Stderr = m.stderr
	cmd.Env = os.Environ()
	for key, value := range c.Env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	return cmd
}
func (m *Manager) makeTransport(c Config, e *Entry) (mcp.Transport, error) {
	if c.Transport == "stdio" {
		if c.Mode != "managed" || c.Command == "" {
			return nil, fmt.Errorf("stdio requires managed command")
		}
		return &mcp.CommandTransport{Command: m.command(c)}, nil
	}
	if c.URL == "" {
		return nil, fmt.Errorf("HTTP MCP requires URL")
	}
	if c.Mode == "managed" && e.Process == nil {
		if c.Command == "" {
			return nil, fmt.Errorf("managed service requires command")
		}
		cmd := m.command(c)
		cmd.Stdout = m.stderr
		if err := cmd.Start(); err != nil {
			return nil, err
		}
		e.Process = cmd
	}
	client := &http.Client{Transport: headerTransport{base: m.transport, headers: c.Headers, endpoint: c.URL}, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	switch c.Transport {
	case "http":
		return &mcp.StreamableClientTransport{Endpoint: c.URL, HTTPClient: client, MaxRetries: -1}, nil
	case "sse":
		return &mcp.SSEClientTransport{Endpoint: c.URL, HTTPClient: client}, nil
	default:
		return nil, fmt.Errorf("unsupported transport: %s", c.Transport)
	}
}

type headerTransport struct {
	base     http.RoundTripper
	headers  map[string]string
	endpoint string
}

func (t headerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	endpoint, err := url.Parse(t.endpoint)
	if err != nil {
		return nil, err
	}
	if r.URL.Scheme != endpoint.Scheme || r.URL.Host != endpoint.Host {
		return nil, fmt.Errorf("MCP header credentials cannot cross origins")
	}
	copy := r.Clone(r.Context())
	for key, value := range t.headers {
		copy.Header.Set(key, value)
	}
	return t.base.RoundTrip(copy)
}
func closeEntry(e *Entry) error {
	if e.cancelSession != nil {
		defer e.cancelSession()
	}
	var errors []string
	if e.Session != nil {
		if err := e.Session.Close(); err != nil {
			errors = append(errors, err.Error())
		}
	}
	if e.Process != nil {
		if err := e.Process.Process.Kill(); err != nil && err != os.ErrProcessDone {
			errors = append(errors, err.Error())
		}
		_ = e.Process.Wait()
	}
	if len(errors) > 0 {
		return fmt.Errorf("%s", strings.Join(errors, "; "))
	}
	return nil
}
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	delete(m.entries, id)
	if e == nil {
		return nil
	}
	return closeEntry(e)
}
func (m *Manager) CloseAll() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var errors []string
	for id, e := range m.entries {
		if err := closeEntry(e); err != nil {
			errors = append(errors, err.Error())
		}
		delete(m.entries, id)
	}
	if len(errors) > 0 {
		return fmt.Errorf("%s", strings.Join(errors, "; "))
	}
	return nil
}
func (m *Manager) Status() []map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := []map[string]string{}
	for id, e := range m.entries {
		status := "connected"
		if e.Session == nil || e.LastError != "" {
			status = "error"
		}
		result = append(result, map[string]string{"id": id, "status": status, "error": e.LastError})
	}
	return result
}

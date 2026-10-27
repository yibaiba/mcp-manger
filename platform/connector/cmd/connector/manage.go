package main

import (
	"context"
	"fmt"
	"log"
	"mcplatform/connector/internal/agent"
	"mcplatform/connector/internal/config"
	"mcplatform/connector/internal/files"
	"mcplatform/connector/internal/local"
	"mcplatform/connector/internal/local/sources"
	"mcplatform/connector/internal/local/storage"
	"mcplatform/connector/internal/localhttp"
	"mcplatform/connector/internal/mcpclient"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type managementOptions struct {
	ConfigPath, DataDir string
	Client              *http.Client
	Offline             bool
}

func manage(ctx context.Context, options managementOptions) error {
	path, client, offline := options.ConfigPath, options.Client, options.Offline
	var cfg config.Config
	var err error
	if !offline {
		cfg, err = config.Load(path)
		if err != nil {
			return err
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dataDir := filepath.Join(home, ".mcplatform", "local")
	if cfg.LocalDataDir != "" {
		if !filepath.IsAbs(cfg.LocalDataDir) {
			return fmt.Errorf("localDataDir must be absolute")
		}
		dataDir = cfg.LocalDataDir
	}
	if options.DataDir != "" {
		if !filepath.IsAbs(options.DataDir) {
			return fmt.Errorf("data-dir must be absolute")
		}
		dataDir = options.DataDir
	}
	store := storage.Store{Dir: dataDir}
	lease, err := store.Acquire()
	if err != nil {
		return err
	}
	defer lease.Close()
	manager := mcpclient.New(ctx, os.Stderr, http.DefaultTransport)
	defer func() {
		if err := manager.CloseAll(); err != nil {
			log.Printf("MCP shutdown: %v", err)
		}
	}()
	localRuntime := mcpclient.New(ctx, os.Stderr, http.DefaultTransport)
	defer func() {
		if err := localRuntime.CloseAll(); err != nil {
			log.Printf("Local MCP shutdown: %v", err)
		}
	}()
	syncTarget := ""
	if !offline {
		syncTarget = sources.ID(cfg.Server, cfg.DeviceID)
	}
	localManager, err := local.New(ctx, local.Options{SyncTarget: syncTarget, Store: store, Locations: sources.Locations{Home: home, CodexHome: os.Getenv("CODEX_HOME"), PiHome: os.Getenv("PI_CODING_AGENT_DIR"), ConfigHome: os.Getenv("XDG_CONFIG_HOME")}, Runtime: localRuntime, Changed: manager.InvalidateResource, Error: func(err error) { log.Printf("Local management: %v", err) }})
	if err != nil {
		return err
	}
	server, err := localhttp.Start(localManager)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "本机管理（一次性链接）：%s\n", server.OpenURL())
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- server.Serve(); cancel() }()
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Close(closeCtx); err != nil {
			log.Printf("Local HTTP shutdown: %v", err)
		}
	}()
	go localManager.Watch(runCtx)
	if offline {
		select {
		case <-ctx.Done():
			return nil
		case err := <-done:
			return err
		}
	}
	handler := &agent.Dispatch{MCP: manager, Local: localManager, Skills: &files.SkillInstaller{Roots: cfg.SkillRoots}, Artifacts: &files.ArtifactTransfer{Roots: cfg.ArtifactRoots, Client: client, Server: cfg.Server}}
	runner := agent.Runner{Config: cfg, Handler: handler, Client: client, Logger: log.New(os.Stderr, "connector ", log.LstdFlags)}
	return runner.Run(runCtx)
}

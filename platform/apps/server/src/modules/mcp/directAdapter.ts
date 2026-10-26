import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppError, errorMessage } from '../../shared/errors.js';
import { CALL_TIMEOUT_MS, type ConnectionInput } from '@platform/contracts';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ConnectionAdapter, ConnectionContext } from './adapter.js';
import { observeStdioStderr } from './stdioDiagnostics.js';
import { redactConnectionText } from './connectionDiagnostics.js';
import { awaitConnection } from './awaitConnection.js';

type DirectEffects = { logStderr: (message: string) => void };
type DirectSession = ReturnType<typeof createSession>;

function createTransport(config: ConnectionInput, authProvider: OAuthClientProvider) {
  if (config.transport === 'stdio')
    return new StdioClientTransport({
      command: config.command!,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      stderr: 'pipe',
    });
  const options = { requestInit: { headers: config.headers }, authProvider };
  if (config.transport === 'sse') return new SSEClientTransport(new URL(config.url!), options);
  return new StreamableHTTPClientTransport(new URL(config.url!), options);
}

function createSession(input: {
  context: ConnectionContext;
  authProvider: OAuthClientProvider;
  effects: DirectEffects;
  signal: AbortSignal;
  onClose: () => void;
}) {
  const { config } = input.context;
  const client = new Client({ name: 'mcp-platform', version: '0.1.0' });
  const transport = createTransport(config, input.authProvider);
  const diagnose =
    transport instanceof StdioClientTransport && transport.stderr
      ? observeStdioStderr(transport.stderr, {
          redact: (message) => redactConnectionText(message, config),
          log: input.effects.logStderr,
        })
      : (error: unknown) => error;
  let active = false;
  client.onclose = () => {
    active = false;
    input.onClose();
  };
  const ready = client
    .connect(transport, { timeout: CALL_TIMEOUT_MS, signal: input.signal })
    .then(() => {
      input.signal.throwIfAborted();
      active = true;
    })
    .catch((error: unknown) => {
      throw diagnose(error);
    });
  return { client, ready, diagnose, active: () => active };
}

export function createDirectAdapter(
  context: ConnectionContext,
  authProvider: OAuthClientProvider,
  effects: DirectEffects,
): ConnectionAdapter {
  const lifetime = new AbortController();
  let session: DirectSession | undefined;
  function acquire() {
    lifetime.signal.throwIfAborted();
    if (session) return session;
    const created = createSession({
      context,
      authProvider,
      effects,
      signal: lifetime.signal,
      onClose: () => {
        if (session === created) session = undefined;
      },
    });
    session = created;
    return created;
  }
  return {
    status: () => (session?.active() ? 'connected' : 'disconnected'),
    async discover(signal) {
      signal?.throwIfAborted();
      const current = acquire();
      await awaitConnection(current.ready, signal);
      signal?.throwIfAborted();
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await current.client.listTools(
          { cursor },
          { signal, timeout: CALL_TIMEOUT_MS },
        );
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
    async call(input) {
      input.signal?.throwIfAborted();
      const current = acquire();
      await awaitConnection(current.ready, input.signal);
      input.signal?.throwIfAborted();
      try {
        return CallToolResultSchema.parse(
          await current.client.callTool(
            { name: input.name, arguments: input.arguments },
            CallToolResultSchema,
            { signal: input.signal, timeout: CALL_TIMEOUT_MS },
          ),
        );
      } catch (error) {
        throw new AppError(
          'RESULT_UNKNOWN',
          `上游请求发出后失败，执行结果需确认：${errorMessage(current.diagnose(error))}`,
          502,
        );
      }
    },
    async close() {
      lifetime.abort(new Error('连接已关闭'));
      const current = session;
      session = undefined;
      await current?.client.close();
    },
  };
}

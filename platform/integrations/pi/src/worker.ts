import {
  discoverCatalog,
  executeOperation,
  executeTool,
  observeNotifications,
  type Client,
  type McpCatalog,
  type McpOperation,
} from '@platform/mcp';
import { randomUUID } from 'node:crypto';
import type { Context } from './runtime.js';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
  type ExtensionContext,
  type AgentToolResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
const adapterPackage: string = 'pi-mcp-adapter';
const { createMcpAdapter, getMcpClient } = (await import(adapterPackage)) as {
  getMcpClient(options: { pi: ExtensionAPI; name: string }): Client;
  createMcpAdapter(options: { config: Record<string, unknown> }): ExtensionFactory;
};
let session: AgentSession | undefined;
let extension: ExtensionAPI;
let catalog: McpCatalog | undefined;
const observed = new WeakSet<Client>();
function client() {
  const current = getMcpClient({ pi: extension, name: server });
  if (!observed.has(current)) {
    observed.add(current);
    observeNotifications(current, (notification) =>
      process.send?.({ type: 'notification', notification }),
    );
  }
  return current;
}
let server = '';
let serverUrl = '';
const active = new Map<string, AbortController>();
async function proxy(params: Record<string, unknown>, signal?: AbortSignal) {
  if (!session) throw new Error('Pi bridge is not initialized');
  const tool = session.getToolDefinition('mcp');
  if (!tool) throw new Error('Pi MCP proxy tool was not registered');
  // The adapter proxy accepts ExtensionContext for non-model programmatic calls.
  // The agent's model-bound wrapper requires an assistant tool-call message.
  const execute = tool.execute as (
    id: string,
    args: unknown,
    signal: AbortSignal | undefined,
    update: undefined,
    context: ExtensionContext,
  ) => Promise<AgentToolResult<Record<string, unknown>>>;
  const result = await execute(
    randomUUID(),
    params,
    signal,
    undefined,
    session.extensionRunner.createContext(),
  );
  const details = result.details as Record<string, unknown> | undefined;
  if (details?.error && details.error !== 'tool_error')
    throw new Error(
      `${details.error}: ${result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')}`,
    );
  return { content: result.content, details };
}
async function dispatch(
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  requestId: string,
) {
  if (method === 'initialize') {
    const context = params as Context;
    server = `u_${context.ownerId}_c_${context.id}`;
    serverUrl = context.config.url ?? '';
    const directory = process.env.PI_CODING_AGENT_DIR!;
    const settings = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: settings,
      noExtensions: true,
      disabledBuiltinExtensions: ['mcp'],
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
      extensionFactories: [
        (pi) => {
          extension = pi;
          return createMcpAdapter({
            config: {
              mcpServers: {
                [server]: {
                  ...(context.config.transport === 'stdio'
                    ? {
                        command: context.config.command,
                        args: context.config.args,
                        env: context.config.env,
                        literalEnv: true,
                        cwd: context.config.cwd ?? process.cwd(),
                        debug: true,
                      }
                    : {
                        url: context.config.url,
                        httpTransport:
                          context.config.transport === 'sse' ? 'sse' : 'streamable-http',
                        headers: context.config.headers,
                        oauth: context.config.oauth,
                      }),
                  lifecycle: 'lazy',
                  protocolVersion: context.config.transport === 'sse' ? 'legacy' : 'auto',
                },
              },
              settings: {
                oauthCredentialStore: 'encrypted-file',
                autoAuth: false,
                outputGuard: false,
              },
            },
          })(pi);
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      resourceLoader: loader,
      settingsManager: settings,
      sessionManager: SessionManager.inMemory(),
      noTools: 'builtin',
    }));
    await session.bindExtensions({});
    return { ready: true };
  }
  if (!session) throw new Error('Pi bridge is not initialized');
  if (method === 'close') {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
    session = undefined;
    return { closed: true };
  }
  const onprogress = params.progress
    ? (progress: unknown) => process.send?.({ type: 'progress', id: requestId, progress })
    : undefined;
  if (method === 'catalog' || method === 'discover') {
    await proxy({ connect: server }, signal);
    catalog = await discoverCatalog(client(), signal);
    return method === 'discover' ? catalog.tools : catalog;
  }
  if (method === 'request')
    return executeOperation(client(), params.operation as McpOperation, { signal, onprogress });
  if (method === 'call') {
    const tool = catalog?.tools.find((tool) => tool.name === params.name);
    if (!tool) throw new Error('Pi tool has not been discovered');
    return executeTool(client(), {
      tool,
      arguments: params.arguments as Record<string, unknown>,
      signal,
      onprogress,
    });
  }
  if (method === 'action') {
    if (params.action === 'status') return proxy({ server }, signal);
    if (params.action === 'logout') {
      await session.prompt(`/mcp-adapter logout ${server}`);
      const oauthModule: string = 'pi-mcp-adapter/oauth';
      const oauth = (await import(oauthModule)) as {
        inspectMcpOAuthTokensForUrl: (
          name: string,
          url: string,
          options: { credentialStore: string },
        ) => { status: string; message?: string };
      };
      const status = oauth.inspectMcpOAuthTokensForUrl(server, serverUrl, {
        credentialStore: 'encrypted-file',
      });
      if (status.status !== 'absent')
        throw new Error(status.message ?? 'Pi OAuth tokens still exist after logout');
      return { tokensRemoved: true, upstreamRevocation: '请在供应商账户中撤销授权' };
    }
    return proxy({ ...params, server }, signal);
  }
  throw new Error(`Unsupported Pi bridge operation: ${method}`);
}
process.on(
  'message',
  (message: { type: string; id: string; method: string; params: Record<string, unknown> }) => {
    if (message.type === 'cancel') {
      active.get(message.id)?.abort();
      return;
    }
    const abort = new AbortController();
    active.set(message.id, abort);
    void dispatch(message.method, message.params, abort.signal, message.id)
      .then(
        (result) => process.send?.({ id: message.id, result }),
        (error: unknown) =>
          process.send?.({
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => active.delete(message.id));
  },
);
process.on('disconnect', () => {
  for (const abort of active.values()) abort.abort();
  session?.dispose();
  process.exit(0);
});

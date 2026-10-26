import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  ModelRuntime,
  loadSkillsFromDir,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type Result = { content: { type: string; [key: string]: unknown }[]; [key: string]: unknown };
export type Context = {
  id: string;
  ownerId: string;
  config: {
    transport?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers: Record<string, string>;
    oauth?: { clientId?: string; clientSecret?: string; scope?: string };
  };
};
export async function bridge(options: { context: Context; directory: string }) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const worker = fork(new URL('./worker.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, PI_CODING_AGENT_DIR: options.directory },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let connected = false;
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  worker.on('message', (message: { id: string; result?: unknown; error?: string }) => {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
  });
  worker.on('error', (error) => {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  });
  worker.on('exit', (code) => {
    connected = false;
    for (const call of pending.values())
      call.reject(new Error(`Pi bridge exited (${code}); in-flight result unknown`));
    pending.clear();
  });
  function request(method: string, params: unknown, inputSignal?: AbortSignal) {
    const deadline = AbortSignal.timeout(60_000);
    const signal = inputSignal ? AbortSignal.any([inputSignal, deadline]) : deadline;
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Pi call cancelled before dispatch'));
        return;
      }
      const abort = () => {
        if (worker.connected) worker.send({ type: 'cancel', id });
        pending.delete(id);
        cleanup();
        reject(new Error('Pi call interrupted; execution result unknown'));
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      worker.send({ type: 'request', id, method, params }, (error) => {
        if (error) {
          pending.delete(id);
          cleanup();
          reject(error);
        }
      });
    });
  }
  try {
    await request('initialize', options.context);
  } catch (error) {
    worker.kill();
    throw error;
  }
  return {
    status: () => (connected ? ('connected' as const) : ('disconnected' as const)),
    discover: async (signal?: AbortSignal) => {
      const tools = await request('discover', {}, signal);
      connected = true;
      return tools;
    },
    call: (input: { name: string; arguments: Record<string, unknown>; signal?: AbortSignal }) =>
      request('call', { name: input.name, arguments: input.arguments }, input.signal),
    action: (input: Record<string, unknown>) => request('action', input),
    close: async () => {
      connected = false;
      if (!worker.connected) return;
      try {
        await request('close', {});
      } finally {
        worker.disconnect();
        worker.kill();
      }
    },
  };
}
type RunOptions = {
  directory: string;
  provider: string;
  model: string;
  prompt: string;
  tools: Tool[];
  skills: { name: string; files: Record<string, string> }[];
  call: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<Result>;
  signal: AbortSignal;
  onText: (text: string) => void;
};
export async function run(options: RunOptions) {
  const skillDirectory = join(options.directory, 'skills');
  await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
  for (const skill of options.skills)
    for (const [relative, encoded] of Object.entries(skill.files)) {
      const target = join(skillDirectory, skill.name, relative);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, Buffer.from(encoded, 'base64'), { mode: 0o600 });
    }
  const modelRuntime = await ModelRuntime.create({
    authPath: join(options.directory, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const model = modelRuntime.getModel(options.provider, options.model);
  if (!model) throw new Error(`Unknown model: ${options.provider}/${options.model}`);
  const settings = SettingsManager.inMemory({ retry: { enabled: false } });
  const skills = loadSkillsFromDir({ dir: skillDirectory, source: 'platform' });
  if (skills.diagnostics.length)
    throw new Error(skills.diagnostics.map((d) => d.message).join('; '));
  const loader = new DefaultResourceLoader({
    cwd: options.directory,
    agentDir: options.directory,
    settingsManager: settings,
    noExtensions: true,
    disabledBuiltinExtensions: ['mcp'],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: () => skills,
    appendSystemPrompt: options.skills.map(
      (skill) =>
        `Skill ${skill.name}:\n${Buffer.from(skill.files['SKILL.md']!, 'base64').toString()}`,
    ),
  });
  await loader.reload();
  const customTools: ToolDefinition[] = options.tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description ?? tool.name,
    parameters: tool.inputSchema as TSchema,
    async execute(_id, args, signal) {
      const result = await options.call(tool.name, args as Record<string, unknown>, signal);
      return {
        content: result.content.map((block) => ({
          type: 'text' as const,
          text: block.type === 'text' ? String(block.text) : JSON.stringify(block),
        })),
        details: { mcpResult: result },
      };
    },
  }));
  // The loader registers real Skills; source content is supplied without granting host filesystem tools.
  const { session } = await createAgentSession({
    cwd: options.directory,
    agentDir: options.directory,
    modelRuntime,
    model,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(),
    noTools: 'builtin',
    tools: customTools.map((t) => t.name),
    customTools,
  });
  const abort = () => {
    void session.abort();
  };
  options.signal.addEventListener('abort', abort, { once: true });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
      options.onText(event.assistantMessageEvent.delta);
  });
  try {
    options.signal.throwIfAborted();
    await session.prompt(options.prompt);
    const last = session.messages.at(-1);
    if (last?.role === 'assistant' && last.stopReason === 'error')
      throw new Error(last.errorMessage ?? 'Model execution failed');
    return session.getLastAssistantText() ?? '';
  } finally {
    unsubscribe();
    options.signal.removeEventListener('abort', abort);
    session.dispose();
  }
}

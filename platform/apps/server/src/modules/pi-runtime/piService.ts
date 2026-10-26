import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq, and, desc } from 'drizzle-orm';
import { tasks, type Database } from '@platform/db';
import { type Config } from '../../config.js';
import { AppError, requireValue, errorMessage } from '../../shared/errors.js';
import type { ConnectionAdapter, ConnectionContext } from '../mcp/adapter.js';
import type { ProfileService } from '../agent-profiles/profileService.js';
import type { InvocationService } from '../mcp/invocationService.js';
import type { SkillService } from '../skills/skillService.js';
import type { ContentService } from '../mcp/contentService.js';
import { contentToolset } from './contentTools.js';
import { parseCatalog, type McpRequestOptions, type McpOperation } from '@platform/mcp';
import { CallToolResultSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
export interface PiBridge extends ConnectionAdapter {
  action(input: Record<string, unknown>): Promise<unknown>;
}
export type PiRuntime = typeof import('@platform/pi-runtime');
export class PiService {
  private runtime?: Promise<PiRuntime>;
  private readonly bridges = new Map<string, Promise<PiBridge>>();
  private readonly running = new Map<
    string,
    { ownerId: string; profileId: string; abort: AbortController; done: Promise<void> }
  >();
  constructor(
    private readonly deps: {
      db: Database;
      config: Config;
      profiles: ProfileService;
      invocations: InvocationService;
      skills: SkillService;
      content: ContentService;
    },
  ) {}
  private load() {
    this.runtime ??= import('@platform/pi-runtime');
    return this.runtime;
  }
  async bridge(context: ConnectionContext) {
    let bridge = this.bridges.get(context.id);
    if (!bridge) {
      bridge = this.load().then(async (runtime) => {
        const adapter = await runtime.bridge({
          context,
          directory: resolve(this.deps.config.DATA_DIR, 'pi', context.ownerId, context.id),
        });
        return {
          status: () => adapter.status(),
          discover: async (signal?: AbortSignal) =>
            parseCatalog(await adapter.catalog(signal)).tools,
          catalog: async (signal?: AbortSignal) => parseCatalog(await adapter.catalog(signal)),
          request: (operation: McpOperation, options?: McpRequestOptions) =>
            adapter.request(operation, options),
          watch: adapter.watch,
          call: async (input: Parameters<ConnectionAdapter['call']>[0]) =>
            CallToolResultSchema.parse(await adapter.call(input)),
          action: (input: Record<string, unknown>) => adapter.action(input),
          close: async () => {
            this.bridges.delete(context.id);
            await adapter.close();
          },
        };
      });
      this.bridges.set(context.id, bridge);
    }
    return bridge;
  }
  async action(context: ConnectionContext, input: Record<string, unknown>) {
    return (await this.bridge(context)).action(input);
  }
  list(ownerId: string) {
    return this.deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.ownerId, ownerId))
      .orderBy(desc(tasks.createdAt));
  }
  async start(ownerId: string, input: { profileId: string; prompt: string }) {
    if (this.deps.config.PI_ENABLED !== 'true')
      throw new AppError('PI_DISABLED', '内置 Agent 任务未启用；MCP 连接和 Pi 桥接可正常使用', 409);
    if (!this.deps.config.PI_MODEL_PROVIDER || !this.deps.config.PI_MODEL_ID)
      throw new AppError(
        'MODEL_REQUIRED',
        '执行内置 Agent 任务需要配置 PI_MODEL_PROVIDER、PI_MODEL_ID 和模型供应商凭证；MCP 连接无需模型',
      );
    await this.deps.profiles.owned(ownerId, input.profileId);
    await this.load();
    const id = randomUUID();
    const abort = new AbortController();
    await this.deps.db.insert(tasks).values({ id, ownerId, ...input, status: 'running' });
    const done = this.run(id, ownerId, { ...input, abort });
    this.running.set(id, { ownerId, profileId: input.profileId, abort, done });
    void done.finally(() => this.running.delete(id));
    return { id };
  }
  private async run(
    id: string,
    ownerId: string,
    input: { profileId: string; prompt: string; abort: AbortController },
  ) {
    let output = '';
    try {
      const profile = await this.deps.profiles.owned(ownerId, input.profileId);
      const catalog = await this.deps.profiles.catalog(ownerId, input.profileId);
      const content = await contentToolset(this.deps.content, {
        ownerId,
        profileId: input.profileId,
      });
      const skills = await Promise.all(
        profile.skillVersionIds.map((version) => this.deps.skills.version(ownerId, version)),
      );
      const runtime = await this.load();
      output = await runtime.run({
        directory: resolve(this.deps.config.DATA_DIR, 'pi', ownerId, 'tasks', id),
        provider: this.deps.config.PI_MODEL_PROVIDER!,
        model: this.deps.config.PI_MODEL_ID!,
        prompt: input.prompt,
        tools: [
          ...content.tools,
          ...catalog.map(
            (t) => ({ ...t.definition, name: t.id, inputSchema: t.definition.inputSchema }) as Tool,
          ),
        ],
        skills,
        signal: input.abort.signal,
        call: (name, args, signal) =>
          content.handles(name)
            ? content.call(name, args, signal)
            : this.deps.invocations.call({
                ownerId,
                profileId: input.profileId,
                toolId: name,
                arguments: args,
                signal,
              }),
        onText: (text) => {
          output += text;
        },
      });
      await this.deps.db
        .update(tasks)
        .set({ status: input.abort.signal.aborted ? 'cancelled' : 'succeeded', output })
        .where(eq(tasks.id, id));
    } catch (error) {
      await this.deps.db
        .update(tasks)
        .set({
          status: input.abort.signal.aborted ? 'cancelled' : 'failed',
          output,
          error: errorMessage(error),
        })
        .where(eq(tasks.id, id));
    }
  }
  async cancel(ownerId: string, id: string) {
    const task = requireValue(this.running.get(id), '任务未在当前进程运行');
    if (task.ownerId !== ownerId) throw new AppError('NOT_FOUND', '任务不存在', 404);
    task.abort.abort();
    await task.done;
  }
  async revokeProfile(profileId: string) {
    for (const task of this.running.values()) if (task.profileId === profileId) task.abort.abort();
  }
  async close() {
    for (const task of this.running.values()) task.abort.abort();
    await Promise.all([...this.running.values()].map((task) => task.done));
    await Promise.all([...this.bridges.values()].map(async (bridge) => (await bridge).close()));
  }
  async recover() {
    await this.deps.db
      .update(tasks)
      .set({ status: 'unknown', error: '平台重启中断任务；请检查工具调用记录，不会自动重放' })
      .where(and(eq(tasks.status, 'running')));
  }
}

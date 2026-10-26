import { CALL_TIMEOUT_MS } from '@platform/contracts';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { calls, type Database } from '@platform/db';
import { AppError } from '../../shared/errors.js';
import type { ProfileService, Principal } from '../agent-profiles/profileService.js';
import type { ConnectionService } from './connectionService.js';
export class InvocationService {
  private readonly active = new Map<
    string,
    { ownerId: string; profileId?: string; credentialId?: string; abort: AbortController }
  >();
  constructor(
    private readonly deps: {
      db: Database;
      profiles: ProfileService;
      connections: ConnectionService;
    },
  ) {}
  async call(input: {
    ownerId: string;
    profileId?: string;
    principal?: Principal;
    toolId: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
  }) {
    if (input.principal)
      await this.deps.profiles.authenticate(input.principal.profileId, input.principal.token);
    const catalog = await this.deps.profiles.catalog(input.ownerId, input.profileId);
    const tool = catalog.find((t) => t.id === input.toolId);
    if (!tool) throw new AppError('TOOL_FORBIDDEN', '该工具不存在或未授权', 403);
    const connection = await this.deps.connections.owned(input.ownerId, tool.connectionId);
    if (connection.status === 'stopped')
      throw new AppError('CONNECTION_STOPPED', '连接已停止，请先启动', 409);
    const id = randomUUID();
    const abort = new AbortController();
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(CALL_TIMEOUT_MS),
      ...(input.signal ? [input.signal] : []),
    ]);
    await this.deps.db.insert(calls).values({
      id,
      ownerId: input.ownerId,
      profileId: input.profileId,
      toolId: tool.id,
      connectionId: connection.id,
      adapter: connection.adapter,
      deviceId: connection.deviceId,
      status: 'running',
    });
    this.active.set(id, {
      ownerId: input.ownerId,
      profileId: input.profileId,
      credentialId: input.principal?.credentialId,
      abort,
    });
    try {
      const adapter = await this.deps.connections.adapter(input.ownerId, connection.id);
      signal.throwIfAborted();
      const result = await adapter.call({ name: tool.name, arguments: input.arguments, signal });
      await this.finish(id, result.isError ? 'tool_error' : 'succeeded');
      return result;
    } catch (error) {
      const context = await this.deps.connections.context(input.ownerId, connection.id);
      const message = this.deps.connections.redact(error, context.config);
      const unknown =
        signal.aborted || (error instanceof AppError && error.code === 'RESULT_UNKNOWN');
      await this.finish(id, unknown ? 'unknown' : 'failed', message);
      throw new AppError(unknown ? 'RESULT_UNKNOWN' : 'CALL_FAILED', message, 502);
    } finally {
      this.active.delete(id);
    }
  }
  private finish(id: string, status: string, error?: string) {
    return this.deps.db
      .update(calls)
      .set({ status, error, endedAt: new Date() })
      .where(eq(calls.id, id));
  }
  cancel(ownerId: string, id: string) {
    const current = this.active.get(id);
    if (!current || current.ownerId !== ownerId)
      throw new AppError('CALL_NOT_RUNNING', '调用不在当前进程中运行', 404);
    current.abort.abort();
  }
  revoke(input: { profileId?: string; credentialId?: string }) {
    for (const current of this.active.values()) {
      if (
        (input.profileId && current.profileId === input.profileId) ||
        (input.credentialId && current.credentialId === input.credentialId)
      )
        current.abort.abort();
    }
  }
}

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { connections, tools, type Database } from '@platform/db';
import { connectionInput, type ConnectionInput } from '@platform/contracts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { digest, type Vault } from '../../shared/crypto.js';
import { AppError, requireValue } from '../../shared/errors.js';
import { redactConnectionError } from './connectionDiagnostics.js';
import type { DeviceService } from '../devices/deviceService.js';
import type { AdapterFactory, ConnectionContext } from './adapter.js';
import { ConnectionRuntime } from './connectionRuntime.js';
export const toolId = (connectionId: string, name: string) =>
  `t_${digest(`${connectionId}:${name}`)}`;
export class ConnectionService {
  private readonly runtime: ConnectionRuntime;
  constructor(
    private readonly deps: {
      db: Database;
      vault: Vault;
      factory: AdapterFactory;
      devices: DeviceService;
      publicUrl: string;
    },
  ) {
    this.runtime = new ConnectionRuntime(deps.factory);
  }
  async validate(ownerId: string, input: unknown) {
    const config = connectionInput.parse(input);
    if (config.deviceId) await this.deps.devices.owned(ownerId, config.deviceId);
    if (
      config.url &&
      new URL(config.url).origin === new URL(this.deps.publicUrl).origin &&
      new URL(config.url).pathname.startsWith('/mcp/')
    )
      throw new AppError('GATEWAY_LOOP', '上游地址不能指向本平台 MCP 入口');
    return config;
  }
  async create(ownerId: string, input: unknown) {
    return requireValue((await this.createMany(ownerId, [input]))[0]);
  }
  async createMany(ownerId: string, inputs: unknown[]) {
    const configs = await Promise.all(inputs.map((input) => this.validate(ownerId, input)));
    if (!configs.length) return [];
    const rows = configs.map((config) => {
      const id = randomUUID();
      return {
        id,
        ownerId,
        name: config.name,
        adapter: config.adapter,
        deviceId: config.deviceId,
        config: this.deps.vault.seal(config, `${ownerId}:${id}`),
      };
    });
    return this.deps.db.insert(connections).values(rows).returning({ id: connections.id });
  }

  async owned(ownerId: string, id: string) {
    const [row] = await this.deps.db
      .select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)));
    return requireValue(row);
  }
  async context(ownerId: string, id: string): Promise<ConnectionContext> {
    const row = await this.owned(ownerId, id);
    return {
      id,
      ownerId,
      config: connectionInput.parse(
        this.deps.vault.open<ConnectionInput>(row.config, `${ownerId}:${id}`),
      ),
    };
  }
  async list(ownerId: string) {
    const rows = await this.deps.db
      .select()
      .from(connections)
      .where(eq(connections.ownerId, ownerId));
    return Promise.all(
      rows.map(async ({ config, ...row }) => {
        const value = this.deps.vault.open<ConnectionInput>(config, `${ownerId}:${row.id}`);
        const status = row.status === 'connected' ? await this.runtime.status(row.id) : row.status;
        return {
          ...row,
          status,
          transport: value.transport,
          mode: value.mode,
          url: value.url ? new URL(value.url).origin + new URL(value.url).pathname : undefined,
        };
      }),
    );
  }
  async adapter(ownerId: string, id: string) {
    const context = await this.context(ownerId, id);
    if (context.config.deviceId) await this.deps.devices.owned(ownerId, context.config.deviceId);
    const slot = this.runtime.acquire(context);
    try {
      const adapter = await this.runtime.adapter(slot);
      if (!this.runtime.current(slot))
        throw new AppError('CONNECTION_SUPERSEDED', '连接已停止或被替换', 409);
      return adapter;
    } catch (error) {
      if (this.runtime.current(slot)) await this.runtime.invalidate(id).closed;
      throw error;
    }
  }
  async discover(ownerId: string, id: string, signal?: AbortSignal) {
    const context = await this.context(ownerId, id);
    if (context.config.deviceId) await this.deps.devices.owned(ownerId, context.config.deviceId);
    const slot = this.runtime.acquire(context);
    try {
      const adapter = await this.runtime.adapter(slot);
      const combined = AbortSignal.any([slot.abort.signal, ...(signal ? [signal] : [])]);
      combined.throwIfAborted();
      const discovered = await adapter.discover(combined);
      const saved = await this.runtime.write(slot, () => this.saveTools(context, discovered));
      if (!saved)
        throw new AppError('CONNECTION_SUPERSEDED', '连接已停止或被替换，旧发现结果未保存', 409);
      return discovered.map((tool) => ({ ...tool, id: toolId(id, tool.name) }));
    } catch (error) {
      if (signal?.aborted)
        throw new AppError('DISCOVERY_CANCELLED', this.redact(error, context.config), 409);
      if (!this.runtime.current(slot))
        throw new AppError('CONNECTION_SUPERSEDED', '连接已停止或被替换，旧发现请求已结束', 409);
      const { next, closed } = this.runtime.invalidate(id);
      const message = this.redact(error, context.config);
      await this.runtime.write(next, () =>
        this.deps.db
          .update(connections)
          .set({ status: 'error', error: message })
          .where(eq(connections.id, id)),
      );
      try {
        await closed;
      } catch (closeError) {
        throw new AppError(
          'CONNECTION_FAILED',
          `${message}; 清理连接失败：${this.redact(closeError, context.config)}`,
          502,
        );
      }
      throw new AppError('CONNECTION_FAILED', message, 502);
    }
  }
  private async saveTools(context: ConnectionContext, discovered: Tool[]) {
    await this.deps.db.transaction(async (tx) => {
      await tx.update(tools).set({ available: false }).where(eq(tools.connectionId, context.id));
      for (const tool of discovered) {
        const row = {
          id: toolId(context.id, tool.name),
          ownerId: context.ownerId,
          connectionId: context.id,
          name: tool.name,
          definition: tool,
          available: true,
        };
        await tx
          .insert(tools)
          .values(row)
          .onConflictDoUpdate({ target: tools.id, set: { definition: tool, available: true } });
      }
      await tx
        .update(connections)
        .set({ status: 'connected', error: null })
        .where(eq(connections.id, context.id));
    });
  }
  redact(error: unknown, config: ConnectionInput) {
    return redactConnectionError(error, config);
  }
  async close(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    await this.runtime.invalidate(id).closed;
  }
  async stop(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    const { next, closed } = this.runtime.invalidate(id);
    await closed;
    await this.runtime.write(next, () =>
      this.deps.db
        .update(connections)
        .set({ status: 'stopped', error: null })
        .where(eq(connections.id, id)),
    );
  }
  async shutdown() {
    await this.runtime.shutdown();
  }
}

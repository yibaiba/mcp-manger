import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { connections, tools, mcpEntries, type Database } from '@platform/db';
import { connectionInput, type ConnectionInput } from '@platform/contracts';
import type { McpCatalog, McpNotification } from '@platform/mcp';
import { digest, type Vault } from '../../shared/crypto.js';
import { AppError, requireValue } from '../../shared/errors.js';
import { redactConnectionError } from './connectionDiagnostics.js';
import type { DeviceService } from '../devices/deviceService.js';
import type { AdapterFactory, ConnectionContext } from './adapter.js';
import { ConnectionRuntime } from './connectionRuntime.js';
import { catalogEntries } from './catalogEntries.js';
export type ConnectionEvent = {
  ownerId: string;
  connectionId: string;
  notification: McpNotification;
};
export const toolId = (connectionId: string, name: string) =>
  `t_${digest(`${connectionId}:${name}`)}`;
export class ConnectionService {
  private readonly runtime: ConnectionRuntime;
  private readonly listeners = new Set<(event: ConnectionEvent) => Promise<void>>();
  private readonly closingListeners = new Set<(connectionId: string) => Promise<void>>();
  private readonly notifications = new Map<string, Promise<void>>();
  constructor(
    private readonly deps: {
      db: Database;
      vault: Vault;
      factory: AdapterFactory;
      devices: DeviceService;
      publicUrl: string;
    },
  ) {
    this.runtime = new ConnectionRuntime(async (context, slot) => {
      const adapter = await deps.factory(context);
      const current = () => this.runtime.current(slot) && !slot.abort.signal.aborted;
      const unwatch = adapter.watch((notification) =>
        this.receive({ context, notification, current }),
      );
      const close = adapter.close.bind(adapter);
      return {
        ...adapter,
        close: async () => {
          unwatch();
          try {
            for (const listener of this.closingListeners) await listener(context.id);
          } finally {
            await close();
          }
        },
      };
    });
  }
  watch(listener: (event: ConnectionEvent) => Promise<void>) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  watchClosing(listener: (connectionId: string) => Promise<void>) {
    this.closingListeners.add(listener);
    return () => this.closingListeners.delete(listener);
  }
  private receive({
    context,
    notification,
    current,
  }: {
    context: ConnectionContext;
    notification: McpNotification;
    current: () => boolean;
  }) {
    const previous = this.notifications.get(context.id) ?? Promise.resolve();
    const pending = previous
      .then(async () => {
        if (!current()) return;
        if (notification.method.endsWith('/list_changed'))
          await this.discover(context.ownerId, context.id);
        if (!current()) return;
        for (const listener of this.listeners)
          await listener({ ownerId: context.ownerId, connectionId: context.id, notification });
      })
      .catch(async (error: unknown) => {
        if (!current()) return;
        const message = this.redact(error, context.config);
        console.error('MCP notification failed', context.id, message);
        await this.deps.db
          .update(connections)
          .set({ error: `通知处理失败：${message}` })
          .where(eq(connections.id, context.id));
      });
    this.notifications.set(context.id, pending);
    const cleanup = () => {
      if (this.notifications.get(context.id) === pending) this.notifications.delete(context.id);
    };
    void pending.then(cleanup, (error: unknown) => {
      cleanup();
      console.error(
        'MCP notification diagnostic persistence failed',
        context.id,
        error instanceof Error ? error.message : String(error),
      );
    });
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
      const catalog = await adapter.catalog(combined);
      const discovered = catalog.tools;
      const saved = await this.runtime.write(slot, () => this.saveCatalog(context, catalog));
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
  private async saveCatalog(context: ConnectionContext, catalog: McpCatalog) {
    await this.deps.db.transaction(async (tx) => {
      await tx.update(tools).set({ available: false }).where(eq(tools.connectionId, context.id));
      for (const tool of catalog.tools) {
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
        .update(mcpEntries)
        .set({ available: false })
        .where(eq(mcpEntries.connectionId, context.id));
      for (const row of catalogEntries(context, catalog)) {
        await tx
          .insert(mcpEntries)
          .values(row)
          .onConflictDoUpdate({
            target: mcpEntries.id,
            set: { definition: row.definition, name: row.name, available: true },
          });
      }
      await tx
        .update(connections)
        .set({
          status: 'connected',
          error: null,
          protocolVersion: catalog.protocolVersion,
          capabilities: catalog.capabilities,
        })
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
    await Promise.all(this.notifications.values());
  }
}

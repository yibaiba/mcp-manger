import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { mcpEntries, tools, type Database } from '@platform/db';
import { UriTemplate } from '@modelcontextprotocol/server';
import {
  GetPromptResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpOperation, McpRequestOptions } from '@platform/mcp';
import { AppError } from '../../shared/errors.js';
import type { ProfileService, Principal } from '../agent-profiles/profileService.js';
import type { ConnectionService } from './connectionService.js';
import { catalogEntries } from './catalogEntries.js';
import { scopedUri, scopeResult, originalUri } from './catalogEntries.js';

export type ContentEntry = typeof mcpEntries.$inferSelect;
export type ContentAccess = { ownerId: string; profileId?: string; principal?: Principal };

export class ContentService {
  constructor(
    private readonly deps: {
      db: Database;
      profiles: ProfileService;
      connections: ConnectionService;
    },
  ) {}
  async catalog(access: ContentAccess, connectionId?: string) {
    if (access.principal)
      await this.deps.profiles.authenticate(access.principal.profileId, access.principal.token);
    const rows = await this.deps.db
      .select()
      .from(mcpEntries)
      .where(
        and(
          eq(mcpEntries.ownerId, access.ownerId),
          connectionId ? eq(mcpEntries.connectionId, connectionId) : undefined,
        ),
      );
    const profile = access.profileId
      ? await this.deps.profiles.owned(access.ownerId, access.profileId)
      : undefined;
    const granted = profile ? rows.filter((row) => profile.contentIds.includes(row.id)) : rows;
    const visible = await this.scopedCatalog(access.ownerId, granted);
    return profile ? visible.filter((row) => profile.contentIds.includes(row.id)) : visible;
  }
  private async scopedCatalog(ownerId: string, rows: ContentEntry[]) {
    const scoped = await Promise.all(
      [...new Set(rows.map((row) => row.connectionId))].map(async (id) => {
        const catalog = await this.deps.connections.catalogForAccess(ownerId, id);
        return catalog
          ? catalogEntries(await this.deps.connections.context(ownerId, id), catalog)
          : [];
      }),
    );
    return scoped.flat();
  }
  definition(entry: ContentEntry) {
    const { definition, connectionId } = entry;
    if (entry.kind === 'prompt') return { ...definition, name: entry.id };
    if (entry.kind === 'template')
      return { ...definition, uriTemplate: scopedUri(connectionId, entry.locator) };
    return { ...definition, uri: scopedUri(connectionId, entry.locator) };
  }
  async eventVisible(access: ContentAccess, connectionId: string, method: string) {
    if (!access.profileId) return true;
    const profile = await this.deps.profiles.owned(access.ownerId, access.profileId);
    if (method === 'notifications/tools/list_changed') {
      const rows = await this.deps.db
        .select({ id: tools.id })
        .from(tools)
        .where(and(eq(tools.ownerId, access.ownerId), eq(tools.connectionId, connectionId)));
      return rows.some((row) => profile.toolIds.includes(row.id));
    }
    const rows = await this.deps.db
      .select()
      .from(mcpEntries)
      .where(
        and(eq(mcpEntries.ownerId, access.ownerId), eq(mcpEntries.connectionId, connectionId)),
      );
    const prompt = method === 'notifications/prompts/list_changed';
    return rows.some(
      (row) =>
        profile.contentIds.includes(row.id) &&
        (prompt ? row.kind === 'prompt' : row.kind !== 'prompt'),
    );
  }
  async prompt(
    input: ContentAccess & { id: string; arguments?: Record<string, string> } & McpRequestOptions,
  ) {
    const [stored] = await this.deps.db
      .select()
      .from(mcpEntries)
      .where(and(eq(mcpEntries.ownerId, input.ownerId), eq(mcpEntries.id, input.id)));
    if (!stored) throw new AppError('PROMPT_FORBIDDEN', '该 Prompt 不存在或未授权', 403);
    const entry = (await this.catalog(input, stored.connectionId)).find(
      (row) => row.kind === 'prompt' && row.id === input.id,
    );
    if (!entry) throw new AppError('PROMPT_FORBIDDEN', '该 Prompt 不存在或未授权', 403);
    const result = await this.execute(
      entry,
      { method: 'prompts/get', params: { name: entry.locator, arguments: input.arguments } },
      input,
    );
    await this.assertStillGranted(input, entry);
    return scopeResult(entry.connectionId, GetPromptResultSchema.parse(result));
  }
  async resolveResource(access: ContentAccess, uri: string) {
    const connection = z.uuid().safeParse(/^(?:mcp-platform|ui):\/\/([^/]+)\//.exec(uri)?.[1]);
    if (!connection.success)
      throw new AppError('RESOURCE_FORBIDDEN', '资源 URI 缺少有效连接命名空间', 403);
    const entries = await this.catalog(access, connection.data);
    for (const entry of entries) {
      if (entry.kind === 'prompt') continue;
      const original = originalUri(entry.connectionId, uri);
      if (original === undefined) continue;
      if (entry.kind === 'resource' && original === entry.locator) return { entry, original };
      if (entry.kind === 'template' && new UriTemplate(entry.locator).match(original))
        return { entry, original };
    }
    throw new AppError('RESOURCE_FORBIDDEN', '该 Resource 不存在或未授权', 403);
  }
  async read(input: ContentAccess & { uri: string } & McpRequestOptions) {
    const { entry, original } = await this.resolveResource(input, input.uri);
    const result = await this.execute(
      entry,
      { method: 'resources/read', params: { uri: original } },
      input,
    );
    await this.assertStillGranted(input, entry);
    return scopeResult(entry.connectionId, ReadResourceResultSchema.parse(result));
  }
  async execute(entry: ContentEntry, operation: McpOperation, options: McpRequestOptions) {
    const adapter = await this.adapter(entry);
    return adapter.request(operation, options);
  }
  async subscribe(entry: ContentEntry, uri: string) {
    const adapter = await this.adapter(entry);
    await adapter.request({ method: 'resources/subscribe', params: { uri } });
    // Cleanup belongs to this adapter lifetime and must never open a replacement connection.
    return () => adapter.request({ method: 'resources/unsubscribe', params: { uri } });
  }
  private async adapter(entry: ContentEntry) {
    const connection = await this.deps.connections.owned(entry.ownerId, entry.connectionId);
    if (connection.status === 'stopped')
      throw new AppError('CONNECTION_STOPPED', '连接已停止，请先启动', 409);
    return this.deps.connections.adapter(entry.ownerId, entry.connectionId);
  }
  private async assertStillGranted(access: ContentAccess, entry: ContentEntry) {
    if (!(await this.catalog(access, entry.connectionId)).some((row) => row.id === entry.id))
      throw new AppError('GRANT_REVOKED', '请求期间权限已撤销', 403);
  }
}

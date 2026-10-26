import { and, eq } from 'drizzle-orm';
import { authorizationBindings, catalogSnapshots, type Database } from '@platform/db';
import type { McpCatalog } from '@platform/mcp';
import { digest, type Vault } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import type { ConnectionContext } from '../mcp/adapter.js';

export class BindingService {
  constructor(private readonly deps: { db: Database; vault: Vault }) {}
  async resolve(input: { ownerId: string; connectionId: string; identity: string }) {
    const id = `b_${digest(`${input.connectionId}:${input.identity}`)}`;
    await this.deps.db
      .insert(authorizationBindings)
      .values({ id, ...input })
      .onConflictDoNothing();
    const [binding] = await this.deps.db
      .select()
      .from(authorizationBindings)
      .where(
        and(eq(authorizationBindings.id, id), eq(authorizationBindings.ownerId, input.ownerId)),
      );
    if (!binding || binding.revoked)
      throw new AppError('BINDING_REVOKED', '上游授权绑定已撤销，请重新授权', 403);
    return binding;
  }
  list(ownerId: string, connectionId: string) {
    return this.deps.db
      .select({
        id: authorizationBindings.id,
        identity: authorizationBindings.identity,
        revoked: authorizationBindings.revoked,
      })
      .from(authorizationBindings)
      .where(
        and(
          eq(authorizationBindings.ownerId, ownerId),
          eq(authorizationBindings.connectionId, connectionId),
        ),
      );
  }
  async save(context: ConnectionContext, catalog: McpCatalog) {
    if (!context.bindingId || !context.capabilityKey) return;
    const id = `${context.bindingId}:${context.capabilityKey}`;
    const encrypted = this.deps.vault.seal(catalog, `catalog:${context.ownerId}:${id}`);
    await this.deps.db
      .insert(catalogSnapshots)
      .values({
        id,
        ownerId: context.ownerId,
        connectionId: context.id,
        bindingId: context.bindingId,
        capabilityKey: context.capabilityKey,
        encrypted,
      })
      .onConflictDoUpdate({
        target: catalogSnapshots.id,
        set: { encrypted, updatedAt: new Date() },
      });
  }
  async snapshot(context: ConnectionContext) {
    const id = `${context.bindingId}:${context.capabilityKey}`;
    const [row] = await this.deps.db
      .select()
      .from(catalogSnapshots)
      .where(and(eq(catalogSnapshots.id, id), eq(catalogSnapshots.ownerId, context.ownerId)));
    return row
      ? this.deps.vault.open<McpCatalog>(row.encrypted, `catalog:${context.ownerId}:${id}`)
      : undefined;
  }
}

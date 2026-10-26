import { and, eq } from 'drizzle-orm';
import { authorizations, type Database } from '@platform/db';
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  type OAuthClientInformationContext,
} from '@modelcontextprotocol/client';
import { secretToken, type Vault } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import type { ConnectionContext } from '../mcp/adapter.js';
interface Credentials {
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  verifier?: string;
  state?: string;
  expiresAt?: number;
  url?: string;
  discovery?: OAuthDiscoveryState;
}
export class UpstreamOAuth {
  private readonly providers = new Map<string, PersistedProvider>();
  constructor(
    private readonly options: {
      db: Database;
      vault: Vault;
      publicUrl: string;
      fetch: typeof fetch;
    },
  ) {}
  provider(context: ConnectionContext) {
    let provider = this.providers.get(`${context.ownerId}:${context.id}`);
    if (!provider) {
      provider = new PersistedProvider(this.options, context);
      this.providers.set(`${context.ownerId}:${context.id}`, provider);
    }
    return provider;
  }
  async start(context: ConnectionContext) {
    const provider = this.provider(context);
    const result = await auth(provider, {
      serverUrl: context.config.url!,
      scope: context.config.oauth?.scope,
      fetchFn: this.options.fetch,
    });
    return { status: result, authorizationUrl: (await provider.read()).url };
  }
  async complete(context: ConnectionContext, input: { code: string; state: string }) {
    const provider = this.provider(context);
    const stored = await provider.read();
    if (
      !stored.state ||
      stored.state !== input.state ||
      !stored.expiresAt ||
      stored.expiresAt < Date.now()
    )
      throw new AppError('OAUTH_STATE', '授权状态无效或已过期');
    // Consume state before exchange; a failed exchange requires a fresh explicit flow.
    await provider.update({ state: undefined, expiresAt: undefined, url: undefined });
    await auth(provider, {
      serverUrl: context.config.url!,
      authorizationCode: input.code,
      fetchFn: this.options.fetch,
    });
  }
  async status(context: ConnectionContext) {
    const data = await this.provider(context).read();
    return {
      connectionId: context.id,
      authorized: Boolean(data.tokens),
      pending: Boolean(data.state && data.expiresAt && data.expiresAt > Date.now()),
      scope: data.tokens?.scope,
      authorizationUrl: data.url,
    };
  }
  async revoke(context: ConnectionContext) {
    const provider = this.provider(context);
    await provider.revoke();
    this.providers.delete(`${context.ownerId}:${context.id}`);
    return {
      status: 'removed',
      upstreamRevocation: '请在供应商账户中撤销已授予的权限；平台已删除本地凭证',
    };
  }
}
class PersistedProvider implements OAuthClientProvider {
  private writes: Promise<void> = Promise.resolve();
  private revoked = false;
  constructor(
    private readonly options: { db: Database; vault: Vault; publicUrl: string },
    private readonly context: ConnectionContext,
  ) {}
  get redirectUrl() {
    return `${this.options.publicUrl}/api/v1/connections/${this.context.id}/oauth/callback`;
  }
  get clientMetadata() {
    return {
      client_name: 'MCP Platform',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.context.config.oauth?.clientSecret
        ? 'client_secret_post'
        : 'none',
    };
  }
  async read(): Promise<Credentials> {
    const [row] = await this.options.db
      .select()
      .from(authorizations)
      .where(
        and(
          eq(authorizations.connectionId, this.context.id),
          eq(authorizations.ownerId, this.context.ownerId),
        ),
      );
    return row
      ? this.options.vault.open<Credentials>(
          row.encrypted,
          `oauth:${this.context.ownerId}:${this.context.id}`,
        )
      : {};
  }
  update(patch: Partial<Credentials>) {
    const write = this.writes.then(async () => {
      if (this.revoked) throw new AppError('OAUTH_REVOKED', '授权已撤销，请重新发起授权', 401);
      const encrypted = this.options.vault.seal(
        { ...(await this.read()), ...patch },
        `oauth:${this.context.ownerId}:${this.context.id}`,
      );
      await this.options.db
        .insert(authorizations)
        .values({ connectionId: this.context.id, ownerId: this.context.ownerId, encrypted })
        .onConflictDoUpdate({
          target: authorizations.connectionId,
          set: { encrypted, updatedAt: new Date() },
        });
    });
    this.writes = write.catch(() => {}); // Keep the queue usable; the caller still receives the rejection.
    return write;
  }
  async revoke() {
    this.revoked = true;
    await this.writes;
    await this.options.db
      .delete(authorizations)
      .where(
        and(
          eq(authorizations.connectionId, this.context.id),
          eq(authorizations.ownerId, this.context.ownerId),
        ),
      );
  }
  async state() {
    const state = secretToken();
    await this.update({ state, expiresAt: Date.now() + 10 * 60_000 });
    return state;
  }
  async clientInformation(context?: OAuthClientInformationContext) {
    const config = this.context.config.oauth;
    const stored = (await this.read()).client;
    if (!config?.clientId) return stored;
    const client = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      issuer: stored?.issuer,
    };
    if (!client.issuer && context) {
      const stamped = { ...client, issuer: context.issuer };
      await this.update({ client: stamped });
      return stamped;
    }
    return client;
  }
  saveClientInformation(
    client: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ) {
    return this.update({ client: { ...client, issuer: client.issuer ?? context?.issuer } });
  }
  async tokens() {
    return (await this.read()).tokens;
  }
  saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext) {
    return this.update({ tokens: { ...tokens, issuer: tokens.issuer ?? context?.issuer } });
  }
  redirectToAuthorization(url: URL) {
    return this.update({ url: url.toString() });
  }
  saveCodeVerifier(verifier: string) {
    return this.update({ verifier });
  }
  async codeVerifier() {
    const value = (await this.read()).verifier;
    if (!value) throw new AppError('PKCE_MISSING', '缺少 PKCE verifier，请重新授权');
    return value;
  }
  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    return this.update({ discovery });
  }
  async discoveryState() {
    return (await this.read()).discovery;
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all')
      return this.update({
        client: undefined,
        tokens: undefined,
        verifier: undefined,
        state: undefined,
        url: undefined,
        discovery: undefined,
      });
    await this.update({ [scope === 'client' ? 'client' : scope]: undefined });
  }
}

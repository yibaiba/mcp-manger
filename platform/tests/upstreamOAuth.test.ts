import { afterAll, beforeAll, expect, test } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { fixtureMcp } from './fixtureMcp.js';
import { harness } from './harness.js';
import { UpstreamOAuth } from '../apps/server/src/modules/authorizations/upstreamOAuth.js';
import { Vault } from '../apps/server/src/shared/crypto.js';
let h: Awaited<ReturnType<typeof harness>>;
let upstream: Awaited<ReturnType<typeof oauthFixture>>;
beforeAll(async () => {
  h = await harness();
  upstream = await oauthFixture();
});
afterAll(async () => {
  await h?.close();
  await upstream?.close();
});

test('official SDK upstream OAuth callback, refresh, restart persistence and revocation isolation', async () => {
  const account = await h.signup();
  const connection = await h.services.connections.create(account.ownerId, {
    name: 'protected',
    adapter: 'direct',
    transport: 'http',
    mode: 'existing',
    url: `${upstream.origin}/mcp`,
    oauth: { clientId: 'registered-test' },
  });
  const context = await h.services.connections.context(account.ownerId, connection.id);
  const start = await h.services.upstreamOAuth.start(context);
  expect(start.status).toBe('REDIRECT');
  const state = new URL(start.authorizationUrl!).searchParams.get('state')!;
  await expect(
    h.services.upstreamOAuth.complete(context, { code: 'test-code', state: 'wrong' }),
  ).rejects.toThrow('授权状态');
  await h.services.upstreamOAuth.complete(context, { code: 'test-code', state });
  expect(await h.services.upstreamOAuth.provider(context).clientInformation()).toMatchObject({
    issuer: upstream.origin,
  });
  expect(await h.services.upstreamOAuth.provider(context).tokens()).toMatchObject({
    issuer: upstream.origin,
  });
  expect((await h.services.connections.discover(account.ownerId, connection.id))[0]?.name).toBe(
    'echo',
  );
  upstream.expire();
  await h.services.connections.discover(account.ownerId, connection.id);
  expect(upstream.refreshes()).toBe(1);
  const restarted = new UpstreamOAuth({
    db: h.db,
    vault: new Vault(h.config.ENCRYPTION_KEY),
    publicUrl: h.baseURL,
    fetch,
  });
  expect((await restarted.status(context)).authorized).toBe(true);
  expect((await restarted.status({ ...context, ownerId: 'another-owner' })).authorized).toBe(false);
  const staleProvider = h.services.upstreamOAuth.provider(context);
  await h.services.connections.close(account.ownerId, connection.id);
  await h.services.upstreamOAuth.revoke(context);
  await expect(
    staleProvider.saveTokens({ access_token: 'late-response', token_type: 'Bearer' }),
  ).rejects.toThrow('已撤销');
  expect((await restarted.status(context)).authorized).toBe(false);
  await expect(
    h.services.upstreamOAuth.complete(context, { code: 'test-code', state }),
  ).rejects.toThrow('授权状态');
});

async function oauthFixture() {
  const mcp = await fixtureMcp();
  const app = new Hono();
  let origin = '';
  let current = '';
  let refreshes = 0;
  app.get('/.well-known/oauth-protected-resource/mcp', (c) =>
    c.json({ resource: `${origin}/mcp`, authorization_servers: [origin] }),
  );
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }),
  );
  app.post('/token', async (c) => {
    const input = new URLSearchParams(await c.req.text());
    if (input.get('grant_type') === 'refresh_token') refreshes++;
    current = randomBytes(16).toString('hex');
    return c.json({
      access_token: current,
      refresh_token: randomBytes(16).toString('hex'),
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });
  app.all('/mcp', async (c) => {
    if (!current || c.req.header('Authorization') !== `Bearer ${current}`)
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      });
    return fetch(new Request(mcp.url, c.req.raw));
  });
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No OAuth fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    expire: () => {
      current = '';
    },
    refreshes: () => refreshes,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mcp.close();
    },
  };
}

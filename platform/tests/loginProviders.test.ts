import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { user, account } from '../packages/db/src/index.js';
import { harness } from './harness.js';

test('OIDC uses issuer UserInfo subject, retains member role and rejects implicit email linking', async () => {
  const app = new Hono();
  let subject = randomUUID();
  const email = `${randomUUID()}@example.test`;
  let infoRequests = 0;
  let issuer = '';
  app.get('/.well-known/openid-configuration', (c) =>
    c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
    }),
  );
  app.post('/token', async (c) => {
    const input = new URLSearchParams(await c.req.text());
    expect(input.get('code_verifier')).toBeTruthy();
    return c.json({ access_token: 'fixture-userinfo-token', token_type: 'Bearer', expires_in: 60 });
  });
  app.get('/userinfo', (c) => {
    expect(c.req.header('authorization')).toBe('Bearer fixture-userinfo-token');
    infoRequests++;
    return c.json({ sub: subject, email, email_verified: false, name: 'OIDC member' });
  });
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  issuer = `http://localhost:${address.port}`;
  const h = await harness({
    providers: {
      oidc: {
        name: 'Test identity',
        issuer,
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
        clientId: 'client',
        clientSecret: 'fixture-client-secret',
      },
    },
  });
  const cookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
  const signIn = async () => {
    const start = await h.app.request('/api/v1/auth/sign-in/oauth2', {
      method: 'POST',
      headers: { Origin: h.config.WEB_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'oidc', callbackURL: h.config.WEB_ORIGIN }),
    });
    expect(start.status).toBe(200);
    const redirect = new URL(((await start.json()) as { url: string }).url);
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    const query = new URLSearchParams({
      code: randomUUID(),
      state: redirect.searchParams.get('state')!,
      iss: issuer,
    });
    return h.app.request(`/api/v1/auth/oauth2/callback/oidc?${query}`, {
      headers: { Cookie: cookie(start) },
    });
  };
  try {
    const first = await signIn();
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(h.config.WEB_ORIGIN);
    const [created] = await h.db.select().from(user).where(eq(user.email, email));
    expect(created).toMatchObject({ role: 'member', enabled: true, emailVerified: false });
    const [binding] = await h.db
      .select()
      .from(account)
      .where(and(eq(account.providerId, 'oidc'), eq(account.accountId, subject)));
    expect(binding?.userId).toBe(created!.id);
    expect((await signIn()).headers.get('location')).toBe(h.config.WEB_ORIGIN);
    subject = randomUUID();
    const conflicting = await signIn();
    expect(conflicting.headers.get('location')).toContain('error=');
    expect(await h.db.select().from(account).where(eq(account.accountId, subject))).toHaveLength(0);
    expect(infoRequests).toBe(3);
    const metadata = await (await h.app.request('/api/v1/login-options')).json();
    expect(JSON.stringify(metadata)).not.toContain('fixture-client-secret');
    expect(metadata).toMatchObject({
      providers: [{ id: 'oidc', name: 'Test identity', kind: 'oauth2' }],
    });
  } finally {
    await h.db.delete(user).where(eq(user.email, email));
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

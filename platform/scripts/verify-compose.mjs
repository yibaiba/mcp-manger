import { verifyRestRestart } from './verify-rest-restart.mjs';
import assert from 'node:assert/strict';
import { verifyDeviceChannel } from './verify-device-channel.mjs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(cwd, '.data'), { recursive: true });
const directory = await mkdtemp(resolve(cwd, '.data/compose-acceptance-'));
const project = `platform-acceptance-${Date.now()}`;
const origin = 'http://localhost:54330';
const image = process.argv[2] ?? 'mcp-platform:latest';
const sandboxOrigin = origin;
const environment = {
  ...process.env,
  PUBLIC_URL: origin,
  WEB_ORIGIN: origin,
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DEVICE_AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PI_MCP_ADAPTER_OAUTH_FILE_KEY: randomBytes(32).toString('hex'),
  ALLOW_REGISTRATION: 'true',
  PI_ENABLED: 'false',
  PI_MODEL_PROVIDER: '',
  PI_MODEL_ID: '',
};
const override = resolve(directory, 'compose.yaml');
await writeFile(
  override,
  `services:
  server:
    image: ${JSON.stringify(image)}
    ports: !override
      - '127.0.0.1:54330:4300'
`,
);
async function compose(args, timeout = 120_000) {
  const result = await execute(
    'docker',
    ['compose', '-p', project, '-f', 'compose.yaml', '-f', override, ...args],
    { cwd, env: environment, timeout, maxBuffer: 4 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.stdout;
}
async function request(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}
async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await request(`${origin}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok', piEnabled: false });
      return;
    } catch (error) {
      lastError = error;
      await setTimeout(500);
    }
  }
  throw new Error('Compose health check did not become ready', { cause: lastError });
}
async function verifyManagement() {
  const page = await request(origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<div id="app">/);
  const asset = html.match(/src="([^" ]+\.js)"/);
  assert.ok(asset, 'Production page must reference a built JS asset');
  const script = await request(new URL(asset[1], origin));
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const navigation = await request(`${origin}/connections`);
  assert.equal(navigation.status, 200);
  assert.match(await navigation.text(), /<div id="app">/);
  assert.equal((await request(`${origin}/assets/missing.js`)).status, 404);
  assert.equal((await request(`${origin}/api/v1/connections`)).status, 401);
  const signup = await request(`${origin}/api/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Disposable Compose acceptance',
      email: `${project}@example.test`,
      password: randomBytes(24).toString('hex'),
    }),
  });
  assert.equal(signup.status, 200, `Signup failed: ${signup.status}`);
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookie);
  const connections = await request(`${origin}/api/v1/connections`, {
    headers: { Cookie: cookie },
  });
  assert.equal(connections.status, 200);
  assert.deepEqual(await connections.json(), []);
  await verifyLocalManagement(cookie);
  await verifyRestRestart({
    origin,
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    compose,
    waitForHealth,
  });
  console.log('PASS: combined application web, database health, authentication and management API');
}
async function verifyLocalManagement(cookie) {
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const pairing = await request(`${origin}/api/v1/devices/pairings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Disposable local management device' }),
  });
  assert.equal(pairing.status, 201);
  const { code } = await pairing.json();
  const paired = await request(`${origin}/api/v1/devices/pair`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  assert.equal(paired.status, 201);
  const device = await paired.json();
  const { deviceId } = device;
  const local = await request(`${origin}/api/v1/devices/${deviceId}/local`, { headers });
  assert.equal(local.status, 200);
  const state = await local.json();
  assert.deepEqual(state.resources, {});
  assert.deepEqual(state.bindings, []);
  assert.deepEqual(state.platformOperations, []);
  assert.ok(state.issues.some((issue) => issue.includes('离线')));
  console.log('PASS: migrated local management tables and owned offline device API');
  await verifyDeviceChannel({
    headers,
    device,
    directory,
    origin,
    request,
    restartTransport: async () => {
      await compose(['restart', 'server']);
      await waitForHealth();
    },
  });
}
async function verifySandbox() {
  const response = await request(
    `${sandboxOrigin}/_apps/sandbox?parent=${encodeURIComponent(origin)}`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'sha256-/);
  assert.equal((await request(`${sandboxOrigin}/_apps/api/v1/connections`)).status, 404);
  const html = '<!doctype html><h1>Disposable isolated frame</h1>';
  const creation = await request(`${sandboxOrigin}/_apps/frames`, {
    method: 'POST',
    headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
  assert.equal(creation.status, 200);
  const { path } = await creation.json();
  const frame = await request(new URL(path, sandboxOrigin));
  assert.equal(frame.status, 200);
  assert.equal(await frame.text(), html);
  assert.match(frame.headers.get('content-security-policy'), /sandbox allow-scripts allow-forms/);
  assert.equal((await request(new URL(path, sandboxOrigin))).status, 410);
  console.log(
    'PASS: same-endpoint Apps proxy, single-use document and opaque sandbox CSP HTTP contract',
  );
}
try {
  const offline = await execute(
    'docker',
    ['run', '--rm', '--network', 'none', 'mcp-platform:latest', 'pnpm', '--version'],
    { cwd, timeout: 60_000 },
  );
  assert.equal(offline.stdout.trim(), '10.12.4');
  console.log('PASS: runtime user can run the packaged pnpm with networking disabled');
  await compose(['up', '-d', '--wait', 'db']);
  await compose(['run', '--rm', '--no-deps', '-T', 'server', 'pnpm', 'db:migrate']);
  await compose(['run', '--rm', '--no-deps', '-T', 'server', 'pnpm', 'db:migrate']);
  await compose(['up', '-d', '--no-build', 'server']);
  await waitForHealth();
  await verifyManagement();
  await verifySandbox();
  await compose(['exec', '-T', 'server', 'node', 'scripts/check.mjs', '60', 'pnpm', 'test:pi']);
  console.log('PASS: fresh Compose migrations, repeat migration and actual no-model Pi bridge');
} catch (error) {
  await compose(['logs', '--no-color', '--tail', '50', 'server']);
  throw error;
} finally {
  await compose(['down', '--volumes', '--remove-orphans']);
  await rm(directory, { recursive: true });
}

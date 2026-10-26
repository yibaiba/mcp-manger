import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
await mkdir('.data/browser-acceptance', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
const context = await browser.newContext({
  baseURL: 'http://localhost:4301',
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [];
const logs = [];
page.on('console', (message) => logs.push(message.text()));
page.on('pageerror', (error) => errors.push(String(error)));
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
    errors.push(`${response.status()} ${response.url()}`);
});
let connection;
async function api(path, data) {
  const result = await context.request.post(`/api/v1${path}`, {
    data,
    headers: { Origin: 'http://localhost:4301' },
  });
  assert.ok(result.ok(), `${path}: ${result.status()} ${await result.text()}`);
  return result.json();
}
try {
  await api('/auth/sign-up/email', {
    name: 'Browser acceptance',
    email: `apps-${Date.now()}@example.test`,
    password: randomBytes(24).toString('hex'),
  });
  connection = await api('/connections', {
    name: 'Apps browser acceptance',
    adapter: 'direct',
    transport: 'http',
    mode: 'existing',
    url: 'http://127.0.0.1:54820/mcp',
  });
  await api(`/connections/${connection.id}/discover`, {});
  await page.goto('/tools');
  await page
    .getByRole('button', { name: 'show Apps browser acceptance 未提供描述', exact: true })
    .click();
  await page.getByRole('button', { name: '执行工具', exact: true }).click();
  const app = page.frameLocator('iframe[title="MCP App"]').frameLocator('iframe');
  await app.getByRole('heading', { name: '隔离 App 验收' }).waitFor({ timeout: 15000 });
  await app.locator('#status').filter({ hasText: '结果已收到：' }).waitFor();
  assert.equal(await app.locator('html').getAttribute('data-message-capability'), 'false');
  console.log('PASS: App initialized and received original tool result');
  await app.getByRole('button', { name: '调用 App 专用工具' }).click();
  await app.locator('#status').filter({ hasText: 'App 工具调用成功：' }).waitFor();
  console.log('PASS: app-only tool called through the AppBridge');
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).waitFor();
  await app.locator('html[data-display-mode="fullscreen"]').waitFor({ state: 'attached' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await app.locator('html[data-host-theme="dark"]').waitFor({ state: 'attached' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await app.locator('html[data-host-theme="light"]').waitFor({ state: 'attached' });
  await page.screenshot({ path: '.data/browser-acceptance/success.png', fullPage: true });
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.getByRole('button', { name: '关闭视图', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'App 视图已结束' }).waitFor();
  assert.equal(page.frames().length, 1);
  assert.ok(logs.includes('Platform acceptance App teardown acknowledged'));
  assert.deepEqual(errors, []);
  console.log('PASS: fullscreen, close and iframe teardown, no browser errors');
} catch (error) {
  console.error(
    'Frames:',
    page.frames().map((frame) => frame.url()),
  );
  console.error('Browser errors:', errors);
  await page.screenshot({ path: '.data/browser-acceptance/failure.png', fullPage: true });
  throw error;
} finally {
  if (connection) await api(`/connections/${connection.id}/stop`, {});
  await browser.close();
}

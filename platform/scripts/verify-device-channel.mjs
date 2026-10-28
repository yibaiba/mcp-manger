import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
export async function verifyDeviceChannel({
  headers,
  device,
  directory,
  origin,
  request,
  restartTransport,
}) {
  const configPath = resolve(directory, 'connector.json');
  const localDataDir = resolve(directory, 'local');
  const tlsArgs =
    new URL(origin).protocol === 'https:'
      ? ['--ca-cert', resolve(directory, 'proxy-root.crt')]
      : [];
  await writeFile(
    configPath,
    JSON.stringify({ server: origin, ...device, localDataDir, custom: 'preserved' }),
    { mode: 0o600 },
  );
  const binary = resolve('connector/bin/connector');
  let child;
  let output = '';
  async function start() {
    child = spawn(binary, ['run', '--config', configPath, ...tlsArgs], {
      env: {
        ...process.env,
        HOME: directory,
        CODEX_HOME: resolve(directory, 'codex'),
        PI_CODING_AGENT_DIR: resolve(directory, 'pi'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      output += error.message;
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGINT');
    await exited;
  }
  async function status(predicate, label) {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const response = await request(`${origin}/api/v1/devices`, { headers });
      assert.equal(response.status, 200);
      const row = (await response.json()).find((item) => item.id === device.deviceId);
      if (predicate(row)) return row;
      await setTimeout(100);
    }
    throw new Error(`Go connector ${label} timed out: ${output}`);
  }
  try {
    await start();
    const initial = await status(
      (row) => row.online && row.version === '0.3.0',
      'HMAC WebSocket handshake',
    );
    await restartTransport();
    await status(
      (row) => row.online && row.lastSeen > initial.lastSeen,
      'automatic reconnect after transport restart',
    );
    await stop();
    await status((row) => !row.online, 'disconnect');
    await start();
    await status((row) => row.online, 'fresh challenge reconnect');
    const rePair = await request(`${origin}/api/v1/devices/${device.deviceId}/re-pairings`, {
      method: 'POST',
      headers,
    });
    assert.equal(rePair.status, 201);
    const { code } = await rePair.json();
    await status((row) => !row.online && row.pairingRequired, 'immediate re-pair invalidation');
    // Leave the old process running through its reconnect interval to prove it cannot return.
    await setTimeout(3500);
    await status((row) => !row.online && row.pairingRequired, 'old credential rejection');
    await stop();
    const repair = spawn(binary, ['re-pair', '--config', configPath, ...tlsArgs], {
      env: process.env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let repairOutput = '';
    repair.stderr.on('data', (chunk) => {
      repairOutput += chunk;
    });
    repair.stdin.end(`${code}\n`);
    assert.equal(
      await new Promise((resolve, reject) => {
        repair.once('error', reject);
        repair.once('exit', resolve);
      }),
      0,
      repairOutput,
    );
    const updated = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(updated.deviceId, device.deviceId);
    assert.equal(updated.custom, 'preserved');
    assert.equal(updated.localDataDir, localDataDir);
    assert.equal(updated.credentialVersion, device.credentialVersion + 1);
    assert.ok(!repairOutput.includes(updated.deviceSecret));
    await start();
    await status((row) => row.online && !row.pairingRequired, 'new credential recovery');
    assert.equal(
      (await request(`${origin}/api/v1/devices/${device.deviceId}`, { method: 'DELETE', headers }))
        .status,
      200,
    );
    await status((row) => row.revoked && !row.online, 'revocation');
    await setTimeout(3500);
    await status((row) => row.revoked && !row.online, 'revoked reconnect rejection');
    assert.ok(!output.includes(device.deviceSecret) && !output.includes(updated.deviceSecret));
    console.log(
      'PASS: real Go connector over the configured HTTP(S)/WebSocket transport: HMAC, reconnect, re-pair, preserved config, revocation and secret-free logs',
    );
  } finally {
    await stop();
  }
}

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/verify-python-runtime.mjs IMAGE');
const volume = `platform-python-${randomUUID()}`;
function docker(args) {
  return execFileSync('docker', args, { stdio: 'inherit', timeout: 60_000 });
}
docker(['volume', 'create', volume]);
try {
  for (const offline of [false, true]) {
    console.log(offline ? 'Hot cache, network disabled' : 'Cold cache, network enabled');
    docker([
      'run',
      '--rm',
      '--init',
      '--network',
      offline ? 'none' : 'bridge',
      '--mount',
      `type=volume,source=${volume},target=/app/.data`,
      '-e',
      `UV_OFFLINE=${offline}`,
      image,
      'node',
      'scripts/check.mjs',
      '60',
      'pnpm',
      'exec',
      'tsx',
      'tests/python-smoke.mts',
    ]);
  }
} finally {
  docker(['volume', 'rm', volume]);
}

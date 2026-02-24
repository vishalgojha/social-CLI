import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
const { createGatewayServer } = require(path.join(repoRoot, 'lib', 'gateway', 'server'));

type JsonResponse = {
  status: number | undefined;
  data: Record<string, unknown>;
};

function requestJson({ port, method, pathName }: {
  port: number;
  method: string;
  pathName: string;
}): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data: Record<string, unknown> = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function runCliHelpSmoke() {
  const cliPath = path.join(repoRoot, 'bin', 'social.js');
  const src = fs.readFileSync(cliPath, 'utf8');
  assert.match(src, /const gatewayCommands = loadCommandModule\('gateway'\);/);
  assert.match(src, /gatewayCommands\(program\);/);
  assert.match(src, /const chatCommands = loadCommandModule\('chat'\);/);
  assert.ok(!src.includes('../commands/studio'), 'legacy studio command import still present');
  assert.ok(!src.includes('gateway --open'), 'legacy gateway --open reference still present');
}

async function runGatewaySmoke() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'social-cli-smoke-gateway-home-'));
  const oldMetaHome = process.env.META_CLI_HOME;
  const oldSocialHome = process.env.SOCIAL_CLI_HOME;
  process.env.META_CLI_HOME = tempHome;
  process.env.SOCIAL_CLI_HOME = tempHome;

  const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
  try {
    await server.start();

    const health = await requestJson({
      port: server.port,
      method: 'GET',
      pathName: '/api/health'
    });
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const root = await requestJson({
      port: server.port,
      method: 'GET',
      pathName: '/'
    });
    assert.equal(root.status, 410);
    assert.equal(root.data.ok, false);
    assert.match(String(root.data.error || ''), /frontend has been removed/i);
  } finally {
    await server.stop();
    if (oldMetaHome === undefined) delete process.env.META_CLI_HOME;
    else process.env.META_CLI_HOME = oldMetaHome;
    if (oldSocialHome === undefined) delete process.env.SOCIAL_CLI_HOME;
    else process.env.SOCIAL_CLI_HOME = oldSocialHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('[smoke] checking CLI help surface...');
  runCliHelpSmoke();
  // eslint-disable-next-line no-console
  console.log('[smoke] checking gateway health and root behavior...');
  await runGatewaySmoke();
  // eslint-disable-next-line no-console
  console.log('[smoke] all release smoke checks passed');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

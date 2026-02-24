import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type TestCase = {
  name: string;
  fn: () => Promise<void> | void;
};

const testsRoot = __dirname;

function setupIsolatedHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-cli-test-home-'));
  const hasMeta = Object.prototype.hasOwnProperty.call(process.env, 'META_CLI_HOME');
  const oldMeta = process.env.META_CLI_HOME;

  process.env.META_CLI_HOME = dir;

  return () => {
    if (hasMeta) process.env.META_CLI_HOME = oldMeta;
    else delete process.env.META_CLI_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

async function run() {
  const cleanupHome = setupIsolatedHome();
  try {
    const files = [
      'api.test',
      'config.test',
      'marketing-export.test',
      'batch.test',
      'ai.test',
      'prompt-regression.test',
      'intent-engine.test',
      'chat.test',
      'onboarding-ready.test',
      'gateway.test',
      'policy.test',
      'ops.test',
      'hub.test'
    ];

    const tests: TestCase[] = [];
    files.forEach((stem) => {
      const jsPath = path.join(testsRoot, `${stem}.js`);
      const tsPath = path.join(testsRoot, `${stem}.ts`);
      const targetPath = fs.existsSync(jsPath) ? jsPath : tsPath;
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      const mod = require(targetPath) as TestCase[];
      (mod || []).forEach((t) => tests.push(t));
    });

    let pass = 0;
    let fail = 0;

    // eslint-disable-next-line no-console
    console.log(`Running ${tests.length} tests...\n`);

    // Run sequentially for determinism and to avoid sandbox spawn restrictions.
    for (const t of tests) {
      const name = t.name || '(unnamed)';
      try {
        // eslint-disable-next-line no-await-in-loop
        await t.fn();
        pass += 1;
        // eslint-disable-next-line no-console
        console.log(`ok - ${name}`);
      } catch (e) {
        fail += 1;
        // eslint-disable-next-line no-console
        console.log(`not ok - ${name}`);
        // eslint-disable-next-line no-console
        console.log(`  ${e && (e as Error).stack ? (e as Error).stack : String(e)}`);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`\npass ${pass}`);
    // eslint-disable-next-line no-console
    console.log(`fail ${fail}`);

    if (fail) process.exit(1);
  } finally {
    cleanupHome();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e && (e as Error).stack ? (e as Error).stack : String(e));
  process.exit(1);
});

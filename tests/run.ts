import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type TestCase = {
  name: string;
  fn: () => Promise<void> | void;
};

async function loadTests(): Promise<TestCase[]> {
  const testsRoot = __dirname;
  const stems = [
    "intent-parser.test",
    "config.test",
    "playwright-runtime.test"
  ];
  const out: TestCase[] = [];

  for (const stem of stems) {
    const jsPath = path.join(testsRoot, `${stem}.js`);
    const tsPath = path.join(testsRoot, `${stem}.ts`);
    const target = existsSync(jsPath) ? jsPath : tsPath;
    const mod = await import(pathToFileURL(target).href);
    const tests = Array.isArray(mod.default)
      ? mod.default
      : Array.isArray(mod.default?.default)
        ? mod.default.default
        : [];
    out.push(...tests);
  }

  return out;
}

async function main(): Promise<void> {
  const tests = await loadTests();
  let pass = 0;
  let fail = 0;

  for (const testCase of tests) {
    try {
      await testCase.fn();
      pass += 1;
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      fail += 1;
      process.stdout.write(`not ok - ${testCase.name}\n`);
      process.stdout.write(`  ${String((error as Error)?.stack || error)}\n`);
    }
  }

  process.stdout.write(`\npass ${pass}\n`);
  process.stdout.write(`fail ${fail}\n`);

  if (fail) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${String((error as Error)?.stack || error)}\n`);
  process.exit(1);
});

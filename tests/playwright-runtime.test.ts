import assert from "node:assert/strict";

const {
  ensurePlaywrightChromium,
  loadPlaywrightOrThrow,
  getPlaywrightRuntimeStatus
} = require("../lib/playwright-runtime");

function createPlaywright(executablePath: string) {
  return {
    chromium: {
      launch: async () => ({}),
      executablePath: () => executablePath
    }
  };
}

const tests = [
  {
    name: "ensurePlaywrightChromium skips install when Chromium already exists",
    fn: async () => {
      let spawned = false;
      const result = await ensurePlaywrightChromium({
        lockPath: "playwright-runtime-test.lock",
        loadPlaywright: () => createPlaywright("/fake/chromium"),
        existsSync: (target: string) => target === "/fake/chromium",
        withFileLock: async (_lockPath: string, fn: () => Promise<unknown>) => fn(),
        spawnSync: (() => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        }) as any
      });

      assert.equal(result.ok, true);
      assert.equal(result.installed, false);
      assert.equal(result.executablePath, "/fake/chromium");
      assert.equal(spawned, false);
    }
  },
  {
    name: "ensurePlaywrightChromium installs Chromium when missing",
    fn: async () => {
      let installed = false;
      let spawned = 0;

      const result = await ensurePlaywrightChromium({
        lockPath: "playwright-runtime-test.lock",
        loadPlaywright: () => createPlaywright(installed ? "/fake/chromium" : ""),
        existsSync: (target: string) => installed && target === "/fake/chromium",
        withFileLock: async (_lockPath: string, fn: () => Promise<unknown>) => fn(),
        resolveCliCommand: () => ({
          command: process.execPath,
          args: ["playwright-cli.js", "install", "chromium"],
          cwd: process.cwd()
        }),
        spawnSync: (() => {
          spawned += 1;
          installed = true;
          return { status: 0, stdout: "installed", stderr: "" };
        }) as any
      });

      assert.equal(result.ok, true);
      assert.equal(result.installed, true);
      assert.equal(result.executablePath, "/fake/chromium");
      assert.equal(spawned, 1);
    }
  },
  {
    name: "loadPlaywrightOrThrow reports missing Chromium when auto-install is disabled",
    fn: async () => {
      await assert.rejects(
        () => loadPlaywrightOrThrow({
          autoInstall: false,
          loadPlaywright: () => createPlaywright(""),
          existsSync: () => false
        }),
        (error: Error & { code?: string }) => error.code === "BROWSER_DRIVER_MISSING"
      );
    }
  },
  {
    name: "getPlaywrightRuntimeStatus reports ready runtime state",
    fn: () => {
      const status = getPlaywrightRuntimeStatus({
        loadPlaywright: () => createPlaywright("/fake/chromium"),
        existsSync: (target: string) => target === "/fake/chromium"
      });

      assert.equal(status.packageInstalled, true);
      assert.equal(status.chromiumInstalled, true);
      assert.equal(status.executablePath, "/fake/chromium");
    }
  }
];

export default tests;

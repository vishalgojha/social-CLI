"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const { ensurePlaywrightChromium, loadPlaywrightOrThrow, getPlaywrightRuntimeStatus } = require("../lib/playwright-runtime");
function createPlaywright(executablePath) {
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
                existsSync: (target) => target === "/fake/chromium",
                withFileLock: async (_lockPath, fn) => fn(),
                spawnSync: (() => {
                    spawned = true;
                    return { status: 0, stdout: "", stderr: "" };
                })
            });
            strict_1.default.equal(result.ok, true);
            strict_1.default.equal(result.installed, false);
            strict_1.default.equal(result.executablePath, "/fake/chromium");
            strict_1.default.equal(spawned, false);
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
                existsSync: (target) => installed && target === "/fake/chromium",
                withFileLock: async (_lockPath, fn) => fn(),
                resolveCliCommand: () => ({
                    command: process.execPath,
                    args: ["playwright-cli.js", "install", "chromium"],
                    cwd: process.cwd()
                }),
                spawnSync: (() => {
                    spawned += 1;
                    installed = true;
                    return { status: 0, stdout: "installed", stderr: "" };
                })
            });
            strict_1.default.equal(result.ok, true);
            strict_1.default.equal(result.installed, true);
            strict_1.default.equal(result.executablePath, "/fake/chromium");
            strict_1.default.equal(spawned, 1);
        }
    },
    {
        name: "loadPlaywrightOrThrow reports missing Chromium when auto-install is disabled",
        fn: async () => {
            await strict_1.default.rejects(() => loadPlaywrightOrThrow({
                autoInstall: false,
                loadPlaywright: () => createPlaywright(""),
                existsSync: () => false
            }), (error) => error.code === "BROWSER_DRIVER_MISSING");
        }
    },
    {
        name: "getPlaywrightRuntimeStatus reports ready runtime state",
        fn: () => {
            const status = getPlaywrightRuntimeStatus({
                loadPlaywright: () => createPlaywright("/fake/chromium"),
                existsSync: (target) => target === "/fake/chromium"
            });
            strict_1.default.equal(status.packageInstalled, true);
            strict_1.default.equal(status.chromiumInstalled, true);
            strict_1.default.equal(status.executablePath, "/fake/chromium");
        }
    }
];
exports.default = tests;

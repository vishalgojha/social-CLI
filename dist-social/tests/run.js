"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
async function loadTests() {
    const testsRoot = __dirname;
    const stems = [
        "intent-parser.test",
        "config.test",
        "playwright-runtime.test"
    ];
    const out = [];
    for (const stem of stems) {
        const jsPath = node_path_1.default.join(testsRoot, `${stem}.js`);
        const tsPath = node_path_1.default.join(testsRoot, `${stem}.ts`);
        const target = (0, node_fs_1.existsSync)(jsPath) ? jsPath : tsPath;
        const mod = await import((0, node_url_1.pathToFileURL)(target).href);
        const tests = Array.isArray(mod.default)
            ? mod.default
            : Array.isArray(mod.default?.default)
                ? mod.default.default
                : [];
        out.push(...tests);
    }
    return out;
}
async function main() {
    const tests = await loadTests();
    let pass = 0;
    let fail = 0;
    for (const testCase of tests) {
        try {
            await testCase.fn();
            pass += 1;
            process.stdout.write(`ok - ${testCase.name}\n`);
        }
        catch (error) {
            fail += 1;
            process.stdout.write(`not ok - ${testCase.name}\n`);
            process.stdout.write(`  ${String(error?.stack || error)}\n`);
        }
    }
    process.stdout.write(`\npass ${pass}\n`);
    process.stdout.write(`fail ${fail}\n`);
    if (fail)
        process.exit(1);
}
main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
});

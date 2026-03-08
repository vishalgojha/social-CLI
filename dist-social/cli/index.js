"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
const config_js_1 = require("../core/config.js");
const intent_from_ai_js_1 = require("../core/ai/intent-from-ai.js");
const intent_parser_js_1 = require("../core/intent-parser.js");
const log_store_js_1 = require("../core/log-store.js");
const router_js_1 = require("../core/router.js");
const { ensurePlaywrightChromium, getPlaywrightRuntimeStatus } = require("../lib/playwright-runtime");
function loadPackageMeta() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "..", "package.json"),
        node_path_1.default.resolve(__dirname, "..", "..", "package.json")
    ];
    for (const candidate of candidates) {
        try {
            return JSON.parse((0, node_fs_1.readFileSync)(candidate, "utf8"));
        }
        catch {
            // try next candidate
        }
    }
    return {};
}
const packageMeta = loadPackageMeta();
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
async function prompt(question) {
    const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    try {
        return (await rl.question(question)).trim();
    }
    finally {
        rl.close();
    }
}
function normalizeDefaultApi(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "instagram")
        return "instagram";
    if (value === "whatsapp")
        return "whatsapp";
    return "facebook";
}
function normalizeAiProvider(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "openrouter")
        return "openrouter";
    if (value === "xai" || value === "grok")
        return "xai";
    if (value === "openai")
        return "openai";
    return "ollama";
}
function defaultModelForProvider(provider) {
    if (provider === "openrouter")
        return "openai/gpt-4o-mini";
    if (provider === "xai")
        return "grok-2-latest";
    if (provider === "openai")
        return "gpt-4o-mini";
    return "qwen2.5:7b";
}
function defaultBaseUrlForProvider(provider) {
    if (provider === "openrouter")
        return "https://openrouter.ai/api/v1";
    if (provider === "xai")
        return "https://api.x.ai/v1";
    if (provider === "openai")
        return "https://api.openai.com/v1";
    return "http://127.0.0.1:11434";
}
function envApiKeyForProvider(provider) {
    if (provider === "openrouter") {
        return process.env.SOCIAL_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
    }
    if (provider === "xai") {
        return process.env.SOCIAL_XAI_API_KEY || process.env.XAI_API_KEY || "";
    }
    if (provider === "openai") {
        return process.env.SOCIAL_AI_API_KEY || process.env.OPENAI_API_KEY || "";
    }
    return "";
}
function serializeBrowserRuntime(runtime, extra = {}) {
    return {
        ready: Boolean(runtime.packageInstalled && runtime.chromiumInstalled),
        package_installed: Boolean(runtime.packageInstalled),
        chromium_installed: Boolean(runtime.chromiumInstalled),
        executable_path: runtime.executablePath || null,
        install_command: runtime.installCommand || "npx playwright install chromium",
        ...(runtime.error ? { error: runtime.error } : {}),
        ...extra
    };
}
const program = new commander_1.Command();
program
    .name("social")
    .description(packageMeta.description || "Deterministic Social Flow")
    .version(packageMeta.version || "0.0.0");
program
    .command("onboard")
    .alias("setup")
    .description("Initialize ~/.social-flow/config.json and browser runtime")
    .option("--skip-browser", "skip automatic Chromium provisioning", false)
    .action(async (opts) => {
    const cfg = await (0, config_js_1.readConfig)();
    const defaultApi = normalizeDefaultApi((await prompt(`Default API [${cfg.defaultApi || "facebook"}]: `)) || cfg.defaultApi || "facebook");
    cfg.defaultApi = defaultApi;
    cfg.token = await prompt(`${defaultApi} token: `);
    cfg.graphVersion = (await prompt("Graph version [v20.0]: ")) || "v20.0";
    const scopes = await prompt("Scopes CSV: ");
    cfg.scopes = scopes.split(",").map((x) => x.trim()).filter(Boolean);
    cfg.defaultPageId = (await prompt("Default page ID (optional): ")) || undefined;
    cfg.defaultAdAccountId = (await prompt("Default ad account ID (optional): ")) || undefined;
    const currentProvider = normalizeAiProvider(cfg.ai?.provider || "ollama");
    const aiProvider = normalizeAiProvider((await prompt(`AI provider [${currentProvider}] (ollama|openai|openrouter|xai): `)) || currentProvider);
    const aiModelDefault = cfg.ai?.model || defaultModelForProvider(aiProvider);
    const aiBaseDefault = cfg.ai?.baseUrl || defaultBaseUrlForProvider(aiProvider);
    const aiModel = await prompt(`AI model (optional, default ${aiModelDefault}): `);
    const aiBase = await prompt(`AI base URL (optional, default ${aiBaseDefault}): `);
    const aiKey = await prompt("AI API key (optional, leave blank to use env var): ");
    cfg.ai = {
        provider: aiProvider,
        model: aiModel || aiModelDefault,
        baseUrl: aiBase || aiBaseDefault,
        apiKey: aiKey || ""
    };
    await (0, config_js_1.writeConfig)(cfg);
    let browserRuntime = serializeBrowserRuntime(getPlaywrightRuntimeStatus(), {
        skipped: Boolean(opts.skipBrowser)
    });
    if (!opts.skipBrowser) {
        const provisioned = await ensurePlaywrightChromium({
            stdio: process.stdout.isTTY ? "inherit" : "pipe"
        });
        browserRuntime = serializeBrowserRuntime(getPlaywrightRuntimeStatus(), {
            installed_now: Boolean(provisioned.installed)
        });
    }
    printJson({
        ok: true,
        path: await (0, config_js_1.configPath)(),
        browser_runtime: browserRuntime
    });
});
program
    .command("doctor")
    .description("Validate local setup")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    const issues = [];
    const browserRuntime = getPlaywrightRuntimeStatus();
    if (!cfg.token || cfg.token.length < 20)
        issues.push("Token missing/invalid");
    if (!cfg.graphVersion)
        issues.push("Graph version missing");
    if (!Array.isArray(cfg.scopes))
        issues.push("Scopes missing");
    if (!browserRuntime.packageInstalled)
        issues.push("Playwright package missing");
    else if (!browserRuntime.chromiumInstalled)
        issues.push(`Chromium runtime missing (${browserRuntime.installCommand})`);
    printJson({
        ok: issues.length === 0,
        issues,
        active_profile: cfg.activeProfile || "default",
        default_api: cfg.defaultApi || "facebook",
        config_path: cfg.configPath || await (0, config_js_1.configPath)(),
        browser_runtime: serializeBrowserRuntime(browserRuntime)
    });
});
program
    .command("status")
    .description("Show non-sensitive status")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    const browserRuntime = getPlaywrightRuntimeStatus();
    printJson({
        token_set: !!cfg.token,
        active_profile: cfg.activeProfile || "default",
        default_api: cfg.defaultApi || "facebook",
        configured_api_tokens: Object.fromEntries(Object.entries(cfg.apiTokens || {}).map(([api, token]) => [api, !!String(token || "")])),
        graph_version: cfg.graphVersion,
        scopes: cfg.scopes,
        default_page_id: cfg.defaultPageId || null,
        default_ad_account_id: cfg.defaultAdAccountId || null,
        ai_provider: cfg.ai?.provider || "ollama",
        ai_model: cfg.ai?.model || null,
        ai_base_url: cfg.ai?.baseUrl || null,
        ai_key_set: !!cfg.ai?.apiKey,
        browser_runtime: serializeBrowserRuntime(browserRuntime)
    });
});
program
    .command("config")
    .description("Print config")
    .action(async () => {
    const cfg = await (0, config_js_1.readConfig)();
    printJson(cfg);
});
const profile = program.command("profile").description("Profile commands");
profile
    .command("get")
    .option("--fields <fields>", "fields list", "id,name")
    .action(async (opts) => {
    const intent = {
        action: "get",
        target: "profile",
        params: { fields: opts.fields },
        risk: "LOW"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
const post = program.command("post").description("Post commands");
post
    .command("create")
    .requiredOption("--message <message>", "post message")
    .option("--page-id <id>", "page id")
    .action(async (opts) => {
    const intent = {
        action: "create",
        target: "post",
        params: {
            message: opts.message,
            pageId: opts.pageId || ""
        },
        risk: "MEDIUM"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
const ads = program.command("ads").description("Ads commands");
ads
    .command("list")
    .option("--account <id>", "ad account id")
    .action(async (opts) => {
    const intent = {
        action: "list",
        target: "ads",
        params: { adAccountId: opts.account || "" },
        risk: "LOW"
    };
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson(result.data);
});
program
    .command("logs")
    .description("List execution logs")
    .action(async () => {
    const logs = await (0, log_store_js_1.listLogs)();
    printJson(logs);
});
program
    .command("replay")
    .description("Replay a logged action")
    .argument("<id>", "log id")
    .action(async (id) => {
    const log = await (0, log_store_js_1.readLogById)(id);
    const actionParts = String(log.action).split(":");
    const action = actionParts[0];
    const target = actionParts[1];
    const risk = action === "create" ? "MEDIUM" : "LOW";
    const intent = {
        action,
        target,
        params: log.params,
        risk
    };
    const result = await (0, router_js_1.routeIntent)(intent, { replay: true });
    printJson({ replayed: id, data: result.data });
});
program
    .command("ai")
    .description("Natural language interface (deterministic or AI-assisted)")
    .argument("<intent...>", "intent text")
    .option("--provider <provider>", "deterministic|ollama|openai|openrouter|xai", "deterministic")
    .option("--model <model>", "AI model name")
    .option("--base-url <url>", "AI base URL")
    .option("--api-key <key>", "API key for openai-compatible providers")
    .option("--no-fallback-deterministic", "disable deterministic fallback if AI parsing fails")
    .action(async (parts, opts) => {
    const text = parts.join(" ");
    const cfg = await (0, config_js_1.readConfig)();
    const provider = opts.provider || "deterministic";
    const resolvedProvider = provider === "deterministic" ? "ollama" : normalizeAiProvider(provider);
    const model = opts.model || cfg.ai?.model || defaultModelForProvider(resolvedProvider);
    const baseUrl = opts.baseUrl ||
        process.env.SOCIAL_AI_BASE_URL ||
        cfg.ai?.baseUrl ||
        defaultBaseUrlForProvider(resolvedProvider);
    const apiKey = opts.apiKey || envApiKeyForProvider(resolvedProvider) || cfg.ai?.apiKey || "";
    let intent;
    if (provider === "deterministic") {
        intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)(text);
    }
    else {
        try {
            intent = await (0, intent_from_ai_js_1.parseIntentWithAi)(text, {
                provider: resolvedProvider,
                model,
                baseUrl,
                apiKey
            });
        }
        catch (err) {
            if (!opts.fallbackDeterministic)
                throw err;
            intent = (0, intent_parser_js_1.parseNaturalLanguageToIntent)(text);
        }
    }
    const result = await (0, router_js_1.routeIntent)(intent);
    printJson({
        provider,
        model,
        base_url: baseUrl,
        fallback_deterministic: opts.fallbackDeterministic,
        intent,
        data: result.data
    });
});
async function main() {
    await program.parseAsync(process.argv);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(String(err?.stack || err));
    process.exitCode = 1;
});

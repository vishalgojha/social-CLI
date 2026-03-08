import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { configPath, readConfig, writeConfig } from "../core/config.js";
import { parseIntentWithAi } from "../core/ai/intent-from-ai.js";
import { parseNaturalLanguageToIntent } from "../core/intent-parser.js";
import { listLogs, readLogById } from "../core/log-store.js";
import { routeIntent } from "../core/router.js";
import type { AiProvider, ApiName, Intent } from "../core/types.js";

const { ensurePlaywrightChromium, getPlaywrightRuntimeStatus } = require("../lib/playwright-runtime");

function loadPackageMeta(): { version?: string; description?: string } {
  const candidates = [
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(__dirname, "..", "..", "package.json")
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as { version?: string; description?: string };
    } catch {
      // try next candidate
    }
  }

  return {};
}

const packageMeta = loadPackageMeta();

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function normalizeDefaultApi(raw: string): ApiName {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "instagram") return "instagram";
  if (value === "whatsapp") return "whatsapp";
  return "facebook";
}

function normalizeAiProvider(raw: string): AiProvider {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "openrouter") return "openrouter";
  if (value === "xai" || value === "grok") return "xai";
  if (value === "openai") return "openai";
  return "ollama";
}

function defaultModelForProvider(provider: AiProvider): string {
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  if (provider === "xai") return "grok-2-latest";
  if (provider === "openai") return "gpt-4o-mini";
  return "qwen2.5:7b";
}

function defaultBaseUrlForProvider(provider: AiProvider): string {
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (provider === "xai") return "https://api.x.ai/v1";
  if (provider === "openai") return "https://api.openai.com/v1";
  return "http://127.0.0.1:11434";
}

function envApiKeyForProvider(provider: AiProvider): string {
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

function serializeBrowserRuntime(
  runtime: {
    packageInstalled?: boolean;
    chromiumInstalled?: boolean;
    executablePath?: string;
    installCommand?: string;
    error?: string;
  },
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
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

const program = new Command();

program
  .name("social")
  .description(packageMeta.description || "Deterministic Social Flow")
  .version(packageMeta.version || "0.0.0");

program
  .command("onboard")
  .alias("setup")
  .description("Initialize ~/.social-flow/config.json and browser runtime")
  .option("--skip-browser", "skip automatic Chromium provisioning", false)
  .action(async (opts: { skipBrowser?: boolean }) => {
    const cfg = await readConfig();
    const defaultApi = normalizeDefaultApi(
      (await prompt(`Default API [${cfg.defaultApi || "facebook"}]: `)) || cfg.defaultApi || "facebook"
    );
    cfg.defaultApi = defaultApi;
    cfg.token = await prompt(`${defaultApi} token: `);
    cfg.graphVersion = (await prompt("Graph version [v20.0]: ")) || "v20.0";
    const scopes = await prompt("Scopes CSV: ");
    cfg.scopes = scopes.split(",").map((x) => x.trim()).filter(Boolean);
    cfg.defaultPageId = (await prompt("Default page ID (optional): ")) || undefined;
    cfg.defaultAdAccountId = (await prompt("Default ad account ID (optional): ")) || undefined;
    const currentProvider = normalizeAiProvider(cfg.ai?.provider || "ollama");
    const aiProvider = normalizeAiProvider(
      (await prompt(`AI provider [${currentProvider}] (ollama|openai|openrouter|xai): `)) || currentProvider
    );
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
    await writeConfig(cfg);
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
      path: await configPath(),
      browser_runtime: browserRuntime
    });
  });

program
  .command("doctor")
  .description("Validate local setup")
  .action(async () => {
    const cfg = await readConfig();
    const issues: string[] = [];
    const browserRuntime = getPlaywrightRuntimeStatus();
    if (!cfg.token || cfg.token.length < 20) issues.push("Token missing/invalid");
    if (!cfg.graphVersion) issues.push("Graph version missing");
    if (!Array.isArray(cfg.scopes)) issues.push("Scopes missing");
    if (!browserRuntime.packageInstalled) issues.push("Playwright package missing");
    else if (!browserRuntime.chromiumInstalled) issues.push(`Chromium runtime missing (${browserRuntime.installCommand})`);
    printJson({
      ok: issues.length === 0,
      issues,
      active_profile: cfg.activeProfile || "default",
      default_api: cfg.defaultApi || "facebook",
      config_path: cfg.configPath || await configPath(),
      browser_runtime: serializeBrowserRuntime(browserRuntime)
    });
  });

program
  .command("status")
  .description("Show non-sensitive status")
  .action(async () => {
    const cfg = await readConfig();
    const browserRuntime = getPlaywrightRuntimeStatus();
    printJson({
      token_set: !!cfg.token,
      active_profile: cfg.activeProfile || "default",
      default_api: cfg.defaultApi || "facebook",
      configured_api_tokens: Object.fromEntries(
        Object.entries(cfg.apiTokens || {}).map(([api, token]) => [api, !!String(token || "")])
      ),
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
    const cfg = await readConfig();
    printJson(cfg);
  });

const profile = program.command("profile").description("Profile commands");
profile
  .command("get")
  .option("--fields <fields>", "fields list", "id,name")
  .action(async (opts: { fields: string }) => {
    const intent: Intent = {
      action: "get",
      target: "profile",
      params: { fields: opts.fields },
      risk: "LOW"
    };
    const result = await routeIntent(intent);
    printJson(result.data);
  });

const post = program.command("post").description("Post commands");
post
  .command("create")
  .requiredOption("--message <message>", "post message")
  .option("--page-id <id>", "page id")
  .action(async (opts: { message: string; pageId?: string }) => {
    const intent: Intent = {
      action: "create",
      target: "post",
      params: {
        message: opts.message,
        pageId: opts.pageId || ""
      },
      risk: "MEDIUM"
    };
    const result = await routeIntent(intent);
    printJson(result.data);
  });

const ads = program.command("ads").description("Ads commands");
ads
  .command("list")
  .option("--account <id>", "ad account id")
  .action(async (opts: { account?: string }) => {
    const intent: Intent = {
      action: "list",
      target: "ads",
      params: { adAccountId: opts.account || "" },
      risk: "LOW"
    };
    const result = await routeIntent(intent);
    printJson(result.data);
  });

program
  .command("logs")
  .description("List execution logs")
  .action(async () => {
    const logs = await listLogs();
    printJson(logs);
  });

program
  .command("replay")
  .description("Replay a logged action")
  .argument("<id>", "log id")
  .action(async (id: string) => {
    const log = await readLogById(id);
    const actionParts = String(log.action).split(":");
    const action = actionParts[0] as Intent["action"];
    const target = actionParts[1] as Intent["target"];
    const risk = action === "create" ? "MEDIUM" : "LOW";
    const intent: Intent = {
      action,
      target,
      params: log.params,
      risk
    };
    const result = await routeIntent(intent, { replay: true });
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
  .action(async (
    parts: string[],
    opts: {
      provider: "deterministic" | AiProvider;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      fallbackDeterministic: boolean;
    }
  ) => {
    const text = parts.join(" ");
    const cfg = await readConfig();
    const provider = opts.provider || "deterministic";
    const resolvedProvider = provider === "deterministic" ? "ollama" : normalizeAiProvider(provider);
    const model = opts.model || cfg.ai?.model || defaultModelForProvider(resolvedProvider);
    const baseUrl =
      opts.baseUrl ||
      process.env.SOCIAL_AI_BASE_URL ||
      cfg.ai?.baseUrl ||
      defaultBaseUrlForProvider(resolvedProvider);
    const apiKey = opts.apiKey || envApiKeyForProvider(resolvedProvider) || cfg.ai?.apiKey || "";

    let intent: Intent;
    if (provider === "deterministic") {
      intent = parseNaturalLanguageToIntent(text);
    } else {
      try {
        intent = await parseIntentWithAi(text, {
          provider: resolvedProvider,
          model,
          baseUrl,
          apiKey
        });
      } catch (err) {
        if (!opts.fallbackDeterministic) throw err;
        intent = parseNaturalLanguageToIntent(text);
      }
    }
    const result = await routeIntent(intent);
    printJson({
      provider,
      model,
      base_url: baseUrl,
      fallback_deterministic: opts.fallbackDeterministic,
      intent,
      data: result.data
    });
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String((err as Error)?.stack || err));
  process.exitCode = 1;
});

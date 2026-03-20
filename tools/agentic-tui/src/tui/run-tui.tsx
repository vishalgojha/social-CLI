import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Select } from "@inkjs/ui";
import TextInput from "ink-text-input";

import { getExecutor } from "../executors/registry.js";
import { applySlotEdits, parseNaturalLanguageWithOptionalAi } from "../parser/intent-parser.js";
import { INITIAL_STATE, reducer } from "../state/machine.js";
import type { ActionQueueItem, ExecutionResult, LogEntry, ParsedIntent } from "../types.js";
import { ThemeProvider, useTheme } from "../ui/theme.js";
import { handleSlashCommand } from "./tui-command-handlers.js";
import { handleShortcut } from "./tui-event-handlers.js";
import { buildActionBarHint } from "./action-bar.js";
import {
  detectAuthAssist,
  maskCommandSecrets,
  parseAuthApiChoice,
  rewriteStudioShorthand,
  type AuthApi
} from "./command-assist.js";
import { detectDomainSkill } from "./domain-skills.js";
import {
  accountOptionsFromConfig,
  loadConfigSnapshot,
  loadHatchMemory,
  loadPersistedLogs,
  saveHatchMemory
} from "./tui-session-actions.js";
import type {
  ChatTurn,
  ConfigSnapshot,
  HatchMemorySnapshot,
  LoadState,
  MemoryIntentRecord,
  MemoryUnresolvedRecord,
  PersistedLog
} from "./tui-types.js";

function newLog(level: LogEntry["level"], message: string): LogEntry {
  return { at: new Date().toISOString(), level, message };
}

function newTurn(role: ChatTurn["role"], text: string): ChatTurn {
  return {
    id: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    role,
    text
  };
}

function queueItem(action: ActionQueueItem["action"], params: Record<string, string>): ActionQueueItem {
  return {
    id: `aq_${Date.now().toString(36)}`,
    action,
    params,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
}

function shortTime(iso: string): string {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toISOString().slice(11, 19);
}

function logLevelColor(level: LogEntry["level"]): "cyan" | "yellow" | "red" | "green" {
  if (level === "WARN") return "yellow";
  if (level === "ERROR") return "red";
  if (level === "SUCCESS") return "green";
  return "cyan";
}

function logLevelGlyph(level: LogEntry["level"]): string {
  if (level === "WARN") return "!";
  if (level === "ERROR") return "x";
  if (level === "SUCCESS") return "ok";
  return "i";
}

function roleGlyph(role: ChatTurn["role"]): string {
  if (role === "user") return "you";
  if (role === "assistant") return "agent";
  return "sys";
}

function apiLabel(api: AuthApi): string {
  if (api === "whatsapp") return "WhatsApp";
  return `${api.charAt(0).toUpperCase()}${api.slice(1)}`;
}

function buildTokenPrompt(api: AuthApi, intro?: string): string {
  const label = apiLabel(api);
  const prefix = intro ? `${intro} ` : "";
  const base = `${prefix}Paste your ${label} access token now. I will hide it in chat logs. Type \`cancel\` to stop.`;
  if (api !== "whatsapp") return base;
  return `${base} Copy it from Meta App Dashboard -> WhatsApp -> API Setup. Troubleshooting: if "Generate access token" is missing, ensure WhatsApp is added to your app and you are in the correct app.`;
}

function SectionHeading(props: { label: string }): JSX.Element {
  const theme = useTheme();
  const rule = "─".repeat(Math.max(12, 74 - String(props.label || "").length));
  return (
    <Box>
      <Text color={theme.success}>◇</Text>
      <Text color={theme.accent} bold>{` ${props.label} `}</Text>
      <Text color={theme.muted}>{rule}</Text>
    </Box>
  );
}

function FramedBlock(props: {
  title: string;
  children: React.ReactNode;
  borderColor?: string;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box
      marginTop={1}
      paddingX={1}
      borderStyle="single"
      borderColor={props.borderColor || theme.muted}
      flexDirection="column"
    >
      <Text color={theme.accent} bold>{props.title}</Text>
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
    </Box>
  );
}

function newSessionId(): string {
  return `hatch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function shortText(text: string, limit = 120): string {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

function looksLikeCancelWord(input: string): boolean {
  const text = String(input || "").trim().toLowerCase();
  return text === "cancel" || text === "stop" || text === "abort" || text === "exit";
}

function looksLikeGreetingOnly(input: string): boolean {
  const text = String(input || "").trim().toLowerCase().replace(/[!?.]+$/g, "").trim();
  return /^(hi|hello|hey|yo|hola|good morning|good evening|good afternoon)(\s+[a-z]{2,20})?$/.test(text);
}

function extractProfileName(input: string): string {
  const raw = String(input || "").trim();
  const match = raw.match(/\b(?:my name is|i am|i'm|call me)\s+([a-z][a-z '\-]{1,40})$/i);
  if (!match?.[1]) return "";
  const normalized = match[1]
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z '\-]/gi, "")
    .trim();
  if (!normalized) return "";
  return normalized
    .split(" ")
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function asksForRememberedName(input: string): boolean {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("what is my name")
    || text.includes("what's my name")
    || text.includes("do you remember my name")
    || text.includes("remember my name")
  );
}

type ChatReplyAiProvider = "openai" | "openrouter" | "xai" | "ollama";

type ChatReplyAiConfig = {
  enabled: boolean;
  provider: ChatReplyAiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
};

type ConversationalReplyInput = {
  userText: string;
  fallback: string;
  mode: "chat" | "result";
  intentAction?: string;
  intentRisk?: string | null;
  executionOk?: boolean | null;
  profileName?: string;
  lastIntents?: MemoryIntentRecord[];
  unresolved?: MemoryUnresolvedRecord[];
};

function resolveChatReplyAiConfig(): ChatReplyAiConfig {
  const aiEnabled = !/^(0|false|off|no)$/i.test(String(process.env.SOCIAL_TUI_CHAT_REPLY_AI || "1"));
  const rawProvider = String(process.env.SOCIAL_TUI_AI_VENDOR || process.env.SOCIAL_TUI_AI_PROVIDER || "openai")
    .trim()
    .toLowerCase();
  const provider: ChatReplyAiProvider = rawProvider === "openrouter"
    ? "openrouter"
    : rawProvider === "xai" || rawProvider === "grok"
      ? "xai"
      : rawProvider === "ollama"
        ? "ollama"
        : "openai";

  const model = String(process.env.SOCIAL_TUI_AI_MODEL || (
    provider === "openrouter"
      ? "openai/gpt-4o-mini"
      : provider === "xai"
        ? "grok-2-latest"
        : provider === "ollama"
          ? "qwen2.5:7b"
          : "gpt-4o-mini"
  )).trim();

  const baseUrl = String(process.env.SOCIAL_TUI_AI_BASE_URL || (
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : provider === "xai"
        ? "https://api.x.ai/v1"
        : provider === "ollama"
          ? "http://127.0.0.1:11434"
          : "https://api.openai.com/v1"
  )).trim();

  const apiKey = String(
    process.env.SOCIAL_TUI_AI_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.OPENROUTER_API_KEY
    || process.env.XAI_API_KEY
    || ""
  ).trim();

  const hasKey = provider === "ollama" ? true : Boolean(apiKey);
  return {
    enabled: aiEnabled && hasKey && Boolean(model) && Boolean(baseUrl),
    provider,
    model,
    baseUrl,
    apiKey
  };
}

function extractOpenAiCompatibleContent(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    }).join(" ").trim();
  }
  const fallback = first.text;
  return typeof fallback === "string" ? fallback.trim() : "";
}

async function callConversationalAi(cfg: ChatReplyAiConfig, messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1200, Number.parseInt(process.env.SOCIAL_TUI_CHAT_REPLY_TIMEOUT_MS || "3500", 10) || 3500);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (cfg.provider === "ollama") {
      const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          stream: false,
          messages,
          options: { temperature: 0.4 }
        }),
        signal: controller.signal
      });
      if (!response.ok) return "";
      const data = await response.json() as { message?: { content?: string } };
      return String(data?.message?.content || "").trim();
    }

    const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        max_tokens: 180,
        messages
      }),
      signal: controller.signal
    });
    if (!response.ok) return "";
    const data = await response.json();
    return extractOpenAiCompatibleContent(data);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeConversationalReply(value: string, fallback: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  if (text.length > 320) return `${text.slice(0, 317)}...`;
  return text;
}

async function generateConversationalReply(input: ConversationalReplyInput): Promise<string> {
  if (input.mode === "result" || input.intentAction === "run_cli") return input.fallback;
  const cfg = resolveChatReplyAiConfig();
  if (!cfg.enabled) return input.fallback;

  const recentIntents = Array.isArray(input.lastIntents)
    ? input.lastIntents.map((x) => `${x.action}:${x.text}`).slice(0, 3).join(" | ")
    : "";
  const unresolved = Array.isArray(input.unresolved)
    ? input.unresolved.map((x) => x.text).slice(0, 3).join(" | ")
    : "";

  const system = [
    "You are Hatch, the conversational assistant for Social Flow.",
    "Style: natural, concise, human; max 2 short sentences.",
    "Guardrails: never claim an action ran unless this session executed it.",
    "If execution failed, acknowledge clearly and suggest one concrete next command in backticks.",
    "If intent is unclear, ask one clarifying question.",
    "Avoid robotic diagnostics wording unless user asks for diagnostics."
  ].join(" ");

  const context = [
    `mode=${input.mode}`,
    `intent_action=${input.intentAction || "none"}`,
    `intent_risk=${input.intentRisk || "none"}`,
    `execution_ok=${input.executionOk === null || input.executionOk === undefined ? "none" : String(input.executionOk)}`,
    `profile_name=${input.profileName || ""}`,
    `recent_intents=${recentIntents || "none"}`,
    `open_items=${unresolved || "none"}`,
    `fallback=${input.fallback}`
  ].join("\n");

  const result = await callConversationalAi(cfg, [
    { role: "system", content: system },
    { role: "user", content: `${context}\n\nUser input: ${input.userText}` }
  ]);

  return sanitizeConversationalReply(result, input.fallback);
}

function summarizeIntent(intent: ParsedIntent, risk: string, missing: string[]): string {
  const slots = Object.entries(intent.params)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `Plan ready: action=${intent.action}, risk=${risk}${slots ? `, slots: ${slots}` : ""}${missing.length ? `, missing: ${missing.join(", ")}` : ""}`;
}

function formatToolCall(intent: ParsedIntent): string {
  const args = Object.entries(intent.params || {})
    .filter(([, value]) => String(value || "").trim().length > 0)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(", ");
  return `tool_call: ${intent.action}(${args})`;
}

function describeAction(action: ParsedIntent["action"]): string {
  if (action === "guide") return "run a guided setup path";
  if (action === "help") return "show available capabilities";
  if (action === "run_cli") return "execute the exact social CLI command you typed";
  if (action === "doctor") return "run diagnostics";
  if (action === "status" || action === "get_status") return "check runtime status";
  if (action === "config") return "show sanitized config";
  if (action === "logs") return "fetch recent logs";
  if (action === "replay") return "replay a previous action";
  if (action === "get_profile") return "get profile information";
  if (action === "create_post") return "create a post draft/publish flow";
  if (action === "list_ads") return "list ad account data";
  return "process that request";
}

function isSetupOrAuthError(errorText: string): boolean {
  const msg = String(errorText || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("token") ||
    msg.includes("auth") ||
    msg.includes("oauth") ||
    msg.includes("permission") ||
    msg.includes("unauthorized") ||
    msg.includes("access denied") ||
    msg.includes("forbidden") ||
    msg.includes("login")
  );
}

function summarizeExecutionForChat(intent: ParsedIntent, result: ExecutionResult): string {
  const output = (result.output || {}) as Record<string, unknown>;

  if (!result.ok) {
    const error = String(output.error || "").trim();
    if (intent.action === "run_cli") {
      const code = Number(output.exit_code);
      const command = String(output.command || "").trim().toLowerCase();
      const suggestion = String(output.suggestion || "").trim();
      const suffix = Number.isFinite(code) && code >= 0 ? ` (${code})` : "";
      if (error.toLowerCase().includes("unknown command 'tokens'")) {
        return "There is no `social tokens` command. Try `social auth status`.";
      }
      if (command === "social auth") {
        return "Use `social auth login`, `social auth status`, or `social auth logout -a all`.";
      }
      if (error.toLowerCase().includes("display help for command") && command.startsWith("social auth")) {
        return "For auth, start with `social auth login` and I will guide the rest.";
      }
      if (suggestion) {
        return `social command failed${suffix}: ${shortText(error, 150)} Try: \`${suggestion}\``;
      }
      return error
        ? `social command failed${suffix}: ${shortText(error, 180)}`
        : `social command failed${suffix}.`;
    }
    const setupIssue = isSetupOrAuthError(error);
    if (intent.action === "unknown") {
      return "I didn't fully understand that yet. Try `what can you do`, `status`, or `/help`.";
    }
    if (intent.action === "get_profile") {
      if (setupIssue) {
        return "I can't identify your profile yet because Facebook auth is not fully set up. Run `social setup`, then try `whoami` again.";
      }
      return error ? `I couldn't fetch your profile yet: ${error}` : "I couldn't fetch your profile yet. Try `status` or `social setup`.";
    }
    if (intent.action === "create_post" || intent.action === "list_ads") {
      if (setupIssue) {
        return "This workspace is not fully connected yet. Run `social setup` and try again.";
      }
    }
    return error ? `I couldn't finish that yet: ${error}` : "I couldn't finish that request yet.";
  }

  if (intent.action === "guide") {
    const label = String(output.label || output.topic || "Setup");
    const message = String(output.message || "").trim();
    const suggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((x) => String(x)).filter(Boolean).slice(0, 3)
      : [];
    return suggestions.length
      ? `${label}: ${shortText(message || "I can guide this flow.", 120)} Next: ${suggestions.map((x) => `\`${x}\``).join(" | ")}`
      : `${label}: ${shortText(message || "Guidance is ready.", 140)}`;
  }

  if (intent.action === "help") {
    const suggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((x) => String(x)).filter(Boolean).slice(0, 4)
      : [];
    return suggestions.length
      ? `Hey, I can help with setup, status, profiles, posts, ads, logs, and replay. Try: ${suggestions.join(" | ")}`
      : "Hey, I can help with setup, status, profiles, posts, ads, logs, and replay.";
  }

  if (intent.action === "run_cli") {
    const command = String(output.command || "social ...").trim();
    const stdout = String(output.stdout || "").trim();
    if (stdout) {
      const preview = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");
      return preview ? `Executed \`${command}\`: ${shortText(preview, 220)}` : `Executed \`${command}\`.`;
    }
    return `Executed \`${command}\` successfully.`;
  }

  if (intent.action === "status" || intent.action === "get_status") {
    const tokenSet = Boolean(output.token_set);
    return tokenSet
      ? "Hey, I'm online and your workspace looks connected."
      : "Hey, I'm online. Setup is incomplete, so some actions may fail until you run `social setup`.";
  }

  if (intent.action === "doctor") {
    const ok = Boolean(output.ok);
    const issues = Array.isArray(output.issues)
      ? output.issues.map((x) => String(x)).filter(Boolean).slice(0, 3)
      : [];
    if (ok) return "I ran a quick diagnostics check. Everything looks good.";
    return issues.length
      ? `I ran diagnostics and found: ${issues.join("; ")}.`
      : "I ran diagnostics and found issues. Try `social setup` and then `status`.";
  }

  if (intent.action === "logs") {
    const count = Number(output.count || 0);
    return `I pulled the logs. Entries available: ${Number.isFinite(count) ? count : 0}.`;
  }

  if (intent.action === "create_post") {
    return "Done. I processed your post request.";
  }

  if (intent.action === "get_profile") {
    return "Done. I pulled your profile details.";
  }

  if (intent.action === "list_ads") {
    return "Done. I pulled your ad account listing.";
  }

  return "Done. Action completed successfully.";
}

function explainPlan(intent: ParsedIntent | null, risk: string | null): string {
  if (!intent) return "No active plan yet. Send a request first.";
  const actionReason: Record<string, string> = {
    guide: "You asked for guided setup or next steps in a specific domain.",
    run_cli: "You entered an explicit `social ...` command, so it is executed directly.",
    doctor: "You asked for health/setup validation.",
    status: "You asked for a quick account/system status snapshot.",
    config: "You asked to inspect current non-sensitive config.",
    logs: "You asked to inspect recent execution logs.",
    replay: "You asked to re-run a previous action.",
    get_profile: "You asked for profile/account identity data.",
    list_ads: "You asked for ads listing/visibility.",
    create_post: "You asked to publish content."
  };
  return [
    `Why this plan: ${actionReason[intent.action] || "This is the closest safe action for your request."}`,
    `Risk rationale: ${risk || "UNKNOWN"}${risk === "HIGH" ? " actions need elevated approval with reason." : risk === "MEDIUM" ? " actions require explicit confirm." : " actions auto-run."}`,
    `Parameters: ${Object.entries(intent.params).filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`
  ].join(" ");
}

const AUTO_EXECUTE_CONFIDENCE_THRESHOLD = Math.min(
  0.98,
  Math.max(0.5, Number.parseFloat(process.env.SOCIAL_TUI_AUTO_EXECUTE_CONFIDENCE || "0.82") || 0.82)
);

function formatConfidence(confidence: number | null | undefined): string {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "--";
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function shouldRequireIntentConfirmation(confidence: number | undefined, action: ParsedIntent["action"]): boolean {
  if (action === "unknown") return true;
  if (action === "run_cli") return false;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return true;
  return confidence < AUTO_EXECUTE_CONFIDENCE_THRESHOLD;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function RunTui(): JSX.Element {
  return (
    <ThemeProvider>
      <HatchRuntime />
    </ThemeProvider>
  );
}

type HatchMemoryState = {
  loaded: boolean;
  sessionId: string;
  profileName: string;
  lastIntents: MemoryIntentRecord[];
  unresolved: MemoryUnresolvedRecord[];
};

type PendingFlowState =
  | { kind: "auth_login"; stage: "choose_api" }
  | { kind: "auth_login"; stage: "await_token"; api: AuthApi };

function HatchRuntime(): JSX.Element {
  const theme = useTheme();
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([
    newTurn("system", "Wake up, Social Flow."),
    newTurn("assistant", "I am online. Tell me what you want to connect, check, or run.")
  ]);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("default");
  const [replaySuggestionIndex, setReplaySuggestionIndex] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [memory, setMemory] = useState<HatchMemoryState>({
    loaded: false,
    sessionId: newSessionId(),
    profileName: "",
    lastIntents: [],
    unresolved: []
  });
  const [pendingFlow, setPendingFlow] = useState<PendingFlowState | null>(null);

  const [configState, setConfigState] = useState<LoadState<ConfigSnapshot | null>>({
    loading: true,
    error: null,
    data: null
  });
  const [logsState, setLogsState] = useState<LoadState<PersistedLog[]>>({
    loading: true,
    error: null,
    data: []
  });

  const addTurn = useCallback((role: ChatTurn["role"], text: string) => {
    setChatTurns((prev) => [...prev.slice(-79), newTurn(role, text)]);
  }, []);

  const rememberIntent = useCallback((text: string, action: ParsedIntent["action"]) => {
    const entry: MemoryIntentRecord = {
      at: new Date().toISOString(),
      text: shortText(text, 160),
      action
    };
    setMemory((prev) => ({
      ...prev,
      lastIntents: [entry, ...prev.lastIntents].slice(0, 3)
    }));
  }, []);

  const rememberUnresolved = useCallback((text: string, reason: string) => {
    const entry: MemoryUnresolvedRecord = {
      at: new Date().toISOString(),
      text: shortText(text, 180),
      reason
    };
    setMemory((prev) => ({
      ...prev,
      unresolved: [entry, ...prev.unresolved].slice(0, 6)
    }));
  }, []);

  const streamAssistantTurn = useCallback(async (text: string) => {
    const full = String(text || "");
    const turn = newTurn("assistant", "");
    setChatTurns((prev) => [...prev.slice(-79), turn]);
    if (!full) return;

    const disableStreaming = /^(1|true|yes|on)$/i.test(String(process.env.SOCIAL_TUI_DISABLE_STREAM || ""));
    if (disableStreaming || full.length <= 8) {
      setChatTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, text: full } : x)));
      return;
    }

    const delayMs = Math.max(0, Number.parseInt(process.env.SOCIAL_TUI_STREAM_DELAY_MS || "2", 10) || 2);
    const step = full.length > 260 ? 9 : full.length > 160 ? 6 : full.length > 90 ? 4 : 2;
    for (let i = step; i < full.length; i += step) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
      setChatTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, text: full.slice(0, i) } : x)));
    }
    setChatTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, text: full } : x)));
  }, []);

  const streamPhase = useCallback(async (label: string, detail?: string) => {
    await streamAssistantTurn(`${label}${detail ? `: ${detail}` : ""}`);
  }, [streamAssistantTurn]);

  const refreshConfig = useCallback(async () => {
    setConfigState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const cfg = await loadConfigSnapshot();
      setConfigState({ loading: false, error: null, data: cfg });
      const options = accountOptionsFromConfig(cfg);
      if (!options.some((x) => x.value === selectedAccount)) {
        setSelectedAccount(options[0]?.value || "default");
      }
    } catch (err) {
      setConfigState({ loading: false, error: String((err as Error)?.message || err), data: null });
    }
  }, [selectedAccount]);

  const refreshLogs = useCallback(async () => {
    setLogsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const logs = await loadPersistedLogs();
      setLogsState({ loading: false, error: null, data: logs });
    } catch (err) {
      setLogsState({ loading: false, error: String((err as Error)?.message || err), data: [] });
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    void refreshLogs();
  }, [refreshConfig, refreshLogs]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshLogs();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshLogs]);

  useEffect(() => {
    let active = true;
    const bootstrapMemory = async () => {
      try {
        const saved = await loadHatchMemory();
        if (!active) return;
        if (saved) {
          setMemory({
            loaded: true,
            sessionId: String(saved.sessionId || "").trim() || newSessionId(),
            profileName: String(saved.profileName || "").trim(),
            lastIntents: Array.isArray(saved.lastIntents) ? saved.lastIntents.slice(0, 3) : [],
            unresolved: Array.isArray(saved.unresolved) ? saved.unresolved.slice(0, 6) : []
          });
          if (Array.isArray(saved.turns) && saved.turns.length > 0) {
            const restoredTurns = saved.turns.slice(-78);
            const welcomeName = String(saved.profileName || "").trim();
            setChatTurns([
              ...restoredTurns,
              newTurn("system", welcomeName ? `Memory restored. Welcome back, ${welcomeName}.` : "Memory restored. Welcome back.")
            ]);
          }
          return;
        }
        setMemory((prev) => ({ ...prev, loaded: true }));
      } catch {
        if (!active) return;
        setMemory((prev) => ({ ...prev, loaded: true }));
      }
    };
    void bootstrapMemory();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!memory.loaded) return;
    const timeout = setTimeout(() => {
      const payload: Omit<HatchMemorySnapshot, "updatedAt"> = {
        sessionId: memory.sessionId,
        profileName: memory.profileName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved,
        turns: chatTurns.slice(-80)
      };
      void saveHatchMemory(payload, {
        profileId: configState.data?.activeProfile,
        sessionId: memory.sessionId
      });
    }, 280);
    return () => clearTimeout(timeout);
  }, [
    chatTurns,
    configState.data?.activeProfile,
    memory.lastIntents,
    memory.loaded,
    memory.profileName,
    memory.sessionId,
    memory.unresolved
  ]);

  const runExecution = useCallback(async (intentOverride?: ParsedIntent): Promise<void> => {
    const intent = intentOverride || state.currentIntent;
    if (!intent) {
      // Defensive reset: avoid getting stuck in EXECUTING if state intent is stale.
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Execution skipped: no active intent.") });
      dispatch({ type: "RESET_FLOW" });
      return;
    }

    const current = queueItem(intent.action, intent.params);
    dispatch({ type: "QUEUE_ADD", item: current });
    dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "RUNNING" });
    dispatch({ type: "MARK_EXECUTING" });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Executing ${intent.action}`) });
    if (state.showDetails) await streamPhase("Executing", intent.action);

    try {
      const executor = getExecutor(intent.action);
      if (state.showDetails) await streamPhase("Validating", "risk gate and required fields");
      const res = await executor.execute(intent);
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: res.ok ? "DONE" : "FAILED" });
      dispatch({ type: "SET_RESULT", result: res.output });
      dispatch({
        type: "LOG_ADD",
        entry: newLog(res.ok ? "SUCCESS" : "ERROR", res.ok ? "Execution completed." : "Execution failed.")
      });
      if (!res.ok) {
        const output = (res.output || {}) as Record<string, unknown>;
        const reason = String(output.error || intent.action || "execution_failed").trim() || "execution_failed";
        rememberUnresolved(`${intent.action}: ${reason}`, "execution_failed");
      }
      if (state.showDetails) {
        await streamAssistantTurn(res.ok ? "Done. I executed that successfully." : "Execution failed. Check logs/results.");
        await streamAssistantTurn(`tool_result: ${intent.action} -> ${res.ok ? "ok" : "failed"}`);
        const summaryKeys = Object.keys(res.output || {}).slice(0, 5);
        await streamAssistantTurn(
          `Execution summary: queue=${current.id}, status=${res.ok ? "success" : "failed"}, output_keys=${summaryKeys.join(", ") || "none"}.`
        );
      } else {
        const fallback = summarizeExecutionForChat(intent, res);
        const reply = await generateConversationalReply({
          userText: intent.action,
          fallback,
          mode: "result",
          intentAction: intent.action,
          intentRisk: state.currentRisk,
          executionOk: res.ok,
          profileName: memory.profileName,
          lastIntents: memory.lastIntents,
          unresolved: memory.unresolved
        });
        await streamAssistantTurn(reply);
      }
      if (res.rollback) {
        dispatch({
          type: "ROLLBACK_ADD",
          item: {
            at: new Date().toISOString(),
            action: intent.action,
            note: res.rollback.note,
            status: res.rollback.status
          }
        });
      }
      void refreshLogs();
      dispatch({ type: "RESET_FLOW" });
    } catch (error) {
      const errorMessage = String((error as Error)?.message || error);
      dispatch({ type: "QUEUE_UPDATE", id: current.id, status: "FAILED" });
      dispatch({ type: "SET_RESULT", result: { ok: false, error: errorMessage } });
      dispatch({ type: "LOG_ADD", entry: newLog("ERROR", `Execution error: ${errorMessage}`) });
      rememberUnresolved(`${intent.action}: ${errorMessage}`, "execution_exception");
      if (state.showDetails) {
        await streamAssistantTurn(`Execution error: ${errorMessage}`);
      } else {
        const fallback = summarizeExecutionForChat(intent, { ok: false, output: { error: errorMessage } });
        const reply = await generateConversationalReply({
          userText: intent.action,
          fallback,
          mode: "result",
          intentAction: intent.action,
          intentRisk: state.currentRisk,
          executionOk: false,
          profileName: memory.profileName,
          lastIntents: memory.lastIntents,
          unresolved: memory.unresolved
        });
        await streamAssistantTurn(reply);
      }
      dispatch({ type: "RESET_FLOW" });
    }
  }, [
    memory.lastIntents,
    memory.profileName,
    memory.unresolved,
    refreshLogs,
    rememberUnresolved,
    state.currentIntent,
    state.currentRisk,
    state.showDetails,
    streamAssistantTurn,
    streamPhase
  ]);

  const executeDirectRunCli = useCallback(async (input: {
    command: string;
    displayText?: string;
    rememberAs?: string;
  }): Promise<void> => {
    const command = String(input.command || "").trim();
    if (!command) return;
    const displayText = String(input.displayText || maskCommandSecrets(command)).trim() || "social ...";
    const intent: ParsedIntent = { action: "run_cli", params: { command } };
    rememberIntent(input.rememberAs || displayText, "run_cli");
    dispatch({
      type: "PARSE_READY",
      intent,
      risk: "LOW",
      missingSlots: [],
      confidence: 1,
      requiresConfirmation: false
    });
    dispatch({ type: "APPROVED", auto: true });
    if (state.showDetails) {
      await streamAssistantTurn(`tool_call: run_cli(command=${JSON.stringify(displayText)})`);
    }
    await runExecution(intent);
  }, [rememberIntent, runExecution, state.showDetails, streamAssistantTurn]);

  const parseAndQueueIntent = useCallback(async (raw: string): Promise<void> => {
    const input = String(raw || "").trim();
    if (!input) return;

    const rewrittenInput = rewriteStudioShorthand(input);
    const isWabaSetupRequest = /^(waba|whatsapp)\s+setup$/i.test(rewrittenInput) || /^setup\s+(waba|whatsapp)$/i.test(rewrittenInput);
    const authAssist = detectAuthAssist(rewrittenInput);

    if (isWabaSetupRequest) {
      addTurn("user", rewrittenInput);
      setPendingFlow({ kind: "auth_login", stage: "await_token", api: "whatsapp" });
      await streamAssistantTurn(buildTokenPrompt("whatsapp", "Let's set up WhatsApp now."));
      return;
    }

    if (pendingFlow?.kind === "auth_login" && pendingFlow.stage === "choose_api") {
      addTurn("user", rewrittenInput);
      if (looksLikeCancelWord(rewrittenInput)) {
        setPendingFlow(null);
        await streamAssistantTurn("Auth setup canceled.");
        return;
      }
      const chosenApi = parseAuthApiChoice(rewrittenInput);
      if (!chosenApi) {
        await streamAssistantTurn("Choose one: `facebook`, `instagram`, or `whatsapp` (or type `cancel`).");
        return;
      }
      setPendingFlow({ kind: "auth_login", stage: "await_token", api: chosenApi });
      await streamAssistantTurn(buildTokenPrompt(chosenApi));
      return;
    }

    if (pendingFlow?.kind === "auth_login" && pendingFlow.stage === "await_token") {
      if (looksLikeCancelWord(rewrittenInput)) {
        addTurn("user", rewrittenInput);
        setPendingFlow(null);
        await streamAssistantTurn("Auth setup canceled.");
        return;
      }
      addTurn("user", `[${pendingFlow.api} token hidden]`);
      const targetApi = pendingFlow.api;
      setPendingFlow(null);
      await streamAssistantTurn(`Got it. Verifying ${targetApi} token...`);
      await executeDirectRunCli({
        command: `social auth login -a ${targetApi} --token ${rewrittenInput} --no-open`,
        displayText: `social auth login -a ${targetApi} --token *** --no-open`,
        rememberAs: `auth login ${targetApi}`
      });
      return;
    }

    if (authAssist.kind === "auth_root") {
      addTurn("user", rewrittenInput);
      setPendingFlow({ kind: "auth_login", stage: "choose_api" });
      await streamAssistantTurn("I can connect auth now. Which API do you want: `facebook`, `instagram`, or `whatsapp`?");
      return;
    }

    if (authAssist.kind === "auth_login" && !authAssist.token) {
      addTurn("user", rewrittenInput);
      if (!authAssist.api) {
        setPendingFlow({ kind: "auth_login", stage: "choose_api" });
        await streamAssistantTurn("Which API should I connect for auth: `facebook`, `instagram`, or `whatsapp`?");
        return;
      }
      setPendingFlow({ kind: "auth_login", stage: "await_token", api: authAssist.api });
      await streamAssistantTurn(buildTokenPrompt(authAssist.api));
      return;
    }

    if (authAssist.kind === "auth_login" && authAssist.token) {
      addTurn("user", maskCommandSecrets(rewrittenInput));
      await executeDirectRunCli({
        command: rewrittenInput,
        displayText: maskCommandSecrets(rewrittenInput),
        rememberAs: `auth login ${authAssist.api || "facebook"}`
      });
      return;
    }

    addTurn("user", rewrittenInput);
    const slash = handleSlashCommand(rewrittenInput);
    if (slash.consumed) {
      if (slash.systemMessage) addTurn("system", slash.systemMessage);
      if (!slash.inputToExecute) return;
      dispatch({ type: "SET_INPUT", value: slash.inputToExecute });
      return parseAndQueueIntent(slash.inputToExecute);
    }

    if (rewrittenInput === "__why__") {
      await streamAssistantTurn(explainPlan(state.currentIntent, state.currentRisk));
      return;
    }

    const providedName = extractProfileName(rewrittenInput);
    if (providedName) {
      setMemory((prev) => ({ ...prev, profileName: providedName }));
      const fallback = `Nice to meet you, ${providedName}. I'll remember your name in this workspace.`;
      const reply = await generateConversationalReply({
        userText: rewrittenInput,
        fallback,
        mode: "chat",
        intentAction: "memory_name_set",
        profileName: providedName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved
      });
      await streamAssistantTurn(reply);
      return;
    }

    if (asksForRememberedName(rewrittenInput)) {
      if (memory.profileName) {
        const fallback = `Your name is ${memory.profileName}.`;
        const reply = await generateConversationalReply({
          userText: rewrittenInput,
          fallback,
          mode: "chat",
          intentAction: "memory_name_get",
          profileName: memory.profileName,
          lastIntents: memory.lastIntents,
          unresolved: memory.unresolved
        });
        await streamAssistantTurn(reply);
      } else {
        await streamAssistantTurn("I don't have your name yet. You can tell me with: `my name is ...`.");
      }
      return;
    }

    if (looksLikeGreetingOnly(rewrittenInput)) {
      const opener = memory.profileName ? `Hey ${memory.profileName}, I'm here.` : "Hey, I'm here.";
      const pending = memory.unresolved[0];
      const pendingHint = pending ? ` You still have one open item: "${shortText(pending.text, 72)}".` : "";
      const fallback = `${opener}${pendingHint} Want \`status\`, \`whoami\`, or \`social setup\`?`;
      const reply = await generateConversationalReply({
        userText: rewrittenInput,
        fallback,
        mode: "chat",
        intentAction: "greeting",
        profileName: memory.profileName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved
      });
      await streamAssistantTurn(reply);
      return;
    }

    if (state.showDetails) await streamPhase("Reading request");
    if (state.showDetails) await streamPhase("Parsing intent");
    const parsed = await parseNaturalLanguageWithOptionalAi(rewrittenInput);
    const executor = getExecutor(parsed.intent.action);
    const parsedRisk = executor.risk;
    const intentConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const requiresConfirmation = shouldRequireIntentConfirmation(intentConfidence, parsed.intent.action);
    const domainSkill = detectDomainSkill(rewrittenInput, parsed.intent.action);
    if (state.showDetails) await streamPhase("Planning", parsed.intent.action);
    dispatch({
      type: "LOG_ADD",
      entry: newLog(
        "INFO",
        `${(parsed.source || "deterministic").toUpperCase()} parsed intent: ${JSON.stringify(parsed.intent)} (confidence=${formatConfidence(intentConfidence)})`
      )
    });
    dispatch({ type: "LOG_ADD", entry: newLog("INFO", `Skill route: ${domainSkill.id}`) });

    if (parsed.intent.action === "unknown") {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", "Intent unresolved. Waiting for clearer instruction.") });
      rememberUnresolved(rewrittenInput, "intent_unresolved");
      const fallback = `${domainSkill.purpose} Try: ${domainSkill.suggestions.map((x) => `\`${x}\``).join(" | ")}`;
      const reply = await generateConversationalReply({
        userText: rewrittenInput,
        fallback,
        mode: "chat",
        intentAction: parsed.intent.action,
        profileName: memory.profileName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved
      });
      await streamAssistantTurn(reply);
      if (state.showDetails) {
        await streamAssistantTurn(`skill_route: ${domainSkill.id}`);
        await streamAssistantTurn("No tool call queued because intent was unresolved.");
      }
      return;
    }

    if (state.showDetails) {
      await streamAssistantTurn(`skill_route: ${domainSkill.id}`);
      await streamAssistantTurn(formatToolCall(parsed.intent));
      await streamAssistantTurn(`Understood. I can ${describeAction(parsed.intent.action)}.`);
      await streamAssistantTurn(summarizeIntent(parsed.intent, parsedRisk, parsed.missingSlots));
    }
    rememberIntent(rewrittenInput, parsed.intent.action);
    dispatch({
      type: "PARSE_READY",
      intent: parsed.intent,
      risk: parsedRisk,
      missingSlots: parsed.missingSlots,
      confidence: intentConfidence,
      requiresConfirmation
    });

    if (!parsed.valid) {
      dispatch({ type: "LOG_ADD", entry: newLog("WARN", parsed.errors.join("; ") || "Intent parsed with warnings.") });
    }
    if (parsed.missingSlots.length > 0) {
      rememberUnresolved(rewrittenInput, `missing_slots:${parsed.missingSlots.join(",")}`);
      const fallback = `I need these fields: ${parsed.missingSlots.join(", ")}. Press e to edit slots.`;
      const reply = await generateConversationalReply({
        userText: rewrittenInput,
        fallback,
        mode: "chat",
        intentAction: parsed.intent.action,
        intentRisk: parsedRisk,
        profileName: memory.profileName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved
      });
      await streamAssistantTurn(reply);
      return;
    }
    if (parsedRisk === "LOW" && !requiresConfirmation) {
      dispatch({ type: "APPROVED", auto: true });
      if (state.showDetails) await streamAssistantTurn("Low-risk action. Auto-executing.");
      await runExecution(parsed.intent);
      return;
    }
    if (parsedRisk === "LOW" && requiresConfirmation) {
      const fallback = `Intent confidence is ${formatConfidence(intentConfidence)}. Confirm with Enter/a, or rephrase to improve intent match.`;
      const reply = await generateConversationalReply({
        userText: rewrittenInput,
        fallback,
        mode: "chat",
        intentAction: parsed.intent.action,
        intentRisk: parsedRisk,
        profileName: memory.profileName,
        lastIntents: memory.lastIntents,
        unresolved: memory.unresolved
      });
      await streamAssistantTurn(reply);
      return;
    }
    const fallback = state.showDetails
      ? "Awaiting approval. Press Enter or a to continue."
      : `Ready to run ${parsed.intent.action} (${parsedRisk.toLowerCase()} risk). Press Enter to confirm, or e to edit.`;
    const reply = await generateConversationalReply({
      userText: rewrittenInput,
      fallback,
      mode: "chat",
      intentAction: parsed.intent.action,
      intentRisk: parsedRisk,
      profileName: memory.profileName,
      lastIntents: memory.lastIntents,
      unresolved: memory.unresolved
    });
    await streamAssistantTurn(reply);
  }, [
    addTurn,
    memory.lastIntents,
    memory.profileName,
    memory.unresolved,
    rememberIntent,
    rememberUnresolved,
    pendingFlow,
    runExecution,
    state.currentIntent,
    state.currentRisk,
    state.showDetails,
    executeDirectRunCli,
    streamAssistantTurn,
    streamPhase
  ]);

  const confirmOrExecute = useCallback(async (): Promise<void> => {
    if (state.phase === "INPUT") {
      const value = state.input.trim();
      if (!value) return;
      setInputHistory((prev) => {
        if (prev[prev.length - 1] === value) return prev;
        return [...prev.slice(-79), value];
      });
      setHistoryIndex(-1);
      setHistoryDraft("");
      dispatch({ type: "SET_INPUT", value: "" });
      await parseAndQueueIntent(value);
      return;
    }

    if (state.phase === "EDIT_SLOTS" && state.currentIntent) {
      const edited = applySlotEdits(state.currentIntent, state.editInput);
      const editedConfidence = typeof edited.confidence === "number" ? edited.confidence : 0.9;
      const editedRequiresConfirmation = shouldRequireIntentConfirmation(editedConfidence, edited.intent.action);
      dispatch({
        type: "PARSE_READY",
        intent: edited.intent,
        risk: getExecutor(edited.intent.action).risk,
        missingSlots: edited.missingSlots,
        confidence: editedConfidence,
        requiresConfirmation: editedRequiresConfirmation
      });
      dispatch({ type: "RETURN_TO_APPROVAL" });
      await streamAssistantTurn(edited.missingSlots.length > 0 ? `Still missing: ${edited.missingSlots.join(", ")}` : "Slots updated.");
      return;
    }

    if (state.phase === "APPROVAL") {
      if (!state.currentIntent || !state.currentRisk) return;
      if (state.missingSlots.length > 0) {
        await streamAssistantTurn("Missing required slots. Press e and provide key=value.");
        return;
      }
      if (state.currentRisk === "HIGH") {
        dispatch({ type: "HIGH_CONFIRM_STEP_1" });
        await streamAssistantTurn("High-risk action: provide approval reason, then press Enter.");
        return;
      }
      dispatch({ type: "APPROVED" });
      await runExecution(state.currentIntent || undefined);
      return;
    }

    if (state.phase === "HIGH_RISK_APPROVAL") {
      if (!state.approvalReason.trim()) {
        await streamAssistantTurn("Approval reason required for high-risk action.");
        return;
      }
      dispatch({ type: "APPROVED", reason: state.approvalReason.trim() });
      await runExecution(state.currentIntent || undefined);
      return;
    }

    if (state.phase === "RESULT" || state.phase === "REJECTED") {
      dispatch({ type: "RESET_FLOW" });
    }
  }, [parseAndQueueIntent, runExecution, state, streamAssistantTurn]);

  const replaySuggestions = useMemo(() => {
    if (state.phase !== "INPUT") return [] as PersistedLog[];
    const text = state.input.trim();
    if (!/^replay\b/i.test(text)) return [] as PersistedLog[];
    const query = text.replace(/^replay\s*/i, "").trim().toLowerCase();
    if (!query || query === "latest" || query === "last") return logsState.data.slice(0, 6);
    return logsState.data.filter((x) => x.id.toLowerCase().startsWith(query)).slice(0, 6);
  }, [logsState.data, state.input, state.phase]);

  useInput((input, key) => {
    const draftInput = state.phase === "EDIT_SLOTS"
      ? state.editInput
      : state.phase === "HIGH_RISK_APPROVAL"
        ? state.approvalReason
        : state.input;

    if (showPalette) {
      if (key.escape || input === "/" || input === "q") setShowPalette(false);
      return;
    }
    if (showHelp && (input === "?" || key.escape)) {
      setShowHelp(false);
      return;
    }

    if (state.phase === "INPUT" && replaySuggestions.length === 0 && key.upArrow) {
      if (!inputHistory.length) return;
      if (historyIndex === -1) {
        setHistoryDraft(state.input);
        const next = inputHistory.length - 1;
        setHistoryIndex(next);
        dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
        return;
      }
      const next = Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
      return;
    }

    if (state.phase === "INPUT" && replaySuggestions.length === 0 && key.downArrow) {
      if (!inputHistory.length || historyIndex === -1) return;
      const next = historyIndex + 1;
      if (next >= inputHistory.length) {
        setHistoryIndex(-1);
        dispatch({ type: "SET_INPUT", value: historyDraft });
        return;
      }
      setHistoryIndex(next);
      dispatch({ type: "SET_INPUT", value: inputHistory[next] || "" });
      return;
    }

    const consumed = handleShortcut(input, key, replaySuggestions.length > 0, {
      onHelpToggle: () => setShowHelp((prev) => !prev),
      onRefresh: () => {
        void refreshConfig();
        void refreshLogs();
        addTurn("system", "Refreshed config/log state.");
      },
      onDetails: () => {
        const next = !state.showDetails;
        dispatch({ type: "TOGGLE_DETAILS" });
        addTurn("system", next ? "Verbose diagnostics enabled." : "Verbose diagnostics hidden.");
      },
      onEdit: () => {
        if (state.currentIntent) {
          dispatch({ type: "REQUEST_EDIT" });
          addTurn("assistant", "Edit mode: enter key=value and press Enter.");
        }
      },
      onApprove: () => void confirmOrExecute(),
      onReject: () => {
        if (!state.currentIntent) return;
        dispatch({ type: "REJECTED", reason: "Rejected by operator." });
        addTurn("assistant", "Rejected.");
      },
      onToggleRail: () => setRightRailCollapsed((prev) => !prev),
      onPaletteToggle: () => setShowPalette(true),
      onConfirm: () => void confirmOrExecute(),
      onReplayUp: () => setReplaySuggestionIndex((prev) => (prev === 0 ? replaySuggestions.length - 1 : prev - 1)),
      onReplayDown: () => setReplaySuggestionIndex((prev) => (prev + 1) % replaySuggestions.length),
      onQuit: () => exit()
    }, {
      phase: state.phase,
      hasDraftText: Boolean(String(draftInput || "").trim())
    });

    if (consumed) return;
  });

  const inputValue = state.phase === "EDIT_SLOTS" ? state.editInput : state.phase === "HIGH_RISK_APPROVAL" ? state.approvalReason : state.input;
  const inputLabel = state.phase === "EDIT_SLOTS" ? "edit_slots (key=value): " : state.phase === "HIGH_RISK_APPROVAL" ? "approval_reason: " : "chat: ";

  const setInputValue = (value: string): void => {
    if (state.phase === "EDIT_SLOTS") {
      dispatch({ type: "SET_EDIT_INPUT", value });
      return;
    }
    if (state.phase === "HIGH_RISK_APPROVAL") {
      dispatch({ type: "SET_APPROVAL_REASON", value });
      return;
    }
    dispatch({ type: "SET_INPUT", value });
  };

  const config = configState.data;
  const waba = config?.waba || {
    connected: false,
    businessId: "",
    wabaId: "",
    phoneNumberId: "",
    webhookCallbackUrl: "",
    webhookVerifyToken: ""
  };
  const setupChecklist: Array<{ label: string; ok: boolean; fix?: string }> = [
    {
      label: "WhatsApp access token",
      ok: Boolean(config?.tokenMap.whatsapp),
      hint: "Needed to connect your WhatsApp account.",
      fix: "social auth login -a whatsapp"
    },
    {
      label: "WhatsApp Business connected",
      ok: Boolean(waba.connected),
      hint: "Links your business account for messaging.",
      fix: "social integrations connect waba"
    },
    {
      label: "WhatsApp Business account (ID)",
      ok: Boolean(waba.wabaId),
      hint: "Helps us find your WhatsApp business account.",
      fix: "social integrations connect waba"
    },
    {
      label: "WhatsApp phone number (ID)",
      ok: Boolean(waba.phoneNumberId),
      hint: "Required to send messages.",
      fix: "social integrations connect waba"
    }
  ];
  const missingSetup = setupChecklist.filter((item) => !item.ok);
  const quickActions = [
    { label: "Connect WhatsApp", command: "social auth login -a whatsapp", show: !config?.tokenMap.whatsapp },
    { label: "Connect WhatsApp Business", command: "social integrations connect waba", show: !waba.wabaId || !waba.phoneNumberId },
    { label: "Run doctor", command: "social doctor", show: true },
    {
      label: "Send test message",
      command: "social waba send --from PHONE_ID --to +15551234567 --body \"Hello\"",
      show: Boolean(waba.phoneNumberId)
    }
  ].filter((item) => item.show);
  const nextAction = !config?.tokenMap.whatsapp
    ? { label: "Connect WhatsApp", command: "social auth login -a whatsapp" }
    : (!waba.wabaId || !waba.phoneNumberId)
      ? { label: "Connect WhatsApp Business", command: "social integrations connect waba" }
      : { label: "Run doctor", command: "social doctor" };
  const readyCount = setupChecklist.filter((item) => item.ok).length;
  const platformStatus = {
    instagram: !!config?.tokenMap.instagram || !!config?.scopes.find((x) => x.includes("instagram")),
    facebook: !!config?.tokenMap.facebook || !!config?.tokenSet,
    ads: !!config?.scopes.find((x) => x.includes("ads")) || !!config?.tokenMap.facebook
  };
  const connectedCount = [platformStatus.instagram, platformStatus.facebook, platformStatus.ads].filter(Boolean).length;
  const rawParseMode = String(process.env.SOCIAL_TUI_PARSE_MODE || process.env.SOCIAL_TUI_AI_PARSE_MODE || "prefer_ai").trim().toLowerCase();
  const parseMode = rawParseMode === "deterministic" || rawParseMode === "strict" || rawParseMode === "local_only"
    ? "deterministic"
    : rawParseMode === "balanced" || rawParseMode === "hybrid"
      ? "balanced"
      : "prefer_ai";
  const aiProvider = process.env.SOCIAL_TUI_AI_VENDOR || process.env.SOCIAL_TUI_AI_PROVIDER || process.env.SOCIAL_AI_PROVIDER || "auto";
  const aiModel = process.env.SOCIAL_TUI_AI_MODEL || (
    aiProvider === "openai"
      ? "gpt-4o-mini"
      : aiProvider === "openrouter"
        ? "openai/gpt-4o-mini"
        : aiProvider === "xai"
          ? "grok-2-latest"
          : aiProvider === "ollama"
            ? "qwen2.5:7b"
            : "auto"
  );
  const aiLabel = `${parseMode}:${aiProvider}/${aiModel}`;
  const industryMode = String(config?.industry?.mode || "hybrid");
  const industrySelected = String(config?.industry?.selected || "").trim();
  const industryLabel = industrySelected || `${industryMode} (auto)`;
  const memoryLabel = memory.profileName ? memory.profileName : "anon";
  const unresolvedCount = memory.unresolved.length;
  const riskTone = state.currentRisk === "HIGH" ? theme.error : state.currentRisk === "MEDIUM" ? theme.warning : theme.success;
  const phaseTone = state.phase === "EXECUTING" ? theme.accent : state.phase === "REJECTED" ? theme.warning : theme.text;
  const topActivity = state.liveLogs[state.liveLogs.length - 1];
  const confidenceLabel = formatConfidence(state.currentConfidence);

  const accountOptions = accountOptionsFromConfig(config || {
    tokenSet: false,
    graphVersion: "v20.0",
    scopes: [],
    tokenMap: { facebook: false, instagram: false, whatsapp: false }
  });
  const verboseMode = state.showDetails;
  const runtimeLabel = state.phase === "EXECUTING" ? "executing" : "ready";
  const actionHint = buildActionBarHint({
    phase: state.phase,
    hasIntent: Boolean(state.currentIntent),
    hasReplaySuggestions: replaySuggestions.length > 0,
    verboseMode
  });

  const recentQueue = state.actionQueue.slice(-5);
  const recentLogs = state.liveLogs.slice(-10);
  const recentRollbacks = state.rollbackHistory.slice(-5);
  const resultPreview = state.results ? JSON.stringify(state.results, null, 2) : "";

  return (
    <Box flexDirection="column">
      <SectionHeading label="Social Flow hatch" />
      <FramedBlock title="Runtime">
        <Text color={theme.text}>
          profile {config?.activeProfile || "default"} | session {shortText(memory.sessionId, 22)} | connected {connectedCount}/3 | ai {aiLabel}
        </Text>
        <Text color={phaseTone}>
          phase {state.phase.toLowerCase()} | risk {(state.currentRisk || "LOW").toLowerCase()} | confidence {confidenceLabel} | account {selectedAccount}
        </Text>
        <Text color={theme.muted}>
          industry {industryLabel} | memory {memoryLabel} | open items {unresolvedCount} | runtime {runtimeLabel}
        </Text>
        <Text color={theme.muted}>
          latest {topActivity ? `${shortTime(topActivity.at)} ${topActivity.message.slice(0, 72)}` : "idle"}
        </Text>
        {configState.loading ? <Text color={theme.muted}>config loading...</Text> : null}
        {configState.error ? <Text color={theme.error}>config error: {configState.error}</Text> : null}
      </FramedBlock>

      {configState.loading ? null : (
        <>
          <SectionHeading label="Onboarding" />
          <FramedBlock title="Get started">
            {quickActions.map((item, idx) => (
              <Box key={item.command}>
                <Text color={theme.muted}>{`Step ${idx + 1}: `}</Text>
                <Text color={theme.text}>{item.label}</Text>
                <Text color={theme.muted}> — </Text>
                <Text color={theme.accent}>{item.command}</Text>
              </Box>
            ))}
            {nextAction ? (
              <Box marginTop={1}>
                <Text color={theme.text}>Next step: </Text>
                <Text color={theme.text}>{nextAction.label}</Text>
                <Text color={theme.muted}> — </Text>
                <Text color={theme.accent}>{nextAction.command}</Text>
              </Box>
            ) : null}
            <Text color={theme.muted}>Tip: copy/paste any line above into chat to run it.</Text>
            <Text color={theme.muted}>Tip: start with Step 1 if you're unsure.</Text>
            <Text color={theme.muted}>Tip: type "waba setup" for a guided WhatsApp flow.</Text>
            <Text color={theme.muted}>Tip: type "help" if you get stuck.</Text>
          </FramedBlock>
          <FramedBlock title="Setup checklist" borderColor={missingSetup.length ? theme.warning : theme.muted}>
            <Text color={theme.muted}>Progress: {readyCount}/{setupChecklist.length} ready.</Text>
            {missingSetup.length ? (
              <Text color={theme.muted}>You're close — finish the ones marked NEEDS.</Text>
            ) : (
              <Text color={theme.success}>You're all set.</Text>
            )}
            {setupChecklist.map((item) => (
              <Box key={item.label} marginTop={1} flexDirection="column">
                <Box>
                  <Text color={item.ok ? theme.success : theme.warning}>
                    {item.ok ? "READY" : "NEEDS"} {item.label}
                  </Text>
                </Box>
                <Text color={theme.muted}>{item.hint}</Text>
                {!item.ok && item.fix ? (
                  <Text color={theme.accent}>Do this (copy/paste): {item.fix}</Text>
                ) : null}
              </Box>
            ))}
            {!missingSetup.length ? (
              <Text color={theme.success}>Setup complete.</Text>
            ) : null}
          </FramedBlock>
        </>
      )}

      <SectionHeading label="Transcript" />
      <Box marginTop={1} flexDirection="column">
        {chatTurns.slice(-16).map((turn) => (
          turn.role === "user" ? (
            <Box key={turn.id} marginTop={1} paddingX={1} borderStyle="single" borderColor={theme.muted}>
              <Text color={theme.text}>{turn.text || "..."}</Text>
            </Box>
          ) : (
            <Box key={turn.id} marginTop={1}>
              <Text color={turn.role === "assistant" ? theme.text : theme.muted}>
                {turn.role === "system" ? `· ${turn.text || "..."}` : (turn.text || "...")}
              </Text>
            </Box>
          )
        ))}
      </Box>

      {verboseMode ? (
        <>
          <SectionHeading label="Diagnostics" />
          <FramedBlock title="Execution rail" borderColor={state.currentRisk === "HIGH" ? riskTone : theme.muted}>
          <Text color={phaseTone}>phase={state.phase} risk={state.currentRisk || "LOW"} confidence={confidenceLabel} action={state.currentIntent?.action || "none"} missing={state.missingSlots.join(", ") || "none"}</Text>
          <Text color={theme.muted}>graph={config?.graphVersion || "v20.0"} account={selectedAccount}</Text>
          <Select options={accountOptions} onChange={(value) => setSelectedAccount(value)} />
          {rightRailCollapsed ? (
            <Text color={theme.muted}>Press x to expand queue, logs, rollback, and result view.</Text>
          ) : (
            <>
              <Text color={theme.accent}>queue</Text>
              {recentQueue.length ? recentQueue.map((x) => (
                <Text key={x.id} color={x.status === "FAILED" ? theme.error : x.status === "RUNNING" ? theme.accent : theme.text}>
                  [{shortTime(x.createdAt)}] {x.action} {x.status}
                </Text>
              )) : <Text color={theme.muted}>no queued actions</Text>}
              <Text color={theme.accent}>logs</Text>
              {recentLogs.length ? recentLogs.map((x, idx) => (
                <Text key={`l-${idx}`} color={logLevelColor(x.level)}>
                  [{shortTime(x.at)}] {logLevelGlyph(x.level)} {x.message}
                </Text>
              )) : <Text color={theme.muted}>no runtime logs</Text>}
              <Text color={theme.accent}>rollback</Text>
              {recentRollbacks.length ? recentRollbacks.map((x) => (
                <Text key={`${x.at}_${x.action}`} color={theme.text}>
                  [{shortTime(x.at)}] {x.action} {x.status}
                </Text>
              )) : <Text color={theme.muted}>no rollback entries</Text>}
              <Text color={theme.accent}>result</Text>
              <Text color={resultPreview ? theme.text : theme.muted}>{resultPreview || "no results yet"}</Text>
            </>
          )}
          </FramedBlock>
        </>
      ) : null}

      {replaySuggestions.length > 0 ? (
        <>
          <SectionHeading label="Replay suggestions" />
          <FramedBlock title="Replay">
          {replaySuggestions.map((item, idx) => (
            <Text key={item.id} color={idx === replaySuggestionIndex ? theme.accent : theme.text}>
              {idx === replaySuggestionIndex ? ">" : " "} {item.id} {item.action}
            </Text>
          ))}
          </FramedBlock>
        </>
      ) : null}

      {showPalette ? (
        <>
          <SectionHeading label="Command palette" />
          <FramedBlock title="Palette">
          <Select
            options={[
              { label: "Doctor", value: "doctor" },
              { label: "Status", value: "status" },
              { label: "WABA setup guide", value: "waba setup" },
              { label: "WABA send example", value: "social waba send --from PHONE_ID --to +15551234567 --body \"Hello\"" },
              { label: "Config", value: "config" },
              { label: "Logs", value: "logs limit 20" },
              { label: "Replay latest", value: "replay latest" },
              { label: "Get profile", value: "get my facebook profile" },
              { label: "List ads", value: "list ads account act_123" },
              { label: "Create post", value: "create post \"Launch update\" page 12345" },
              { label: "AI parse", value: "/ai show my facebook pages" }
            ]}
            onChange={(value) => {
              setShowPalette(false);
              dispatch({ type: "SET_INPUT", value });
              void parseAndQueueIntent(value);
            }}
          />
          </FramedBlock>
        </>
      ) : null}

      {showHelp ? (
        <>
          <SectionHeading label="Help" />
          <FramedBlock title="Operator notes">
          <Text color={theme.text}>Workflow: describe, plan, approve, execute, review.</Text>
          <Text color={theme.text}>Commands: /help /doctor /status /config /logs /replay /why /ai ...</Text>
          <Text color={theme.text}>Memory: say `my name is ...` and later ask `what's my name`.</Text>
          <Text color={theme.text}>Keys: Enter send/confirm, a approve, r reject, e edit slots, d diagnostics.</Text>
          <Text color={theme.muted}>UI: / palette, x collapse/expand diagnostics (verbose), up/down history, q quit.</Text>
          </FramedBlock>
        </>
      ) : null}

      <SectionHeading label={state.phase === "HIGH_RISK_APPROVAL" ? "Approval" : state.phase === "EDIT_SLOTS" ? "Edit slots" : "Compose"} />
      <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={state.currentRisk === "HIGH" ? riskTone : theme.muted}>
        <Text color={theme.accent}>{inputLabel}</Text>
        <TextInput value={inputValue} onChange={setInputValue} focus />
      </Box>
      <Text color={state.currentRisk === "HIGH" ? riskTone : theme.accent}>{actionHint}</Text>
      <Text color={theme.muted}>Enter confirm | / palette | ? help | d diagnostics | x rail | q quit</Text>
    </Box>
  );
}

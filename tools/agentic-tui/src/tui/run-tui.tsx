import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Select } from "@inkjs/ui";
import TextInput from "ink-text-input";
import { spawn } from "node:child_process";

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
  loadOpsSnapshot,
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
  OpsCenterSnapshot,
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

function formatOpsTime(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().replace("T", " ").slice(0, 16);
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

function tokenDashboardUrl(api: AuthApi): string {
  if (api === "whatsapp") {
    return "https://developers.facebook.com/apps/";
  }
  if (api === "instagram") {
    return "https://developers.facebook.com/apps/";
  }
  return "https://developers.facebook.com/apps/";
}

function setupProgressBar(done: number, total: number, width = 16): string {
  if (!Number.isFinite(total) || total <= 0) return "[----------------]";
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * width);
  const bar = `${"=".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
  return `[${bar}]`;
}

function openExternalUrl(url: string): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const platform = process.platform;
    let command = "xdg-open";
    let args = [url];
    if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else if (platform === "darwin") {
      command = "open";
      args = [url];
    }

    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}

function inferTokenApi(text: string, fallback: AuthApi): AuthApi {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("whatsapp") || lower.includes("waba")) return "whatsapp";
  if (lower.includes("instagram") || lower.includes("ig")) return "instagram";
  if (lower.includes("facebook") || lower.includes("meta")) return "facebook";
  return fallback;
}

function buildTokenPrompt(api: AuthApi, intro?: string): string {
  const label = apiLabel(api);
  const prefix = intro ? `${intro} ` : "";
  const base = `${prefix}Paste your ${label} access token now. I will hide it in chat logs. Type \`cancel\` to stop.`;
  if (api !== "whatsapp") return base;
  return `${base} Copy it from Meta App Dashboard -> WhatsApp -> API Setup. Dashboard: ${tokenDashboardUrl("whatsapp")}. Tip: type \`open whatsapp token\` to open it. Troubleshooting: if "Generate access token" is missing, ensure WhatsApp is added to your app and you are in the correct app.`;
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

function StatusBadge(props: { label: "OK" | "FAIL" | "SKIP"; tone?: "ok" | "fail" | "skip" }): JSX.Element {
  const theme = useTheme();
  const tone = props.tone || (props.label === "OK" ? "ok" : props.label === "FAIL" ? "fail" : "skip");
  const color = tone === "ok" ? theme.success : tone === "fail" ? theme.error : theme.muted;
  return <Text color={color} bold>{`[${props.label}]`}</Text>;
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

function unresolvedHint(entry: MemoryUnresolvedRecord): string {
  const reason = String(entry.reason || "").trim();
  if (!reason) return "needs follow-up";
  if (reason.startsWith("missing_slots")) return "needs fields";
  if (reason === "intent_unresolved") return "rephrase or /help";
  if (reason.startsWith("execution_")) return "check logs or replay";
  return reason;
}

type BoardFilter = "all" | "attention" | "clear";

function nextBoardFilter(current: BoardFilter): BoardFilter {
  if (current === "all") return "attention";
  if (current === "attention") return "clear";
  return "all";
}

function boardFilterLabel(current: BoardFilter): string {
  if (current === "attention") return "needs attention";
  if (current === "clear") return "all clear";
  return "all";
}

type OpsRow = OpsCenterSnapshot["workspaces"][number];

function buildOpsNextCommand(row: OpsRow): string {
  if (row.nextAction === "Review approvals") {
    return `social ops approvals list --workspace ${row.name} --open`;
  }
  if (row.nextAction === "Review alerts") {
    return `social ops alerts list --workspace ${row.name} --open`;
  }
  if (row.nextAction === "Run morning check") {
    return `social ops morning-run --workspace ${row.name} --spend 0`;
  }
  return "";
}

type QuickAction = { label: string; command: string };

const onboardingSteps: Array<{ title: string; detail: string; action: string }> = [
  {
    title: "Welcome to Social Flow",
    detail: "This guide helps you get started without any technical setup.",
    action: "Press w to choose a task, or type guided setup."
  },
  {
    title: "Connect your account",
    detail: "We will walk you through tokens and WhatsApp setup step-by-step.",
    action: "Press h for help fixing issues or g for guided setup."
  },
  {
    title: "Run your first action",
    detail: "Pick a simple task, then watch the status and next steps.",
    action: "Try: status | social doctor"
  }
];

function dedupeQuickActions(actions: QuickAction[]): QuickAction[] {
  const seen = new Set<string>();
  return actions.filter((item) => {
    const key = item.command.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksLikeCancelWord(input: string): boolean {
  const text = String(input || "").trim().toLowerCase();
  return text === "cancel" || text === "stop" || text === "abort" || text === "exit";
}

function looksLikeGreetingOnly(input: string): boolean {
  const text = String(input || "").trim().toLowerCase().replace(/[!?.]+$/g, "").trim();
  return /^(hi|hello|hey|yo|hola|good morning|good evening|good afternoon)(\s+[a-z]{2,20})?$/.test(text);
}

function looksLikeNextAction(input: string): boolean {
  const text = String(input || "").trim().toLowerCase();
  return /^(next|continue|proceed|go ahead|do it|run next|next step)$/i.test(text);
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

type ChatReplyAiProvider = "anthropic" | "openai" | "openrouter" | "xai" | "ollama";

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
  const provider: ChatReplyAiProvider = rawProvider === "anthropic" || rawProvider === "claude"
    ? "anthropic"
    : rawProvider === "openrouter"
    ? "openrouter"
    : rawProvider === "xai" || rawProvider === "grok"
      ? "xai"
      : rawProvider === "ollama"
        ? "ollama"
        : "openai";

  const model = String(process.env.SOCIAL_TUI_AI_MODEL || (
    provider === "anthropic"
      ? "claude-3-5-sonnet-latest"
      : provider === "openrouter"
      ? "openai/gpt-4o-mini"
      : provider === "xai"
        ? "grok-2-latest"
        : provider === "ollama"
          ? "qwen2.5:7b"
          : "gpt-4o-mini"
  )).trim();

  const baseUrl = String(process.env.SOCIAL_TUI_AI_BASE_URL || (
    provider === "anthropic"
      ? "https://api.anthropic.com/v1"
      : provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : provider === "xai"
        ? "https://api.x.ai/v1"
        : provider === "ollama"
          ? "http://127.0.0.1:11434"
          : "https://api.openai.com/v1"
  )).trim();

  const apiKey = String(
    process.env.SOCIAL_TUI_AI_API_KEY
    || process.env.SOCIAL_ANTHROPIC_API_KEY
    || process.env.ANTHROPIC_API_KEY
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

function extractAnthropicContent(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const content = Array.isArray(root.content) ? root.content : [];
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    if (value.type !== "text") return "";
    return typeof value.text === "string" ? value.text : "";
  }).join("\n").trim();
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

    if (cfg.provider === "anthropic") {
      const system = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n")
        .trim();
      const conversationalMessages = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role,
          content: message.content
        }));
      const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01"
        },
        body: JSON.stringify({
          model: cfg.model,
          system,
          temperature: 0.4,
          max_tokens: 180,
          messages: conversationalMessages
        }),
        signal: controller.signal
      });
      if (!response.ok) return "";
      const data = await response.json();
      return extractAnthropicContent(data);
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
    "You are Flow, the conversational operating agent for Social Flow.",
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

function buildRecoverySuggestions(intent: ParsedIntent, errorText: string): string[] {
  const msg = String(errorText || "").toLowerCase();
  const out: string[] = [];
  if (!msg) return out;

  if (isSetupOrAuthError(msg)) {
    out.push("guided setup", "status");
  }
  if (msg.includes("waba") || msg.includes("whatsapp")) {
    out.push("waba setup", "social integrations connect waba");
  }
  if (msg.includes("phone") || msg.includes("phone_number") || msg.includes("phone number")) {
    out.push("social integrations connect waba");
  }
  if (msg.includes("webhook")) {
    out.push("social integrations connect waba");
  }
  if (msg.includes("permission") || msg.includes("scope") || msg.includes("scopes")) {
    out.push("guided setup", "social auth login -a facebook");
  }

  if (intent.action === "run_cli") {
    out.push("logs limit 20", "replay latest");
  } else if (!out.length) {
    out.push("logs limit 20");
  }

  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function formatRecoverySuggestions(suggestions: string[]): string {
  if (!suggestions.length) return "";
  return ` Next: ${suggestions.map((x) => `\`${x}\``).join(" | ")}`;
}

type ErrorActionSuggestion = { label: string; command: string; detail?: string };

function friendlyCommandLabel(command: string): string {
  const cmd = command.toLowerCase().trim();
  if (cmd === "guided setup") return "Run guided setup";
  if (cmd === "fix token") return "Fix access token";
  if (cmd === "status") return "Check status";
  if (cmd === "replay latest") return "Retry the last action";
  if (cmd.startsWith("social integrations connect waba")) return "Reconnect WhatsApp Business";
  if (cmd.startsWith("social auth login")) return "Reauthorize access";
  if (cmd.startsWith("logs")) return "Show recent logs";
  if (cmd.startsWith("open ")) return "Open the first item";
  if (cmd === "social doctor") return "Run doctor (health check)";
  if (cmd === "social ops center") return "Review ops center";
  return "Run suggested action";
}

function errorActionDetail(command: string): string {
  const cmd = command.toLowerCase().trim();
  if (cmd === "guided setup") return "We will walk you through missing setup steps.";
  if (cmd === "fix token") return "You will be asked to paste a new token.";
  if (cmd.startsWith("social integrations connect waba")) return "Reconnect WhatsApp Business and phone number.";
  if (cmd.startsWith("social auth login")) return "Re-authorize with correct permissions.";
  if (cmd === "replay latest") return "Retries the last action with the same inputs.";
  if (cmd.startsWith("logs")) return "Shows recent errors so we can diagnose faster.";
  return "";
}

function buildErrorActionSuggestions(errorText: string, authIssue: boolean): ErrorActionSuggestion[] {
  const msg = String(errorText || "").toLowerCase();
  if (!msg) return [];
  const commands: string[] = [];

  if (msg.includes("token")) commands.push("fix token");
  if (authIssue || msg.includes("auth") || msg.includes("permission") || msg.includes("unauthorized") || msg.includes("forbidden")) {
    commands.push("guided setup");
  }
  if (msg.includes("waba") || msg.includes("whatsapp") || msg.includes("phone") || msg.includes("webhook")) {
    commands.push("social integrations connect waba");
  }
  if (msg.includes("scope")) commands.push("social auth login -a facebook");
  if (msg.includes("rate") || msg.includes("too many requests") || msg.includes("quota")) commands.push("replay latest");
  if (msg.includes("timeout") || msg.includes("network") || msg.includes("econn") || msg.includes("fetch")) commands.push("replay latest");

  commands.push("logs limit 20", "status");

  const seen = new Set<string>();
  return commands.filter((cmd) => {
    const key = cmd.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4).map((command) => ({
    label: friendlyCommandLabel(command),
    command,
    detail: errorActionDetail(command)
  }));
}

function summarizeExecutionForChat(intent: ParsedIntent, result: ExecutionResult): string {
  const output = (result.output || {}) as Record<string, unknown>;

  if (!result.ok) {
    const error = String(output.error || "").trim();
    const recovery = buildRecoverySuggestions(intent, error);
    const recoveryHint = formatRecoverySuggestions(recovery);
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
        return `social command failed${suffix}: ${shortText(error, 150)} Try: \`${suggestion}\`${recoveryHint}`;
      }
      return error
        ? `social command failed${suffix}: ${shortText(error, 180)}${recoveryHint}`
        : `social command failed${suffix}.${recoveryHint}`;
    }
    const setupIssue = isSetupOrAuthError(error);
    if (intent.action === "unknown") {
      return "I didn't fully understand that yet. Try `what can you do`, `status`, or `/help`.";
    }
    if (intent.action === "get_profile") {
      if (setupIssue) {
        return `I can't identify your profile yet because Facebook auth is not fully set up. Run \`social setup\`, then try \`whoami\` again.${recoveryHint}`;
      }
      return error ? `I couldn't fetch your profile yet: ${error}${recoveryHint}` : `I couldn't fetch your profile yet. Try \`status\` or \`social setup\`.${recoveryHint}`;
    }
    if (intent.action === "create_post" || intent.action === "list_ads") {
      if (setupIssue) {
        return `This workspace is not fully connected yet. Run \`social setup\` and try again.${recoveryHint}`;
      }
    }
    return error ? `I couldn't finish that yet: ${error}${recoveryHint}` : `I couldn't finish that request yet.${recoveryHint}`;
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

function confidenceTier(confidence: number | null | undefined): "high" | "medium" | "low" | "unknown" {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "unknown";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
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
type PostAuthAction = null | "connect_waba";

function HatchRuntime(): JSX.Element {
  const theme = useTheme();
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([
    newTurn("system", "Wake up, Flow."),
    newTurn("assistant", "Flow is online. Tell me what you want to connect, check, or run.")
  ]);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [focusedWorkspace, setFocusedWorkspace] = useState<string>("");
  const [attentionMode, setAttentionMode] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [showGuideOverlay, setShowGuideOverlay] = useState(false);
  const [showGuidedMenu, setShowGuidedMenu] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  const [panicSummary, setPanicSummary] = useState<{ text: string; at: string } | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("default");
  const [replaySuggestionIndex, setReplaySuggestionIndex] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [handoffDone, setHandoffDone] = useState(false);
  const [memory, setMemory] = useState<HatchMemoryState>({
    loaded: false,
    sessionId: newSessionId(),
    profileName: "",
    lastIntents: [],
    unresolved: []
  });
  const [pendingFlow, setPendingFlow] = useState<PendingFlowState | null>(null);
  const [postAuthAction, setPostAuthAction] = useState<PostAuthAction>(null);
  const tokenDashboardOpened = useRef<Record<AuthApi, boolean>>({
    facebook: false,
    instagram: false,
    whatsapp: false
  });

  const [configState, setConfigState] = useState<LoadState<ConfigSnapshot | null>>({
    loading: true,
    error: null,
    data: null
  });
  const [opsState, setOpsState] = useState<LoadState<OpsCenterSnapshot | null>>({
    loading: true,
    error: null,
    data: null
  });
  const [opsUpdatedAt, setOpsUpdatedAt] = useState<string>("");
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

  const openTokenDashboard = useCallback(async (api: AuthApi, opts?: { silent?: boolean; force?: boolean }): Promise<void> => {
    if (!opts?.force && tokenDashboardOpened.current[api]) return;
    tokenDashboardOpened.current[api] = true;
    const url = tokenDashboardUrl(api);
    const opened = await openExternalUrl(url);
    if (opts?.silent) return;
    if (opened) {
      await streamAssistantTurn(`Opening ${apiLabel(api)} token page in your browser.`);
    } else {
      await streamAssistantTurn(`Open ${apiLabel(api)} token page: ${url}`);
    }
  }, [streamAssistantTurn]);

  const toggleBoardFilter = useCallback(() => {
    setBoardFilter((prev) => {
      const next = nextBoardFilter(prev);
      addTurn("system", `Agency board view: ${boardFilterLabel(next)}.`);
      return next;
    });
  }, [addTurn]);

  const toggleAttentionMode = useCallback(() => {
    setAttentionMode((prev) => {
      const next = !prev;
      addTurn("system", next ? "Attention mode on: showing only critical panels." : "Attention mode off: full view restored.");
      return next;
    });
  }, [addTurn]);

  const toggleQuietMode = useCallback(() => {
    setQuietMode((prev) => {
      const next = !prev;
      addTurn("system", next ? "Quiet mode on: hiding transcript and diagnostics." : "Quiet mode off: full view restored.");
      return next;
    });
  }, [addTurn]);

  const toggleGuideOverlay = useCallback(() => {
    setShowGuideOverlay((prev) => !prev);
  }, []);

  const toggleSafeMode = useCallback(() => {
    setSafeMode((prev) => {
      const next = !prev;
      addTurn("system", next ? "Safe mode on: high-risk actions are blocked." : "Safe mode off.");
      return next;
    });
  }, [addTurn]);

  const toggleGuidedMenu = useCallback(() => {
    setShowGuidedMenu((prev) => !prev);
  }, []);

  const advanceOnboarding = useCallback(() => {
    setShowOnboarding((prev) => (prev ? prev : true));
    setOnboardingStep((prev) => {
      const next = prev + 1;
      if (next >= onboardingSteps.length) {
        setShowOnboarding(false);
        setOnboardingSeen(true);
        return 0;
      }
      return next;
    });
  }, []);

  const cycleFocusedWorkspace = useCallback((direction: "prev" | "next", rows: OpsRow[]) => {
    if (!rows.length) return;
    const currentIndex = focusedWorkspace
      ? rows.findIndex((row) => row.name === focusedWorkspace)
      : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const offset = direction === "prev" ? -1 : 1;
    const nextIndex = (baseIndex + offset + rows.length) % rows.length;
    const next = rows[nextIndex]?.name || "";
    if (!next) return;
    setFocusedWorkspace(next);
    addTurn("system", `Focused workspace: ${next}.`);
  }, [addTurn, focusedWorkspace]);

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

  const refreshOps = useCallback(async () => {
    const cfg = configState.data;
    if (!cfg) {
      setOpsState({ loading: false, error: null, data: null });
      return;
    }
    const profiles = Array.isArray(cfg.profiles) ? cfg.profiles.map((p) => p.name) : [];
    const activeWorkspace = String(cfg.activeProfile || "default").trim() || "default";
    setOpsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const snapshot = await loadOpsSnapshot(profiles, activeWorkspace);
      setOpsState({ loading: false, error: null, data: snapshot });
      setOpsUpdatedAt(new Date().toISOString());
    } catch (err) {
      setOpsState({ loading: false, error: String((err as Error)?.message || err), data: null });
    }
  }, [configState.data]);

  useEffect(() => {
    void refreshConfig();
    void refreshLogs();
  }, [refreshConfig, refreshLogs]);

  useEffect(() => {
    if (!configState.data) return;
    void refreshOps();
  }, [configState.data, refreshOps]);

  useEffect(() => {
    if (handoffDone) return;
    if (logsState.loading) return;
    const logs = Array.isArray(logsState.data) ? logsState.data : [];
    if (!logs.length) {
      setHandoffDone(true);
      return;
    }
    if (chatTurns.length > 0) {
      setHandoffDone(true);
      return;
    }
    const latest = logs[0];
    const status = latest.success ? "ok" : "failed";
    const stamp = shortTime(latest.timestamp);
    const failures = logs.filter((x) => !x.success).length;
    addTurn("system", `Last run: ${latest.action} (${status}) at ${stamp}. Recent failures: ${failures}.`);
    setHandoffDone(true);
  }, [addTurn, chatTurns.length, handoffDone, logsState.data, logsState.loading]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshLogs();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshLogs]);

  useEffect(() => {
    if (!configState.data) return undefined;
    const id = setInterval(() => {
      void refreshOps();
    }, 10000);
    return () => clearInterval(id);
  }, [configState.data, refreshOps]);

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

  useEffect(() => {
    if (onboardingSeen || showOnboarding) return;
    if (!memory.loaded || logsState.loading) return;
    const hasHistory = chatTurns.length > 2 || logsState.data.length > 0;
    if (!hasHistory) setShowOnboarding(true);
  }, [chatTurns.length, logsState.data.length, logsState.loading, memory.loaded, onboardingSeen, showOnboarding]);

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

  const config = configState.data;
  const opsSnapshot = opsState.data;
  const opsWorkspaces = opsSnapshot?.workspaces ?? [];
  const activeWorkspaceName = String(opsSnapshot?.activeWorkspace || config?.activeProfile || "").trim();
  const opsApprovalsOpen = opsWorkspaces.reduce((acc, row) => acc + (row.approvalsOpen || 0), 0);
  const opsAlertsOpen = opsWorkspaces.reduce((acc, row) => acc + (row.alertsOpen || 0), 0);
  const opsNeedsAttention = opsWorkspaces.filter((row) => row.approvalsOpen > 0 || row.alertsOpen > 0).length;
  const attentionOpsWorkspaces = opsWorkspaces.filter((row) => row.approvalsOpen > 0 || row.alertsOpen > 0);
  const opsBoardView = boardFilterLabel(boardFilter);
  const filteredOpsWorkspaces = opsWorkspaces.filter((row) => {
    if (boardFilter === "attention") return row.approvalsOpen > 0 || row.alertsOpen > 0;
    if (boardFilter === "clear") return row.approvalsOpen === 0 && row.alertsOpen === 0;
    return true;
  });
  const opsFocusRows = attentionMode ? attentionOpsWorkspaces : filteredOpsWorkspaces;
  const opsRowsToShow = opsFocusRows;
  const opsViewLabel = attentionMode ? "needs attention" : opsBoardView;
  const defaultFocusedName = opsFocusRows.find((row) => row.name === activeWorkspaceName)?.name
    || opsFocusRows[0]?.name
    || "";
  const resolvedFocusedName = focusedWorkspace && opsFocusRows.some((row) => row.name === focusedWorkspace)
    ? focusedWorkspace
    : defaultFocusedName;
  const focusedOpsWorkspace = resolvedFocusedName
    ? opsFocusRows.find((row) => row.name === resolvedFocusedName)
    : undefined;
  const focusedNextCommand = focusedOpsWorkspace ? buildOpsNextCommand(focusedOpsWorkspace) : "";
  const focusedApprovalsCommand = focusedOpsWorkspace
    ? `social ops approvals list --workspace ${focusedOpsWorkspace.name} --open`
    : "";
  const focusedAlertsCommand = focusedOpsWorkspace
    ? `social ops alerts list --workspace ${focusedOpsWorkspace.name} --open`
    : "";
  const waba = config?.waba || {
    connected: false,
    businessId: "",
    wabaId: "",
    phoneNumberId: "",
    webhookCallbackUrl: "",
    webhookVerifyToken: ""
  };
  const profileSummary = Array.isArray(config?.profiles) ? config?.profiles : [];
  const logItems = Array.isArray(logsState.data) ? logsState.data : [];
  const successCount = logItems.filter((x) => x.success).length;
  const failCount = logItems.filter((x) => !x.success).length;
  const lastError = logItems.find((x) => !x.success && x.error)?.error || "";
  const setupChecklist: Array<{ label: string; ok: boolean; fix?: string; hint?: string }> = [
    {
      label: "WhatsApp access token",
      ok: Boolean(config?.tokenMap.whatsapp),
      hint: "Needed to connect your WhatsApp account.",
      fix: "fix token"
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
  const unresolvedCount = memory.unresolved.length;
  const nextAction = missingSetup.length > 0
    ? { label: "Guided setup", command: "guided setup" }
    : (lastError && isSetupOrAuthError(lastError))
      ? { label: "Guided setup", command: "guided setup" }
      : lastError
        ? { label: "Replay latest", command: "replay latest" }
      : unresolvedCount > 0
        ? { label: "Check status", command: "status" }
        : { label: "Run doctor", command: "social doctor" };
  const authIssue = Boolean(lastError && isSetupOrAuthError(lastError));

  useEffect(() => {
    if (!resolvedFocusedName || resolvedFocusedName === focusedWorkspace) return;
    setFocusedWorkspace(resolvedFocusedName);
  }, [focusedWorkspace, resolvedFocusedName]);

  const parseAndQueueIntent = useCallback(async (raw: string): Promise<void> => {
    const input = String(raw || "").trim();
    if (!input) return;

    const rewrittenInput = rewriteStudioShorthand(input);
    const isGuidedSetupRequest = /^(setup|start setup|guided setup|start|begin|get started|onboard|onboarding)$/i.test(rewrittenInput);
    const isNextActionRequest = rewrittenInput === "__next__" || looksLikeNextAction(rewrittenInput);
    const isWabaSetupRequest = /^(waba|whatsapp)\s+setup$/i.test(rewrittenInput) || /^setup\s+(waba|whatsapp)$/i.test(rewrittenInput);
    const authAssist = detectAuthAssist(rewrittenInput);
    const lowerInput = rewrittenInput.toLowerCase();
    const isRetryLatestRequest = /^(retry|replay)(\s+(latest|last))?$/.test(lowerInput);
    const isShowLogsRequest = /^(logs?|show\s+logs?|open\s+logs?)$/.test(lowerInput);
    const isFixLastErrorRequest = /^(fix|resolve)(\s+(last\s+)?(error|issue))?$/.test(lowerInput);
    const isFixTokenRequest = /^(fix|resolve|repair)\s+(whatsapp\s+)?(token|auth|login)$/.test(lowerInput);
    const isOpenTokenRequest = /^(open|launch|go to)\s+/.test(lowerInput)
      && /(token|dashboard|developer|developers|api setup|app dashboard|meta)/.test(lowerInput);
    const isHelpRequest = lowerInput !== "help"
      && /^(help|help me|what can i do|what can you do|menu|options|show options|show me options|commands|what can i run|what next)$/i.test(lowerInput);
    const isStatusRequest = lowerInput !== "status"
      && /^(status|check status|connection status|are we connected|am i connected)$/i.test(lowerInput);
    const isDoctorRequest = lowerInput !== "doctor"
      && /^(doctor|diagnose|health check|check health|run diagnostics)$/i.test(lowerInput);
    const openMatch = rewrittenInput.match(/^(open|resolve|retry|o|r)\s*(\d+)\s*$/i);

    if (isNextActionRequest) {
      addTurn("user", rewrittenInput);
      const recommended = nextAction;
      if (!recommended) {
        await streamAssistantTurn("No next action available yet. Try `guided setup` or `status`.");
        return;
      }
      await streamAssistantTurn(`Running next action: ${recommended.label}.`);
      dispatch({ type: "SET_INPUT", value: recommended.command });
      await parseAndQueueIntent(recommended.command);
      return;
    }

    if (isRetryLatestRequest) {
      addTurn("user", rewrittenInput);
      await streamAssistantTurn("Replaying the latest action.");
      dispatch({ type: "SET_INPUT", value: "replay latest" });
      await parseAndQueueIntent("replay latest");
      return;
    }

    if (isShowLogsRequest) {
      addTurn("user", rewrittenInput);
      await streamAssistantTurn("Showing recent logs.");
      dispatch({ type: "SET_INPUT", value: "logs limit 20" });
      await parseAndQueueIntent("logs limit 20");
      return;
    }

    if (isFixLastErrorRequest) {
      addTurn("user", rewrittenInput);
      if (!lastError) {
        await streamAssistantTurn("No recent errors found.");
        return;
      }
      if (authIssue || missingSetup.length > 0) {
        await streamAssistantTurn("Looks like an auth/setup issue. Starting guided setup.");
        dispatch({ type: "SET_INPUT", value: "guided setup" });
        await parseAndQueueIntent("guided setup");
        return;
      }
      await streamAssistantTurn("Replaying the latest action.");
      dispatch({ type: "SET_INPUT", value: "replay latest" });
      await parseAndQueueIntent("replay latest");
      return;
    }

    if (isFixTokenRequest) {
      addTurn("user", rewrittenInput);
      const currentConfig = configState.data;
      const targetApi = inferTokenApi(lowerInput, "whatsapp");
      const tokenSet = targetApi === "whatsapp"
        ? Boolean(currentConfig?.tokenMap.whatsapp)
        : targetApi === "instagram"
          ? Boolean(currentConfig?.tokenMap.instagram)
          : Boolean(currentConfig?.tokenMap.facebook || currentConfig?.tokenSet);
      if (tokenSet) {
        const followUp = targetApi === "whatsapp"
          ? "WhatsApp token is already connected. Next: social integrations connect waba."
          : "Token already connected. Try: status.";
        await streamAssistantTurn(followUp);
        return;
      }
      setPendingFlow({ kind: "auth_login", stage: "await_token", api: targetApi });
      if (targetApi === "whatsapp") setPostAuthAction("connect_waba");
      await streamAssistantTurn(buildTokenPrompt(targetApi, "Let's fix your token now."));
      await openTokenDashboard(targetApi, { force: true });
      return;
    }

    if (isHelpRequest) {
      addTurn("user", rewrittenInput);
      dispatch({ type: "SET_INPUT", value: "help" });
      await parseAndQueueIntent("help");
      return;
    }

    if (isStatusRequest) {
      addTurn("user", rewrittenInput);
      dispatch({ type: "SET_INPUT", value: "status" });
      await parseAndQueueIntent("status");
      return;
    }

    if (isDoctorRequest) {
      addTurn("user", rewrittenInput);
      dispatch({ type: "SET_INPUT", value: "doctor" });
      await parseAndQueueIntent("doctor");
      return;
    }

    if (isOpenTokenRequest) {
      addTurn("user", rewrittenInput);
      const fallbackApi: AuthApi = pendingFlow?.kind === "auth_login" && pendingFlow.stage === "await_token"
        ? pendingFlow.api
        : missingSetup.some((item) => item.label.toLowerCase().includes("whatsapp"))
          ? "whatsapp"
          : "facebook";
      const api = inferTokenApi(lowerInput, fallbackApi);
      await openTokenDashboard(api, { force: true });
      return;
    }

    if (openMatch) {
      addTurn("user", rewrittenInput);
      const verbRaw = String(openMatch[1] || "").toLowerCase();
      const verb = verbRaw === "o" ? "open" : verbRaw === "r" ? "retry" : verbRaw;
      const index = Number(openMatch[2]) - 1;
      const items = memory.unresolved || [];
      if (!items.length) {
        await streamAssistantTurn("No open items yet.");
        return;
      }
      if (!Number.isFinite(index) || index < 0 || index >= items.length) {
        await streamAssistantTurn(`Open items are 1-${items.length}. Try: open 1`);
        return;
      }
      const item = items[index];
      const hint = unresolvedHint(item);
      const summary = `Open item ${index + 1}: ${item.text} (${hint}).`;
      if (verb === "retry") {
        if (item.reason?.startsWith("execution_")) {
          await streamAssistantTurn(`${summary} Replaying the latest action.`);
          dispatch({ type: "SET_INPUT", value: "replay latest" });
          await parseAndQueueIntent("replay latest");
          return;
        }
        await streamAssistantTurn(`${summary} Retrying it now.`);
        dispatch({ type: "SET_INPUT", value: item.text });
        await parseAndQueueIntent(item.text);
        return;
      }
      if (item.reason?.startsWith("missing_slots")) {
        await streamAssistantTurn(`${summary} I can reload it so you can fill the missing fields. Type: retry ${index + 1}`);
        return;
      }
      if (item.reason === "intent_unresolved") {
        await streamAssistantTurn(`${summary} Try rephrasing it, or type: retry ${index + 1}`);
        return;
      }
      if (item.reason?.startsWith("execution_")) {
        await streamAssistantTurn(`${summary} I will show logs so you can diagnose it.`);
        dispatch({ type: "SET_INPUT", value: "logs limit 20" });
        await parseAndQueueIntent("logs limit 20");
        return;
      }
      await streamAssistantTurn(`${summary} Try: retry ${index + 1} or replay latest.`);
      return;
    }

    if (/^(open|retry|resolve)\s*$/i.test(rewrittenInput)) {
      addTurn("user", rewrittenInput);
      const items = memory.unresolved || [];
      if (!items.length) {
        await streamAssistantTurn("No open items yet.");
        return;
      }
      const preview = items.slice(0, 3).map((item, idx) => (
        `${idx + 1}. ${shortText(item.text, 72)} (${unresolvedHint(item)})`
      )).join("\n");
      await streamAssistantTurn(`Open items:\n${preview}\nType: open 1 or retry 1.`);
      return;
    }

    if (isGuidedSetupRequest) {
      addTurn("user", rewrittenInput);
      const currentConfig = configState.data;
      const currentWaba = currentConfig?.waba || {
        connected: false,
        businessId: "",
        wabaId: "",
        phoneNumberId: "",
        webhookCallbackUrl: "",
        webhookVerifyToken: ""
      };

      if (!currentConfig?.tokenMap.whatsapp) {
        setPendingFlow({ kind: "auth_login", stage: "await_token", api: "whatsapp" });
        setPostAuthAction("connect_waba");
        await streamAssistantTurn(buildTokenPrompt("whatsapp", "Let's connect WhatsApp first."));
        await openTokenDashboard("whatsapp");
        await streamAssistantTurn("After we verify it, I'll connect WhatsApp Business automatically.");
        return;
      }

      if (!currentWaba.wabaId || !currentWaba.phoneNumberId) {
        await streamAssistantTurn("Starting WhatsApp Business connection now.");
        await executeDirectRunCli({
          command: "social integrations connect waba",
          displayText: "social integrations connect waba",
          rememberAs: "waba connect"
        });
        return;
      }

      await streamAssistantTurn("Setup looks complete. Run: social doctor");
      return;
    }

    if (isWabaSetupRequest) {
      addTurn("user", rewrittenInput);
      const currentConfig = configState.data;
      const currentWaba = currentConfig?.waba || {
        connected: false,
        businessId: "",
        wabaId: "",
        phoneNumberId: "",
        webhookCallbackUrl: "",
        webhookVerifyToken: ""
      };
      if (!currentConfig?.tokenMap.whatsapp) {
        setPendingFlow({ kind: "auth_login", stage: "await_token", api: "whatsapp" });
        setPostAuthAction("connect_waba");
        await streamAssistantTurn(buildTokenPrompt("whatsapp", "Let's set up WhatsApp now."));
        await openTokenDashboard("whatsapp");
        await streamAssistantTurn("After we verify it, I'll connect WhatsApp Business automatically.");
        return;
      }
      if (!currentWaba.wabaId || !currentWaba.phoneNumberId) {
        await streamAssistantTurn("Starting WhatsApp Business connection now.");
        await executeDirectRunCli({
          command: "social integrations connect waba",
          displayText: "social integrations connect waba",
          rememberAs: "waba connect"
        });
        return;
      }
      await streamAssistantTurn("WhatsApp Business is already connected. Run: social doctor");
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
        setPostAuthAction(null);
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
      if (postAuthAction === "connect_waba" && targetApi === "whatsapp") {
        setPostAuthAction(null);
        await streamAssistantTurn("Next: connecting WhatsApp Business.");
        await executeDirectRunCli({
          command: "social integrations connect waba",
          displayText: "social integrations connect waba",
          rememberAs: "waba connect"
        });
        return;
      }
      setPostAuthAction(null);
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
      await openTokenDashboard(authAssist.api);
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
      const nextHint = nextAction ? ` Next: ${nextAction.label} — ${nextAction.command}.` : "";
      const fallback = `${opener}${pendingHint}${nextHint} Want \`status\` or \`help\`?`;
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
      const fallback = `Intent confidence is ${formatConfidence(intentConfidence)}. Confirm with Enter/y, or rephrase to improve intent match.`;
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
      ? "Awaiting approval. Press Enter/y to continue or n to reject."
      : `Ready to run ${parsed.intent.action} (${parsedRisk.toLowerCase()} risk). Press Enter/y to confirm, or n to reject.`;
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
    configState.data,
    pendingFlow,
    postAuthAction,
    runExecution,
    state.currentIntent,
    state.currentRisk,
    state.showDetails,
    lastError,
    authIssue,
    missingSetup,
    nextAction,
    executeDirectRunCli,
    openTokenDashboard,
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
      if (safeMode && state.currentRisk === "HIGH") {
        await streamAssistantTurn("Safe mode is on. High-risk actions are blocked. Press m to disable safe mode.");
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
      if (safeMode) {
        await streamAssistantTurn("Safe mode is on. High-risk actions are blocked. Press m to disable safe mode.");
        return;
      }
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
  }, [parseAndQueueIntent, runExecution, safeMode, state, streamAssistantTurn]);

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
      if (key.escape || input === "/" || input === "q") {
        setShowPalette(false);
        setPaletteQuery("");
      }
      return;
    }
    if (showGuidedMenu) {
      if (key.escape || input === "w" || input === "q") {
        setShowGuidedMenu(false);
      }
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
      onToggleBoardFilter: () => toggleBoardFilter(),
      onToggleAttentionMode: () => toggleAttentionMode(),
      onToggleSafeMode: () => toggleSafeMode(),
      onFocusPrev: () => cycleFocusedWorkspace("prev", opsFocusRows),
      onFocusNext: () => cycleFocusedWorkspace("next", opsFocusRows),
      onFocusRun: () => {
        if (!focusedOpsWorkspace) {
          addTurn("system", "No focused workspace yet.");
          return;
        }
        if (!focusedNextCommand) {
          addTurn("system", `No next action for ${focusedOpsWorkspace.name}.`);
          return;
        }
        dispatch({ type: "SET_INPUT", value: focusedNextCommand });
        void parseAndQueueIntent(focusedNextCommand);
      },
      onFocusActivate: () => {
        if (!focusedOpsWorkspace) {
          addTurn("system", "No focused workspace yet.");
          return;
        }
        if (focusedOpsWorkspace.name === activeWorkspaceName) {
          addTurn("system", `Already on workspace ${focusedOpsWorkspace.name}.`);
          return;
        }
        const command = `social accounts switch ${focusedOpsWorkspace.name}`;
        dispatch({ type: "SET_INPUT", value: command });
        void parseAndQueueIntent(command);
      },
      onFocusApprovals: () => {
        if (!focusedOpsWorkspace) {
          addTurn("system", "No focused workspace yet.");
          return;
        }
        dispatch({ type: "SET_INPUT", value: focusedApprovalsCommand });
        void parseAndQueueIntent(focusedApprovalsCommand);
      },
      onFocusAlerts: () => {
        if (!focusedOpsWorkspace) {
          addTurn("system", "No focused workspace yet.");
          return;
        }
        dispatch({ type: "SET_INPUT", value: focusedAlertsCommand });
        void parseAndQueueIntent(focusedAlertsCommand);
      },
      onToggleQuietMode: () => toggleQuietMode(),
      onHelpFix: () => {
        const command = missingSetup.length > 0 || authIssue
          ? "guided setup"
          : lastError
            ? "fix last error"
            : unresolvedCount > 0
              ? "status"
              : "social doctor";
        dispatch({ type: "SET_INPUT", value: command });
        void parseAndQueueIntent(command);
      },
      onToggleGuideOverlay: () => toggleGuideOverlay(),
      onPanicSummary: () => {
        const summary = buildPanicSummary();
        setPanicSummary({ text: summary, at: new Date().toISOString() });
        addTurn("assistant", `COPY BLOCK:\n${summary}`);
      },
      onDiagnosticPack: () => addTurn("assistant", buildDiagnosticPack()),
      onToggleGuidedMenu: () => toggleGuidedMenu(),
      onAdvanceOnboarding: () => advanceOnboarding(),
      onFixNow: () => {
        dispatch({ type: "SET_INPUT", value: fixNowAction.command });
        void parseAndQueueIntent(fixNowAction.command);
      },
      onPaletteToggle: () => {
        setPaletteQuery("");
        setShowPalette(true);
      },
      onGuide: () => {
        const command = "guided setup";
        dispatch({ type: "SET_INPUT", value: command });
        void parseAndQueueIntent(command);
      },
      onNextAction: () => {
        if (!nextAction) return;
        dispatch({ type: "SET_INPUT", value: nextAction.command });
        void parseAndQueueIntent(nextAction.command);
      },
      onLogs: () => {
        const command = "logs limit 20";
        dispatch({ type: "SET_INPUT", value: command });
        void parseAndQueueIntent(command);
      },
      onOpenItem: (index) => {
        const item = memory.unresolved[index];
        if (!item) return;
        const command = item.reason?.startsWith("execution_")
          ? `retry ${index + 1}`
          : `open ${index + 1}`;
        dispatch({ type: "SET_INPUT", value: command });
        void parseAndQueueIntent(command);
      },
      onQuickAction: (index) => {
        const item = quickActions[index];
        if (!item) return;
        dispatch({ type: "SET_INPUT", value: item.command });
        void parseAndQueueIntent(item.command);
      },
      onConfirm: () => void confirmOrExecute(),
      onReplayUp: () => setReplaySuggestionIndex((prev) => (prev === 0 ? replaySuggestions.length - 1 : prev - 1)),
      onReplayDown: () => setReplaySuggestionIndex((prev) => (prev + 1) % replaySuggestions.length),
      onQuit: () => exit()
    }, {
      phase: state.phase,
      hasDraftText: Boolean(String(draftInput || "").trim()),
      openItemsCount: Math.min(memory.unresolved.length, 3)
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

  const tokenOk = Boolean(config?.tokenMap.whatsapp);
  const wabaOk = Boolean(waba.wabaId && waba.phoneNumberId);
  const webhookOk = Boolean(waba.webhookCallbackUrl);
  const webhookBadge: "OK" | "FAIL" | "SKIP" = wabaOk ? (webhookOk ? "OK" : "FAIL") : "SKIP";
  const hasTokenGap = missingSetup.some((item) => item.label.toLowerCase().includes("access token"));
  const setupFixActions = dedupeQuickActions(
    missingSetup
      .filter((item) => item.fix)
      .map((item) => ({ label: item.label, command: String(item.fix) }))
  );
  const baseQuickActions = [
    { label: "Guided setup", command: "guided setup", show: missingSetup.length > 0 },
    { label: "Fix token (agent)", command: "fix token", show: !config?.tokenMap.whatsapp },
    { label: "Open WhatsApp token page", command: "open whatsapp token", show: !config?.tokenMap.whatsapp },
    { label: "Connect WhatsApp", command: "social auth login -a whatsapp", show: !config?.tokenMap.whatsapp },
    { label: "Connect WhatsApp Business", command: "social integrations connect waba", show: !waba.wabaId || !waba.phoneNumberId },
    { label: "Run doctor", command: "social doctor", show: true },
    {
      label: "Send test message",
      command: "social waba send --from PHONE_ID --to +15551234567 --body \"Hello\"",
      show: Boolean(waba.phoneNumberId)
    }
  ].filter((item) => item.show)
    .map((item) => ({ label: item.label, command: item.command }));
  const recoveryQuickActions: QuickAction[] = lastError
    ? [
      { label: "Fix last error", command: "fix last error" },
      { label: "Replay latest", command: "replay latest" },
      { label: "Show logs", command: "logs limit 20" }
    ]
    : unresolvedCount > 0
      ? [{ label: "Check status", command: "status" }]
      : [];
  const quickActions = dedupeQuickActions([...recoveryQuickActions, ...baseQuickActions]);
  const readyCount = setupChecklist.filter((item) => item.ok).length;
  const setupProgress = setupProgressBar(readyCount, setupChecklist.length);
  const nextSetup = missingSetup[0];
  const nextSetupLabel = nextSetup
    ? `${nextSetup.label}${nextSetup.fix ? ` -> ${nextSetup.fix}` : ""}`
    : "";
  const readinessLabel = missingSetup.length
    ? `setup ${readyCount}/${setupChecklist.length}`
    : "ready to send";
  const readinessTone = missingSetup.length ? theme.warning : theme.success;
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
  const rawAiProvider = String(process.env.SOCIAL_TUI_AI_VENDOR || process.env.SOCIAL_TUI_AI_PROVIDER || process.env.SOCIAL_AI_PROVIDER || "auto").trim().toLowerCase();
  const aiProvider = rawAiProvider === "claude" ? "anthropic" : rawAiProvider;
  const aiModel = process.env.SOCIAL_TUI_AI_MODEL || (
    aiProvider === "anthropic"
      ? "claude-3-5-sonnet-latest"
      : aiProvider === "openai"
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
  const actionHintBase = buildActionBarHint({
    phase: state.phase,
    hasIntent: Boolean(state.currentIntent),
    hasReplaySuggestions: replaySuggestions.length > 0,
    verboseMode,
    hasLastError: Boolean(lastError),
    hasOpenItems: unresolvedCount > 0,
    hasSetupGap: missingSetup.length > 0
  });
  const actionHint = hasTokenGap
    ? `${actionHintBase} | fix token | open whatsapp token`
    : actionHintBase;

  const recentQueue = state.actionQueue.slice(-5);
  const recentLogs = state.liveLogs.slice(-10);
  const recentRollbacks = state.rollbackHistory.slice(-5);
  const resultPreview = state.results ? JSON.stringify(state.results, null, 2) : "";
  const openItems = memory.unresolved.slice(0, 3);
  const lastRun = logItems[0];
  const lastRunStatus: "OK" | "FAIL" | "SKIP" = lastRun ? (lastRun.success ? "OK" : "FAIL") : "SKIP";
  const lastRunTone = lastRun ? (lastRun.success ? theme.success : theme.error) : theme.muted;
  const lastRunBorder = lastRun ? (lastRun.success ? theme.success : theme.error) : theme.muted;
  const lastRunTime = lastRun ? formatOpsTime(lastRun.timestamp) : "not run";
  const lastRunAction = lastRun ? lastRun.action : "none yet";
  const lastRunError = lastRun?.error ? shortText(lastRun.error, 140) : "";
  const safeModeLabel = safeMode ? "on" : "off";
  const opsUpdatedLabel = opsUpdatedAt ? formatOpsTime(opsUpdatedAt) : "never";
  const confidenceTierLabel = confidenceTier(state.currentConfidence);
  const confidenceTone = confidenceTierLabel === "high"
    ? theme.success
    : confidenceTierLabel === "medium"
      ? theme.warning
      : confidenceTierLabel === "low"
        ? theme.error
        : theme.muted;
  const confidenceHumanLabel = confidenceTierLabel === "high"
    ? "High"
    : confidenceTierLabel === "medium"
      ? "Medium"
      : confidenceTierLabel === "low"
        ? "Low"
        : "Unknown";
  const nextGuideCommand = missingSetup.length > 0 || authIssue
    ? "guided setup"
    : lastError
      ? "fix last error"
      : unresolvedCount > 0
        ? "open 1"
        : nextAction?.command || "social doctor";
  const nextGuideTitle = missingSetup.length > 0
    ? "Finish setup"
    : lastError
      ? "Fix the last error"
      : unresolvedCount > 0
        ? "Clear open items"
        : attentionOpsWorkspaces.length > 0
          ? "Review workspaces needing attention"
          : "You are ready";
  const nextGuideDetail = missingSetup.length > 0
    ? "We need a few setup steps before everything works."
    : lastError
      ? "The last action failed. Let's resolve it."
      : unresolvedCount > 0
        ? "There are open items waiting on you."
        : attentionOpsWorkspaces.length > 0
          ? "Some workspaces still need attention."
          : "No blockers right now.";
  const attentionClear = !lastError && missingSetup.length === 0 && openItems.length === 0 && attentionOpsWorkspaces.length === 0;
  const onboardingContent = onboardingSteps[Math.min(onboardingStep, onboardingSteps.length - 1)];
  const errorSuggestions = lastError ? buildErrorActionSuggestions(lastError, authIssue) : [];
  const guidedMenuOptions = useMemo(() => {
    const options = [
      { label: "Guided setup (recommended)", value: "guided setup" },
      { label: "Check status", value: "status" },
      { label: "Run doctor", value: "social doctor" },
      { label: "Next step", value: nextGuideCommand },
      focusedOpsWorkspace
        ? { label: `Review approvals (${focusedOpsWorkspace.name})`, value: focusedApprovalsCommand }
        : null,
      focusedOpsWorkspace
        ? { label: `Review alerts (${focusedOpsWorkspace.name})`, value: focusedAlertsCommand }
        : null,
      { label: "Send a WhatsApp message", value: "send message" },
      { label: "Create a post", value: "create post" }
    ].filter((item): item is { label: string; value: string } => Boolean(item && item.value));

    const seen = new Set<string>();
    return options.filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
  }, [focusedAlertsCommand, focusedApprovalsCommand, focusedOpsWorkspace, nextGuideCommand]);
  const hotkeyTips = useMemo(() => {
    const tips: string[] = [];
    tips.push("z fix now");
    if (missingSetup.length > 0 || authIssue || lastError) tips.push("h help fix");
    tips.push(showGuideOverlay ? "i hide guide" : "i show guide");
    tips.push(showGuidedMenu ? "w close menu" : "w menu");
    tips.push(showOnboarding ? "t next tutorial" : "t tutorial");
    tips.push(safeMode ? "m safe mode on" : "m safe mode off");
    if (openItems.length > 0) tips.push(`1-${Math.min(3, openItems.length)} open item`);
    if (focusedOpsWorkspace) tips.push("f run focus");
    if (opsWorkspaces.length > 0) tips.push("b board");
    return tips.slice(0, 5);
  }, [
    authIssue,
    focusedOpsWorkspace,
    lastError,
    missingSetup.length,
    openItems.length,
    opsWorkspaces.length,
    safeMode,
    showGuideOverlay,
    showGuidedMenu,
    showOnboarding
  ]);
  const focusTone = missingSetup.length
    ? theme.warning
    : lastError
      ? authIssue ? theme.warning : theme.error
      : unresolvedCount > 0
        ? theme.warning
        : theme.success;
  const focusTitle = missingSetup.length
    ? "Finish setup"
    : lastError
      ? authIssue ? "Fix auth" : "Resolve last error"
      : unresolvedCount > 0
        ? "Clear open items"
        : "Ready for requests";
  const focusDetail = missingSetup.length
    ? `${missingSetup.length} setup checks still need attention.`
    : lastError
      ? shortText(lastError, 140)
      : unresolvedCount > 0
        ? `${unresolvedCount} open item${unresolvedCount === 1 ? "" : "s"} waiting.`
        : "You're clear to run commands.";
  const focusReason = missingSetup.length
    ? "Setup checks are blocking full functionality."
    : lastError
      ? authIssue ? "Auth or permissions are blocking execution." : "The last action failed and needs recovery."
      : unresolvedCount > 0
        ? "There are unresolved items waiting on you."
        : "All systems ready.";
  const focusActions = missingSetup.length
    ? dedupeQuickActions([{ label: "Guided setup", command: "guided setup" }, ...setupFixActions]).slice(0, 3)
    : lastError
      ? authIssue
        ? [
          { label: "Fix last error", command: "fix last error" },
          { label: "Guided setup", command: "guided setup" },
          { label: "Check status", command: "status" },
          { label: "Show logs", command: "logs limit 20" }
        ]
        : [
          { label: "Fix last error", command: "fix last error" },
          { label: "Replay latest", command: "replay latest" },
          { label: "Show logs", command: "logs limit 20" }
        ]
      : unresolvedCount > 0
        ? [
          { label: "Check status", command: "status" },
          { label: "Show logs", command: "logs limit 20" }
        ]
        : [
          { label: "Run doctor", command: "social doctor" },
          { label: "Check status", command: "status" }
        ];
  const recentFail = logItems.find((x) => !x.success);
  const lastActionLabel = recentFail
    ? `${recentFail.action}${recentFail.error ? ` — ${shortText(recentFail.error, 90)}` : ""}`
    : "";
  const fixNowAction = (() => {
    if (missingSetup.length > 0 || authIssue) {
      return { label: "Run guided setup", command: "guided setup" };
    }
    if (lastError) {
      return { label: "Fix last error", command: "fix last error" };
    }
    if (unresolvedCount > 0) {
      return { label: "Open first item", command: "open 1" };
    }
    if (opsNeedsAttention > 0) {
      if (focusedOpsWorkspace?.approvalsOpen) {
        return { label: "Review approvals", command: focusedApprovalsCommand };
      }
      if (focusedOpsWorkspace?.alertsOpen) {
        return { label: "Review alerts", command: focusedAlertsCommand };
      }
      return { label: "Review ops center", command: "social ops center" };
    }
    return { label: "Run doctor", command: "social doctor" };
  })();

  const buildPanicSummary = useCallback(() => {
    const lines = [
      "PANIC SUMMARY",
      `time: ${formatOpsTime(new Date().toISOString())}`,
      `profile: ${config?.activeProfile || "default"}`,
      `safe mode: ${safeModeLabel} | attention: ${attentionMode ? "on" : "off"} | quiet: ${quietMode ? "on" : "off"}`,
      `last action: ${lastRunAction} (${lastRunStatus}) at ${lastRunTime}`,
      `error: ${lastRunError || "none"}`,
      `open items: ${unresolvedCount}`,
      `ops attention: ${opsNeedsAttention}/${opsWorkspaces.length}`,
      `ops updated: ${opsUpdatedLabel}`
    ];
    const recent = logItems.slice(0, 3).map((item) => (
      `${item.success ? "OK" : "FAIL"} ${item.action} @ ${shortTime(item.timestamp)}${item.error ? ` — ${shortText(item.error, 80)}` : ""}`
    ));
    if (recent.length) {
      lines.push("recent logs:");
      lines.push(...recent);
    }
    return lines.join("\n");
  }, [
    attentionMode,
    config?.activeProfile,
    lastRunAction,
    lastRunError,
    lastRunStatus,
    lastRunTime,
    logItems,
    opsNeedsAttention,
    opsUpdatedLabel,
    opsWorkspaces.length,
    quietMode,
    safeModeLabel,
    unresolvedCount
  ]);

  const buildDiagnosticPack = useCallback(() => {
    const lines = [
      "SOCIAL FLOW DIAGNOSTIC PACK",
      `generated: ${formatOpsTime(new Date().toISOString())}`,
      `profile: ${config?.activeProfile || "default"}`,
      `token: ${tokenOk ? "ok" : "missing"} | waba: ${wabaOk ? "ok" : "missing"} | webhook: ${webhookBadge}`,
      `safe mode: ${safeModeLabel} | attention: ${attentionMode ? "on" : "off"} | quiet: ${quietMode ? "on" : "off"}`,
      `last action: ${lastRunAction} (${lastRunStatus}) at ${lastRunTime}`,
      `last error: ${lastRunError || "none"}`,
      `setup gaps: ${missingSetup.length}`,
      `open items: ${unresolvedCount}`,
      `ops updated: ${opsUpdatedLabel}`,
      `ops attention: ${opsNeedsAttention}/${opsWorkspaces.length}`
    ];
    const opsRows = opsWorkspaces.slice(0, 5).map((row) => (
      `- ${row.name}: approvals=${row.approvalsOpen} alerts=${row.alertsOpen} last_check=${row.lastMorningRunDate || "not run"} next=${row.nextAction}`
    ));
    if (opsRows.length) {
      lines.push("ops workspaces:");
      lines.push(...opsRows);
      if (opsWorkspaces.length > opsRows.length) {
        lines.push(`...and ${opsWorkspaces.length - opsRows.length} more`);
      }
    }
    const recent = logItems.slice(0, 5).map((item) => (
      `${item.success ? "OK" : "FAIL"} ${item.action} @ ${shortTime(item.timestamp)}${item.error ? ` — ${shortText(item.error, 120)}` : ""}`
    ));
    if (recent.length) {
      lines.push("recent logs:");
      lines.push(...recent);
    }
    return lines.join("\n");
  }, [
    attentionMode,
    config?.activeProfile,
    lastRunAction,
    lastRunError,
    lastRunStatus,
    lastRunTime,
    logItems,
    missingSetup.length,
    opsNeedsAttention,
    opsUpdatedLabel,
    opsWorkspaces,
    quietMode,
    safeModeLabel,
    tokenOk,
    unresolvedCount,
    wabaOk,
    webhookBadge
  ]);
  const paletteOptions = [
    ...quickActions.map((item) => ({ label: `Quick: ${item.label}`, value: item.command, show: true })),
    ...setupFixActions.map((item) => ({ label: `Setup: ${item.label}`, value: item.command, show: true })),
    { label: "Guided setup (recommended)", value: "guided setup", show: missingSetup.length > 0 || authIssue },
    nextAction ? { label: `Next step: ${nextAction.label}`, value: nextAction.command, show: true } : null,
    lastError ? { label: "Fix last error", value: "fix last error", show: true } : null,
    { label: "Doctor", value: "doctor", show: true },
    { label: "Status", value: "status", show: true },
    { label: "Ops center", value: "social ops center", show: true },
    { label: "Workspace check", value: "social accounts check --only needs-setup", show: true },
    { label: "Why this plan", value: "__why__", show: true },
    { label: "WABA setup guide", value: "waba setup", show: true },
    { label: "WABA send example", value: "social waba send --from PHONE_ID --to +15551234567 --body \"Hello\"", show: true },
    { label: "Config", value: "config", show: true },
    { label: "Logs", value: "logs limit 20", show: true },
    { label: "Replay latest", value: "replay latest", show: true },
    { label: "Get profile", value: "get my facebook profile", show: true },
    { label: "List ads", value: "list ads account act_123", show: true },
    { label: "Create post", value: "create post \"Launch update\" page 12345", show: true },
    { label: "AI parse", value: "/ai show my facebook pages", show: true }
  ].filter((item): item is { label: string; value: string; show: boolean } => Boolean(item && item.show))
    .reduce<Array<{ label: string; value: string }>>((acc, item) => {
      if (acc.some((entry) => entry.value === item.value)) return acc;
      acc.push({ label: item.label, value: item.value });
      return acc;
    }, []);
  const paletteFilter = paletteQuery.trim().toLowerCase();
  const filteredPaletteOptions = paletteFilter
    ? paletteOptions.filter((item) => (
      item.label.toLowerCase().includes(paletteFilter)
      || item.value.toLowerCase().includes(paletteFilter)
    ))
    : paletteOptions;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <StatusBadge label={tokenOk ? "OK" : "FAIL"} tone={tokenOk ? "ok" : "fail"} />
        <Text color={theme.muted}> token </Text>
        <StatusBadge label={wabaOk ? "OK" : "FAIL"} tone={wabaOk ? "ok" : "fail"} />
        <Text color={theme.muted}> waba </Text>
        <StatusBadge label={webhookBadge} tone={webhookBadge === "OK" ? "ok" : webhookBadge === "FAIL" ? "fail" : "skip"} />
        <Text color={theme.muted}> webhook </Text>
        <Text color={theme.muted}>| profile {config?.activeProfile || "default"}</Text>
      </Box>
      <SectionHeading label="Last action" />
      <FramedBlock title="Last action" borderColor={lastRunBorder}>
        {lastRun ? (
          <>
            <Box>
              <StatusBadge label={lastRunStatus} tone={lastRun.success ? "ok" : "fail"} />
              <Text color={lastRunTone}> {lastRunAction}</Text>
            </Box>
            <Text color={theme.muted}>time {lastRunTime}</Text>
            <Text color={confidenceTone}>confidence {confidenceHumanLabel} ({confidenceLabel})</Text>
            {lastRunError ? (
              <Text color={theme.warning}>error: {lastRunError}</Text>
            ) : null}
            <Text color={theme.muted}>
              {lastRun.success
                ? "All good. Tip: press n for the next step."
                : "Needs attention. Tip: type \"fix last error\" or \"replay latest\"."}
            </Text>
          </>
        ) : (
          <>
            <Box>
              <StatusBadge label="SKIP" tone="skip" />
              <Text color={theme.muted}> No actions yet.</Text>
            </Box>
            <Text color={confidenceTone}>confidence {confidenceHumanLabel} ({confidenceLabel})</Text>
            <Text color={theme.muted}>Try: guided setup | status | social doctor</Text>
          </>
        )}
      </FramedBlock>
      {showGuideOverlay ? (
        <>
          <SectionHeading label="Next step guide" />
          <FramedBlock title="Next step" borderColor={theme.accent}>
            <Text color={theme.text}>{nextGuideTitle}</Text>
            <Text color={theme.muted}>{nextGuideDetail}</Text>
            <Text color={theme.accent}>Do this: {nextGuideCommand}</Text>
            <Text color={theme.muted}>Tip: press h for help fixing issues.</Text>
            <Text color={theme.muted}>Tip: press i to hide this guide.</Text>
          </FramedBlock>
        </>
      ) : null}
      {panicSummary ? (
        <>
          <SectionHeading label="Copy block" />
          <FramedBlock title={`Panic summary (${formatOpsTime(panicSummary.at)})`} borderColor={theme.warning}>
            <Text color={theme.warning}>Copy everything below and paste it into support.</Text>
            <Box marginTop={1} flexDirection="column">
              {panicSummary.text.split("\n").map((line, idx) => (
                <Text key={`panic-${idx}`} color={theme.muted}>{line}</Text>
              ))}
            </Box>
            <Text color={theme.muted}>Tip: press p to refresh this summary.</Text>
          </FramedBlock>
        </>
      ) : null}
      {showOnboarding ? (
        <>
          <SectionHeading label="Getting started" />
          <FramedBlock title={`Step ${onboardingStep + 1}/${onboardingSteps.length}`} borderColor={theme.accent}>
            <Text color={theme.text}>{onboardingContent.title}</Text>
            <Text color={theme.muted}>{onboardingContent.detail}</Text>
            <Text color={theme.accent}>{onboardingContent.action}</Text>
            <Text color={theme.muted}>Press t to continue.</Text>
            <Text color={theme.muted}>Tip: press w for the guided menu.</Text>
          </FramedBlock>
        </>
      ) : null}
      {attentionMode ? (
        <>
          <SectionHeading label="Attention mode" />
          <FramedBlock title="Attention mode" borderColor={theme.warning}>
          <Text color={theme.warning}>Showing only critical panels.</Text>
          <Text color={theme.muted}>Press c to return to the full view. Press v for quiet mode.</Text>
          </FramedBlock>
        </>
      ) : (
        <>
          <SectionHeading label="Ask Flow" />
          <FramedBlock title="Runtime">
            <Text color={theme.text}>
              profile {config?.activeProfile || "default"} | session {shortText(memory.sessionId, 22)} | connected {connectedCount}/3 | ai {aiLabel}
            </Text>
        <Text color={phaseTone}>
          phase {state.phase.toLowerCase()} | risk {(state.currentRisk || "LOW").toLowerCase()} | confidence {confidenceLabel} | safe {safeModeLabel} | account {selectedAccount}
        </Text>
            <Text color={theme.muted}>
              industry {industryLabel} | memory {memoryLabel} | open items {unresolvedCount} | runtime {runtimeLabel}
            </Text>
            <Text color={readinessTone}>readiness {readinessLabel}</Text>
            <Text color={theme.muted}>
              setup progress {setupProgress} ({readyCount}/{setupChecklist.length})
            </Text>
            {missingSetup.length ? (
              <Text color={theme.warning}>next: {nextSetupLabel}</Text>
            ) : null}
            {missingSetup.length ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.warning}>setup checklist</Text>
                {setupChecklist.map((item) => (
                  <Box key={item.label} flexDirection="column">
                    <Box>
                      <StatusBadge label={item.ok ? "OK" : "FAIL"} tone={item.ok ? "ok" : "fail"} />
                      <Text color={item.ok ? theme.text : theme.warning}>
                        {" "}{item.label}{item.ok ? "" : item.fix ? ` -> ${item.fix}` : ""}
                      </Text>
                    </Box>
                    {!item.ok && item.hint ? <Text color={theme.muted}>  {item.hint}</Text> : null}
                  </Box>
                ))}
              </Box>
            ) : (
              <Box>
                <StatusBadge label="OK" tone="ok" />
                <Text color={theme.success}> setup checklist: all green.</Text>
              </Box>
            )}
            <Text color={theme.muted}>
              latest {topActivity ? `${shortTime(topActivity.at)} ${topActivity.message.slice(0, 72)}` : "idle"}
            </Text>
            {configState.loading ? <Text color={theme.muted}>config loading...</Text> : null}
            {configState.error ? <Text color={theme.error}>config error: {configState.error}</Text> : null}
          </FramedBlock>
        </>
      )}

      {lastError ? (
        <>
          <SectionHeading label="Recovery" />
          <FramedBlock title="Recovery" borderColor={theme.error}>
            <Box>
              <StatusBadge label="FAIL" tone="fail" />
              <Text color={theme.error}> Last error: {shortText(lastError, 160)}</Text>
            </Box>
            {unresolvedCount === 0 ? (
              <Text color={theme.muted}>Hotkeys: 1 Fix last error | 2 Replay latest | 3 Show logs</Text>
            ) : (
              <Text color={theme.muted}>Tip: open items take 1-3; type the recovery commands below.</Text>
            )}
            <Text color={theme.muted}>Commands: fix last error | replay latest | logs limit 20</Text>
            {errorSuggestions.length ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.accent}>Try this next</Text>
                {errorSuggestions.map((item) => (
                  <Box key={item.command} marginTop={1} flexDirection="column">
                    <Text color={theme.text}>{item.label}</Text>
                    {item.detail ? <Text color={theme.muted}>{item.detail}</Text> : null}
                    <Text color={theme.muted}>copy: {item.command}</Text>
                  </Box>
                ))}
                <Text color={theme.muted}>Tip: press z to run Fix it now.</Text>
              </Box>
            ) : null}
          </FramedBlock>
        </>
      ) : null}

      {configState.loading ? null : attentionMode ? (
        <>
          {missingSetup.length ? (
            <>
              <SectionHeading label="Setup needs attention" />
              <FramedBlock title="Setup gaps" borderColor={theme.warning}>
                {missingSetup.map((item) => (
                  <Box key={item.label} marginTop={1} flexDirection="column">
                    <Box>
                      <Text color={theme.warning}>NEEDS {item.label}</Text>
                    </Box>
                    {item.hint ? <Text color={theme.muted}>{item.hint}</Text> : null}
                    {item.fix ? <Text color={theme.accent}>Do this (copy/paste): {item.fix}</Text> : null}
                  </Box>
                ))}
              </FramedBlock>
            </>
          ) : null}

          <SectionHeading label="Agency board" />
          <FramedBlock title="Ops center">
            {opsState.loading ? <Text color={theme.muted}>loading ops center...</Text> : null}
            {opsState.error ? <Text color={theme.error}>ops center error: {opsState.error}</Text> : null}
            {!opsState.loading && !opsState.error ? (
              opsWorkspaces.length ? (
                <Box flexDirection="column">
                  <Text color={theme.muted}>
                    workspaces {opsWorkspaces.length} | approvals {opsApprovalsOpen} | alerts {opsAlertsOpen} | needs attention {opsNeedsAttention} | updated {opsUpdatedLabel}
                  </Text>
                  <Text color={theme.muted}>
                    {attentionMode
                      ? `attention mode: ${opsViewLabel} | showing ${opsRowsToShow.length} of ${opsWorkspaces.length}`
                      : `view ${opsViewLabel} (press b to toggle) | showing ${opsRowsToShow.length} of ${opsWorkspaces.length}`}
                  </Text>
                  {opsRowsToShow.length ? (
                    opsRowsToShow.map((row) => {
                      const isActive = row.name === activeWorkspaceName;
                      const isFocused = row.name === resolvedFocusedName;
                      const approvalsTone = row.approvalsOpen > 0 ? "fail" : "ok";
                      const alertsTone = row.alertsOpen > 0 ? "fail" : "ok";
                      const lastCheck = row.lastMorningRunDate ? row.lastMorningRunDate : "not run";
                      const lastActivity = row.lastActivity ? formatOpsTime(row.lastActivity) : "none";
                      const nextCommand = buildOpsNextCommand(row);
                      return (
                        <Box key={row.name} marginTop={1} flexDirection="column">
                          <Box>
                            <Text color={isActive ? theme.success : theme.text}>
                              {row.name}{isActive ? " (active)" : ""}{isFocused ? " [focus]" : ""}
                            </Text>
                            <Text color={theme.muted}> approvals </Text>
                            <StatusBadge label={row.approvalsOpen > 0 ? "FAIL" : "OK"} tone={approvalsTone} />
                            <Text color={theme.muted}> {row.approvalsOpen} </Text>
                            <Text color={theme.muted}> alerts </Text>
                            <StatusBadge label={row.alertsOpen > 0 ? "FAIL" : "OK"} tone={alertsTone} />
                            <Text color={theme.muted}> {row.alertsOpen}</Text>
                          </Box>
                          <Text color={theme.muted}>last check {lastCheck} | last activity {lastActivity}</Text>
                          <Text color={theme.muted}>next: {row.nextAction}</Text>
                          {nextCommand ? (
                            <Text color={theme.accent}>Run: {nextCommand}</Text>
                          ) : null}
                        </Box>
                      );
                    })
                  ) : (
                    <Text color={theme.muted}>
                      {attentionMode ? "No workspaces need attention." : "No workspaces match this view. Press b to show all."}
                    </Text>
                  )}
                  {focusedOpsWorkspace ? (
                    <Box marginTop={1} flexDirection="column">
                      <Text color={theme.accent}>Focused workspace</Text>
                      <Text color={theme.text}>
                        {focusedOpsWorkspace.name}{focusedOpsWorkspace.name === activeWorkspaceName ? " (active)" : ""}
                      </Text>
                      <Text color={theme.muted}>
                        approvals {focusedOpsWorkspace.approvalsOpen} | alerts {focusedOpsWorkspace.alertsOpen} | last check {focusedOpsWorkspace.lastMorningRunDate || "not run"} | last activity {focusedOpsWorkspace.lastActivity ? formatOpsTime(focusedOpsWorkspace.lastActivity) : "none"}
                      </Text>
                      <Text color={theme.muted}>next: {focusedOpsWorkspace.nextAction}</Text>
                      {focusedNextCommand ? (
                        <Text color={theme.accent}>Run: {focusedNextCommand}</Text>
                      ) : null}
                      <Text color={theme.accent}>Approvals (a): {focusedApprovalsCommand}</Text>
                      <Text color={theme.accent}>Alerts (e): {focusedAlertsCommand}</Text>
                      <Text color={theme.muted}>Tip: press s to switch to the focused workspace.</Text>
                    </Box>
                  ) : null}
                  <Text color={theme.muted}>Tip: press b to filter to needs attention or all clear.</Text>
                  <Text color={theme.muted}>Tip: press [ and ] to move focus across workspaces.</Text>
                  <Text color={theme.muted}>Tip: press f to run the focused workspace next action.</Text>
                  <Text color={theme.muted}>Tip: press s to switch to the focused workspace.</Text>
                  <Text color={theme.muted}>Tip: press a for approvals, e for alerts.</Text>
                  <Text color={theme.muted}>Tip: press c to toggle attention mode.</Text>
                  <Text color={theme.muted}>Tip: press v for quiet mode.</Text>
                  <Text color={theme.muted}>Tip: press h for help fixing issues.</Text>
                  <Text color={theme.muted}>Tip: press i to show the next step guide.</Text>
                  <Text color={theme.muted}>Tip: run "social ops center" for a full CLI view.</Text>
                </Box>
              ) : (
                <Text color={theme.muted}>No workspaces found. Add one with: social accounts add &lt;name&gt;</Text>
              )
            ) : null}
          </FramedBlock>

          {openItems.length ? (
            <>
              <SectionHeading label="Open items" />
              <FramedBlock title="Open items">
                <Box marginTop={1} flexDirection="column">
                  <Text color={theme.accent}>Open items</Text>
                  {openItems.map((item, idx) => (
                    <Box key={`${item.at}-${item.text}`}>
                      <StatusBadge label="FAIL" tone="fail" />
                      <Text color={theme.muted}>
                        {" "}[{idx + 1}] {shortText(item.text, 90)} ({unresolvedHint(item)}) — open {idx + 1} | retry {idx + 1} | o{idx + 1} | r{idx + 1}
                      </Text>
                    </Box>
                  ))}
                  <Text color={theme.muted}>Tip: press 1-3 to open/retry an item quickly.</Text>
                </Box>
              </FramedBlock>
            </>
          ) : null}

          {attentionClear ? (
            <>
              <SectionHeading label="All clear" />
              <FramedBlock title="All clear" borderColor={theme.success}>
                <Text color={theme.success}>No critical items right now.</Text>
                <Text color={theme.muted}>Press c to return to the full view.</Text>
              </FramedBlock>
            </>
          ) : null}
        </>
      ) : (
        <>
          <SectionHeading label="Focus" />
          <FramedBlock title="Next move" borderColor={focusTone}>
            <Text color={focusTone}>{focusTitle}</Text>
            <Text color={theme.muted}>{focusDetail}</Text>
            <Text color={theme.muted}>Reason: {focusReason}</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.accent}>Fix it now: {fixNowAction.label}</Text>
              <Text color={theme.muted}>press z or copy: {fixNowAction.command}</Text>
            </Box>
            {lastActionLabel ? (
              <Text color={theme.muted}>Last failed action: {lastActionLabel}</Text>
            ) : null}
            {focusActions.length ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.accent}>Suggested actions</Text>
                {focusActions.map((action) => (
                  <Box key={action.command} marginTop={1} flexDirection="column">
                    <Text color={theme.text}>{action.label}</Text>
                    <Text color={theme.muted}>copy: {action.command}</Text>
                  </Box>
                ))}
              </Box>
            ) : null}
            {nextAction ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.text}>Next action: {nextAction.label}</Text>
                <Text color={theme.muted}>copy: {nextAction.command}</Text>
              </Box>
            ) : null}
            <Text color={theme.muted}>Tip: press n to run the next action, or l to show logs.</Text>
          </FramedBlock>

          <SectionHeading label="Quick actions" />
          <FramedBlock title="Quick actions">
            {quickActions.map((item, idx) => (
              <Box key={item.command} marginTop={1} flexDirection="column">
                <Text color={theme.text}>{`[${idx + 1}] ${item.label}`}</Text>
                <Text color={theme.muted}>copy: {item.command}</Text>
              </Box>
            ))}
            {nextAction ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.text}>Next step: {nextAction.label}</Text>
                <Text color={theme.muted}>copy: {nextAction.command}</Text>
              </Box>
            ) : null}
            <Text color={theme.muted}>Tip: copy/paste any line above into chat to run it.</Text>
            <Text color={theme.muted}>Tip: start with the first action if you're unsure.</Text>
            {quickActions.length ? (
              <Text color={theme.muted}>Tip: press 1-{Math.min(9, quickActions.length)} to run a step instantly.</Text>
            ) : null}
            {openItems.length ? (
              <Text color={theme.muted}>Tip: if open items exist, 1-3 targets them before quick actions.</Text>
            ) : null}
            <Text color={theme.muted}>Tip: press g or type /start for guided setup, n or /next for next step.</Text>
            <Text color={theme.muted}>Tip: type /fix to recover from the last error.</Text>
            <Text color={theme.muted}>Tip: type "waba setup" for WhatsApp only.</Text>
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

          <SectionHeading label="Agency board" />
          <FramedBlock title="Ops center">
            {opsState.loading ? <Text color={theme.muted}>loading ops center...</Text> : null}
            {opsState.error ? <Text color={theme.error}>ops center error: {opsState.error}</Text> : null}
            {!opsState.loading && !opsState.error ? (
              opsWorkspaces.length ? (
                <Box flexDirection="column">
                  <Text color={theme.muted}>
                    workspaces {opsWorkspaces.length} | approvals {opsApprovalsOpen} | alerts {opsAlertsOpen} | needs attention {opsNeedsAttention}
                  </Text>
                  <Text color={theme.muted}>
                    {attentionMode
                      ? `attention mode: ${opsViewLabel} | showing ${opsRowsToShow.length} of ${opsWorkspaces.length}`
                      : `view ${opsViewLabel} (press b to toggle) | showing ${opsRowsToShow.length} of ${opsWorkspaces.length}`}
                  </Text>
                  {opsRowsToShow.length ? (
                    opsRowsToShow.map((row) => {
                      const isActive = row.name === activeWorkspaceName;
                      const isFocused = row.name === resolvedFocusedName;
                      const approvalsTone = row.approvalsOpen > 0 ? "fail" : "ok";
                      const alertsTone = row.alertsOpen > 0 ? "fail" : "ok";
                      const lastCheck = row.lastMorningRunDate ? row.lastMorningRunDate : "not run";
                      const lastActivity = row.lastActivity ? formatOpsTime(row.lastActivity) : "none";
                      const nextCommand = buildOpsNextCommand(row);
                      return (
                        <Box key={row.name} marginTop={1} flexDirection="column">
                          <Box>
                            <Text color={isActive ? theme.success : theme.text}>
                              {row.name}{isActive ? " (active)" : ""}{isFocused ? " [focus]" : ""}
                            </Text>
                            <Text color={theme.muted}> approvals </Text>
                            <StatusBadge label={row.approvalsOpen > 0 ? "FAIL" : "OK"} tone={approvalsTone} />
                            <Text color={theme.muted}> {row.approvalsOpen} </Text>
                            <Text color={theme.muted}> alerts </Text>
                            <StatusBadge label={row.alertsOpen > 0 ? "FAIL" : "OK"} tone={alertsTone} />
                            <Text color={theme.muted}> {row.alertsOpen}</Text>
                          </Box>
                          <Text color={theme.muted}>last check {lastCheck} | last activity {lastActivity}</Text>
                          <Text color={theme.muted}>next: {row.nextAction}</Text>
                          {nextCommand ? (
                            <Text color={theme.accent}>Run: {nextCommand}</Text>
                          ) : null}
                        </Box>
                      );
                    })
                  ) : (
                    <Text color={theme.muted}>
                      {attentionMode ? "No workspaces need attention." : "No workspaces match this view. Press b to show all."}
                    </Text>
                  )}
                  {focusedOpsWorkspace ? (
                    <Box marginTop={1} flexDirection="column">
                      <Text color={theme.accent}>Focused workspace</Text>
                      <Text color={theme.text}>
                        {focusedOpsWorkspace.name}{focusedOpsWorkspace.name === activeWorkspaceName ? " (active)" : ""}
                      </Text>
                      <Text color={theme.muted}>
                        approvals {focusedOpsWorkspace.approvalsOpen} | alerts {focusedOpsWorkspace.alertsOpen} | last check {focusedOpsWorkspace.lastMorningRunDate || "not run"} | last activity {focusedOpsWorkspace.lastActivity ? formatOpsTime(focusedOpsWorkspace.lastActivity) : "none"}
                      </Text>
                      <Text color={theme.muted}>next: {focusedOpsWorkspace.nextAction}</Text>
                      {focusedNextCommand ? (
                        <Text color={theme.accent}>Run: {focusedNextCommand}</Text>
                      ) : null}
                      <Text color={theme.muted}>Tip: switch active workspace with "social accounts switch &lt;name&gt;".</Text>
                    </Box>
                  ) : null}
                  <Text color={theme.muted}>Tip: press b to filter to needs attention or all clear.</Text>
                  <Text color={theme.muted}>Tip: press [ and ] to move focus across workspaces.</Text>
                  <Text color={theme.muted}>Tip: press f to run the focused workspace next action.</Text>
                  <Text color={theme.muted}>Tip: press c to toggle attention mode.</Text>
                  <Text color={theme.muted}>Tip: run "social ops center" for a full CLI view.</Text>
                </Box>
              ) : (
                <Text color={theme.muted}>No workspaces found. Add one with: social accounts add &lt;name&gt;</Text>
              )
            ) : null}
          </FramedBlock>

          <SectionHeading label="Workspaces" />
          <FramedBlock title="Access status">
            {profileSummary.length ? (
              profileSummary.map((p) => (
                <Box key={p.name}>
                  <Text color={p.name === config?.activeProfile ? theme.success : theme.text}>
                    {p.name}{p.name === config?.activeProfile ? " (active)" : ""}
                  </Text>
                  <Text color={theme.muted}> — access </Text>
                  <StatusBadge label={p.tokenSet ? "OK" : "FAIL"} tone={p.tokenSet ? "ok" : "fail"} />
                  <Text color={theme.muted}> | WhatsApp business </Text>
                  <StatusBadge label={p.wabaConnected ? "OK" : "FAIL"} tone={p.wabaConnected ? "ok" : "fail"} />
                  <Text color={theme.muted}> | WhatsApp phone </Text>
                  <StatusBadge label={p.phoneNumberId ? "OK" : "FAIL"} tone={p.phoneNumberId ? "ok" : "fail"} />
                </Box>
              ))
            ) : (
              <Text color={theme.muted}>No profiles found. Add one with: social accounts add &lt;name&gt;</Text>
            )}
            <Text color={theme.muted}>Switch workspace: social accounts switch &lt;name&gt;</Text>
          </FramedBlock>

          <FramedBlock title="Activity">
            <Box>
              <Text color={theme.text}>Runs: </Text>
              <StatusBadge label="OK" tone="ok" />
              <Text color={theme.text}> {successCount} </Text>
              <StatusBadge label="FAIL" tone="fail" />
              <Text color={theme.text}> {failCount}</Text>
            </Box>
            {lastError ? (
              <Box>
                <StatusBadge label="FAIL" tone="fail" />
                <Text color={theme.warning}> Last error: {shortText(lastError, 140)}</Text>
              </Box>
            ) : (
              <Box>
                <StatusBadge label="OK" tone="ok" />
                <Text color={theme.muted}> No recent errors.</Text>
              </Box>
            )}
            {openItems.length ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.accent}>Open items</Text>
                {openItems.map((item, idx) => (
                  <Box key={`${item.at}-${item.text}`}>
                    <StatusBadge label="FAIL" tone="fail" />
                    <Text color={theme.muted}>
                      {" "}[{idx + 1}] {shortText(item.text, 90)} ({unresolvedHint(item)}) — open {idx + 1} | retry {idx + 1} | o{idx + 1} | r{idx + 1}
                    </Text>
                  </Box>
                ))}
                <Text color={theme.muted}>Tip: press 1-3 to open/retry an item quickly.</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <StatusBadge label="OK" tone="ok" />
                <Text color={theme.muted}> no open items.</Text>
              </Box>
            )}
          </FramedBlock>
        </>
      )}

      {!quietMode ? (
        <>
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
        </>
      ) : null}

      {verboseMode && !quietMode ? (
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
              )) : (
                <Box>
                  <StatusBadge label="SKIP" tone="skip" />
                  <Text color={theme.muted}> no queued actions</Text>
                </Box>
              )}
              <Text color={theme.accent}>logs</Text>
              {recentLogs.length ? recentLogs.map((x, idx) => (
                <Text key={`l-${idx}`} color={logLevelColor(x.level)}>
                  [{shortTime(x.at)}] {logLevelGlyph(x.level)} {x.message}
                </Text>
              )) : (
                <Box>
                  <StatusBadge label="SKIP" tone="skip" />
                  <Text color={theme.muted}> no runtime logs</Text>
                </Box>
              )}
              <Text color={theme.accent}>rollback</Text>
              {recentRollbacks.length ? recentRollbacks.map((x) => (
                <Text key={`${x.at}_${x.action}`} color={theme.text}>
                  [{shortTime(x.at)}] {x.action} {x.status}
                </Text>
              )) : (
                <Box>
                  <StatusBadge label="SKIP" tone="skip" />
                  <Text color={theme.muted}> no rollback entries</Text>
                </Box>
              )}
              <Text color={theme.accent}>result</Text>
              {resultPreview ? (
                <Text color={theme.text}>{resultPreview}</Text>
              ) : (
                <Box>
                  <StatusBadge label="SKIP" tone="skip" />
                  <Text color={theme.muted}> no results yet</Text>
                </Box>
              )}
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
          <Text color={theme.muted}>Filter (Esc to close):</Text>
          <TextInput value={paletteQuery} onChange={setPaletteQuery} focus />
          <Box marginTop={1} />
          <Text color={theme.muted}>
            Showing {filteredPaletteOptions.length} of {paletteOptions.length}
          </Text>
          <Box marginTop={1} />
          {filteredPaletteOptions.length ? (
          <Select
            options={filteredPaletteOptions}
            onChange={(value) => {
              setShowPalette(false);
              setPaletteQuery("");
              dispatch({ type: "SET_INPUT", value });
              void parseAndQueueIntent(value);
            }}
          />
          ) : (
            <Text color={theme.muted}>No matches. Try a different keyword.</Text>
          )}
          </FramedBlock>
        </>
      ) : null}

      {showGuidedMenu ? (
        <>
          <SectionHeading label="What do you want to do?" />
          <FramedBlock title="Guided menu">
            <Text color={theme.muted}>Pick one option and I will guide you.</Text>
            <Box marginTop={1} />
            {guidedMenuOptions.length ? (
              <Select
                options={guidedMenuOptions}
                onChange={(value) => {
                  setShowGuidedMenu(false);
                  dispatch({ type: "SET_INPUT", value });
                  void parseAndQueueIntent(value);
                }}
              />
            ) : (
              <Text color={theme.muted}>No options available yet. Press w to close.</Text>
            )}
            <Text color={theme.muted}>Tip: press w or Esc to close.</Text>
          </FramedBlock>
        </>
      ) : null}

      {showHelp ? (
        <>
          <SectionHeading label="Help" />
          <FramedBlock title="Operator notes">
          <Text color={theme.text}>Workflow: describe, plan, approve, execute, review.</Text>
          <Text color={theme.text}>Commands: /start /setup /next /fix /open /retry /help /doctor /status /config /logs /replay /token /why /ai ... (o1/r1 shortcuts)</Text>
          <Text color={theme.text}>Memory: say `my name is ...` and later ask `what's my name`.</Text>
          <Text color={theme.text}>Keys: Enter/y approve, n/r reject, e edit slots, d diagnostics.</Text>
          <Text color={theme.text}>Quick: g guided setup, n next step, l logs, {`1-${Math.min(9, quickActions.length)}`} run onboarding steps.</Text>
          <Text color={theme.muted}>UI: / palette (type to filter, Esc to close), w menu, t tutorial, z fix now, b board filter, c attention mode, v quiet mode, i next-step guide, m safe mode, p panic, k diagnostic pack, [ ] cycle focus, f run focus, s switch workspace, a approvals, e alerts, h help fix, x collapse/expand diagnostics (verbose), up/down history, q quit.</Text>
          <Text color={theme.muted}>Tokens: type "fix token" or "open whatsapp token" to launch the dashboard.</Text>
          </FramedBlock>
        </>
      ) : null}

      <SectionHeading label={state.phase === "HIGH_RISK_APPROVAL" ? "Approval" : state.phase === "EDIT_SLOTS" ? "Edit slots" : "Compose"} />
      <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={state.currentRisk === "HIGH" ? riskTone : theme.muted}>
        <Text color={theme.accent}>{inputLabel}</Text>
        <TextInput value={inputValue} onChange={setInputValue} focus={!showPalette} />
      </Box>
      <Text color={state.currentRisk === "HIGH" ? riskTone : theme.accent}>{actionHint}</Text>
      {hotkeyTips.length ? (
        <Text color={theme.muted}>Hotkeys now: {hotkeyTips.join(" | ")}</Text>
      ) : null}
      <Text color={theme.muted}>
        Enter confirm | / palette (filter) | w menu | t tutorial | z fix | b board | c attention | v quiet | i guide | m safe | p panic | k pack | [ ] focus | f run | s switch | a approvals | e alerts | h help | g guided | n next | l logs | {`1-${Math.min(9, quickActions.length)}`} quick | ? help | d diagnostics | x rail | q quit
      </Text>
    </Box>
  );
}

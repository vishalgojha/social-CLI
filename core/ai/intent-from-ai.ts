import axios from "axios";

import { validateIntentSchema } from "../intent-schema.js";
import type { Intent } from "../types.js";

export interface AiIntentOptions {
  provider: "ollama" | "openai" | "openrouter" | "xai";
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

function extractJsonObject(text: string): string {
  const s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

function normalizeIntentShape(raw: unknown): Intent {
  const x = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const paramsIn = (x.params && typeof x.params === "object" && !Array.isArray(x.params))
    ? (x.params as Record<string, unknown>)
    : {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(paramsIn)) params[k] = String(v);

  return {
    action: String(x.action || "") as Intent["action"],
    target: String(x.target || "") as Intent["target"],
    params,
    risk: String(x.risk || "") as Intent["risk"]
  };
}

function systemPrompt(): string {
  return [
    "You convert user intent into strict JSON only.",
    "Allowed action: onboard, doctor, status, config, get, create, list, logs, replay.",
    "Allowed target: system, profile, post, ads, logs.",
    "Allowed risk: LOW, MEDIUM, HIGH.",
    "Schema: {\"action\":string,\"target\":string,\"params\":object,\"risk\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}.",
    "No markdown. No explanation. Return JSON only."
  ].join(" ");
}

function extractAssistantContent(data: unknown): string {
  const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = (choices[0] && typeof choices[0] === "object") ? (choices[0] as Record<string, unknown>) : {};
  const message = (first.message && typeof first.message === "object") ? (first.message as Record<string, unknown>) : {};
  const content = message.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const merged = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (merged) return merged;
  }

  const fallbackText = first.text;
  return typeof fallbackText === "string" ? fallbackText : "";
}

function stringifyData(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function shouldRetryWithoutResponseFormat(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = Number(error.response?.status || 0);
  if (status !== 400 && status !== 422) return false;
  const detail = `${error.message || ""} ${stringifyData(error.response?.data)}`.toLowerCase();
  return detail.includes("response_format")
    || detail.includes("json_object")
    || detail.includes("unsupported")
    || detail.includes("invalid_request");
}

async function inferWithOllama(text: string, opts: AiIntentOptions): Promise<string> {
  const base = opts.baseUrl || "http://127.0.0.1:11434";
  const { data } = await axios.post(
    `${base.replace(/\/+$/, "")}/api/chat`,
    {
      model: opts.model || "qwen2.5:7b",
      stream: false,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: text }
      ],
      options: { temperature: 0 }
    },
    { timeout: 30_000 }
  );
  return String(data?.message?.content || "");
}

async function inferWithOpenAICompatible(text: string, opts: AiIntentOptions): Promise<string> {
  const base = opts.baseUrl || "https://api.openai.com/v1";
  const key = opts.apiKey || "";
  if (!key) throw new Error("Missing API key for openai provider.");
  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  const commonPayload = {
    model: opts.model || "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: text }
    ]
  };
  const requestOptions = {
    timeout: 30_000,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    }
  };

  try {
    const { data } = await axios.post(
      url,
      {
        ...commonPayload,
        response_format: { type: "json_object" }
      },
      requestOptions
    );
    return extractAssistantContent(data);
  } catch (error) {
    if (!shouldRetryWithoutResponseFormat(error)) throw error;
    const { data } = await axios.post(url, commonPayload, requestOptions);
    return extractAssistantContent(data);
  }
}

export async function parseIntentWithAi(text: string, opts: AiIntentOptions): Promise<Intent> {
  const raw = opts.provider === "ollama"
    ? await inferWithOllama(text, opts)
    : await inferWithOpenAICompatible(text, opts);
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`AI returned non-JSON output: ${String((err as Error)?.message || err)}`);
  }
  const intent = normalizeIntentShape(parsed);
  validateIntentSchema(intent);
  return intent;
}


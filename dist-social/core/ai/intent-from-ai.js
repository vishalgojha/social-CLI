"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIntentWithAi = parseIntentWithAi;
const axios_1 = __importDefault(require("axios"));
const intent_schema_js_1 = require("../intent-schema.js");
function extractJsonObject(text) {
    const s = String(text || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1])
        return fence[1].trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start)
        return s.slice(start, end + 1);
    return s;
}
function normalizeIntentShape(raw) {
    const x = (raw && typeof raw === "object") ? raw : {};
    const paramsIn = (x.params && typeof x.params === "object" && !Array.isArray(x.params))
        ? x.params
        : {};
    const params = {};
    for (const [k, v] of Object.entries(paramsIn))
        params[k] = String(v);
    return {
        action: String(x.action || ""),
        target: String(x.target || ""),
        params,
        risk: String(x.risk || "")
    };
}
function systemPrompt() {
    return [
        "You convert user intent into strict JSON only.",
        "Allowed action: onboard, doctor, status, config, get, create, list, logs, replay.",
        "Allowed target: system, profile, post, ads, logs.",
        "Allowed risk: LOW, MEDIUM, HIGH.",
        "Schema: {\"action\":string,\"target\":string,\"params\":object,\"risk\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}.",
        "No markdown. No explanation. Return JSON only."
    ].join(" ");
}
function extractAssistantContent(data) {
    const root = (data && typeof data === "object") ? data : {};
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const first = (choices[0] && typeof choices[0] === "object") ? choices[0] : {};
    const message = (first.message && typeof first.message === "object") ? first.message : {};
    const content = message.content;
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        const merged = content
            .map((part) => {
            if (typeof part === "string")
                return part;
            if (part && typeof part === "object") {
                const text = part.text;
                return typeof text === "string" ? text : "";
            }
            return "";
        })
            .filter(Boolean)
            .join(" ")
            .trim();
        if (merged)
            return merged;
    }
    const fallbackText = first.text;
    return typeof fallbackText === "string" ? fallbackText : "";
}
function stringifyData(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value ?? "");
    }
}
function shouldRetryWithoutResponseFormat(error) {
    if (!axios_1.default.isAxiosError(error))
        return false;
    const status = Number(error.response?.status || 0);
    if (status !== 400 && status !== 422)
        return false;
    const detail = `${error.message || ""} ${stringifyData(error.response?.data)}`.toLowerCase();
    return detail.includes("response_format")
        || detail.includes("json_object")
        || detail.includes("unsupported")
        || detail.includes("invalid_request");
}
async function inferWithOllama(text, opts) {
    const base = opts.baseUrl || "http://127.0.0.1:11434";
    const { data } = await axios_1.default.post(`${base.replace(/\/+$/, "")}/api/chat`, {
        model: opts.model || "qwen2.5:7b",
        stream: false,
        messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: text }
        ],
        options: { temperature: 0 }
    }, { timeout: 30_000 });
    return String(data?.message?.content || "");
}
async function inferWithOpenAICompatible(text, opts) {
    const base = opts.baseUrl || "https://api.openai.com/v1";
    const key = opts.apiKey || "";
    if (!key)
        throw new Error("Missing API key for openai provider.");
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
        const { data } = await axios_1.default.post(url, {
            ...commonPayload,
            response_format: { type: "json_object" }
        }, requestOptions);
        return extractAssistantContent(data);
    }
    catch (error) {
        if (!shouldRetryWithoutResponseFormat(error))
            throw error;
        const { data } = await axios_1.default.post(url, commonPayload, requestOptions);
        return extractAssistantContent(data);
    }
}
async function parseIntentWithAi(text, opts) {
    const raw = opts.provider === "ollama"
        ? await inferWithOllama(text, opts)
        : await inferWithOpenAICompatible(text, opts);
    const jsonText = extractJsonObject(raw);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (err) {
        throw new Error(`AI returned non-JSON output: ${String(err?.message || err)}`);
    }
    const intent = normalizeIntentShape(parsed);
    (0, intent_schema_js_1.validateIntentSchema)(intent);
    return intent;
}

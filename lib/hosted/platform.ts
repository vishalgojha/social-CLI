const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomBytes, createCipheriv, createDecipheriv, createHash } = require('crypto');
const storage = require('./storage');
const { WebchatChannel } = require('../channels/webchat');
const { BaileysChannel } = require('../channels/baileys');
const { loadPlaywrightOrThrow } = require('../playwright-runtime');

const TOOL_NAME = 'Social Flow';
const TIER_2_PRICE_USD = 49;

const SUPPORTED_BYOK_SERVICES = [
  { service: 'openai', category: 'llm', label: 'OpenAI API key', requiredForOrchestration: true },
  { service: 'openrouter', category: 'llm', label: 'OpenRouter API key', requiredForOrchestration: false },
  { service: 'xai', category: 'llm', label: 'xAI API key', requiredForOrchestration: false },
  { service: 'meta_facebook', category: 'meta', label: 'Meta Facebook token', requiredForOrchestration: false },
  { service: 'meta_instagram', category: 'meta', label: 'Meta Instagram token', requiredForOrchestration: false },
  { service: 'meta_whatsapp', category: 'meta', label: 'Meta WhatsApp token', requiredForOrchestration: false }
];

const BUILTIN_AGENTS = [
  {
    slug: 'router-agent',
    name: 'Router Agent',
    description: 'Routes user tasks to the best specialist agent.',
    tools: ['meta.status', 'meta.doctor', 'gateway.logs']
  },
  {
    slug: 'marketing-agent',
    name: 'Marketing Agent',
    description: 'Handles campaigns, ads, and posting workflows.',
    tools: ['meta.status', 'meta.list_ads', 'meta.create_post', 'meta.get_profile']
  },
  {
    slug: 'messaging-agent',
    name: 'Messaging Agent',
    description: 'Executes WhatsApp and messaging actions.',
    tools: ['meta.status', 'whatsapp.send_text', 'gateway.logs']
  },
  {
    slug: 'analytics-agent',
    name: 'Analytics Agent',
    description: 'Runs diagnostic and reporting tasks across logs and ads.',
    tools: ['meta.status', 'meta.list_ads', 'gateway.logs']
  },
  {
    slug: 'ops-agent',
    name: 'Ops Agent',
    description: 'Operational automation and safe CLI wrappers.',
    tools: ['meta.status', 'meta.doctor', 'gateway.logs', 'cli.command']
  },
  {
    slug: 'browser-agent',
    name: 'Browser Agent',
    description: 'Runs browser automation flows for research and QA tasks.',
    tools: [
      'browser.fetch_page',
      'browser.list_sessions',
      'browser.session_create',
      'browser.goto',
      'browser.click',
      'browser.type',
      'browser.press',
      'browser.wait_for',
      'browser.extract_text',
      'browser.screenshot',
      'browser.session_close'
    ]
  },
  {
    slug: 'webchat-agent',
    name: 'Webchat Agent',
    description: 'Manages browser chat widget sessions and replies.',
    tools: [
      'webchat.create_widget_key',
      'webchat.list_widget_keys',
      'webchat.list_sessions',
      'webchat.get_messages',
      'webchat.reply',
      'webchat.set_status'
    ]
  },
  {
    slug: 'baileys-agent',
    name: 'Baileys Agent',
    description: 'Manages WhatsApp Web sessions through Baileys.',
    tools: [
      'baileys.create_session',
      'baileys.list_sessions',
      'baileys.connect_session',
      'baileys.disconnect_session',
      'baileys.send_text',
      'baileys.get_messages'
    ]
  }
];

const ACTION_TOOL_MAP = {
  status: 'meta.status',
  doctor: 'meta.doctor',
  get_profile: 'meta.get_profile',
  list_ads: 'meta.list_ads',
  create_post: 'meta.create_post',
  send_whatsapp: 'whatsapp.send_text',
  send_text: 'whatsapp.send_text',
  browse_page: 'browser.fetch_page',
  browse_url: 'browser.fetch_page',
  fetch_page: 'browser.fetch_page',
  browser_fetch: 'browser.fetch_page',
  browser_fetch_page: 'browser.fetch_page',
  browser_list_sessions: 'browser.list_sessions',
  browser_create_session: 'browser.session_create',
  browser_new_session: 'browser.session_create',
  browser_session_create: 'browser.session_create',
  browser_open_url: 'browser.goto',
  browser_navigate: 'browser.goto',
  browser_goto: 'browser.goto',
  browser_click: 'browser.click',
  browser_type: 'browser.type',
  browser_press: 'browser.press',
  browser_wait_for: 'browser.wait_for',
  browser_extract_text: 'browser.extract_text',
  browser_read_text: 'browser.extract_text',
  browser_screenshot: 'browser.screenshot',
  browser_close_session: 'browser.session_close',
  browser_session_close: 'browser.session_close',
  webchat_create_widget_key: 'webchat.create_widget_key',
  webchat_list_widget_keys: 'webchat.list_widget_keys',
  webchat_delete_widget_key: 'webchat.delete_widget_key',
  webchat_create_session: 'webchat.create_session',
  webchat_list_sessions: 'webchat.list_sessions',
  webchat_get_messages: 'webchat.get_messages',
  webchat_reply: 'webchat.reply',
  webchat_set_status: 'webchat.set_status',
  baileys_create_session: 'baileys.create_session',
  baileys_list_sessions: 'baileys.list_sessions',
  baileys_connect_session: 'baileys.connect_session',
  baileys_disconnect_session: 'baileys.disconnect_session',
  baileys_delete_session: 'baileys.delete_session',
  baileys_send_text: 'baileys.send_text',
  baileys_get_messages: 'baileys.get_messages',
  logs: 'gateway.logs',
  cli: 'cli.command',
  cli_command: 'cli.command'
};

const SERVICE_LIMITS_PER_MIN = {
  llm: 30,
  meta_marketing: 120,
  whatsapp_cloud: 80,
  web_browser: 90,
  webchat_channel: 300,
  baileys_channel: 120,
  gateway: 120,
  cli_runtime: 40
};

const TRIGGER_TYPES = new Set(['cron', 'webhook', 'event']);
const PLAYWRIGHT_TIMEOUT_MS = 15_000;

function normalizeWaitUntil(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'load' || raw === 'domcontentloaded' || raw === 'networkidle' || raw === 'commit') return raw;
  return 'domcontentloaded';
}

function normalizeWaitState(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'attached' || raw === 'detached' || raw === 'visible' || raw === 'hidden') return raw;
  return 'visible';
}

function normalizeMouseButton(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'left' || raw === 'middle' || raw === 'right') return raw;
  return 'left';
}

function normalizeScreenshotType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'png' || raw === 'jpeg') return raw;
  return 'png';
}

function normalizeTimeout(value, fallback = PLAYWRIGHT_TIMEOUT_MS) {
  return Math.max(1_000, Math.min(120_000, toNumber(value, fallback)));
}

function normalizeBrowserError(error, fallbackMessage = 'Browser operation failed') {
  const message = String(error?.message || fallbackMessage).trim() || fallbackMessage;
  const status = Number(error?.status || 0) || undefined;
  const code = String(error?.code || '').trim() || (error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : 'BROWSER_ERROR');
  const normalized = new Error(message);
  normalized.code = code;
  if (status) normalized.status = status;
  return normalized;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function isRetryable(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  const code = String(error?.code || '').trim().toUpperCase();
  return ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(code);
}

function errorPayload(error, fallbackMessage = 'Request failed') {
  const message = String(
    error?.message
    || error?.response?.data?.error?.message
    || fallbackMessage
  ).trim() || fallbackMessage;
  return {
    code: String(error?.code || error?.response?.data?.error?.code || 'REQUEST_FAILED').trim() || 'REQUEST_FAILED',
    message,
    status: Number(error?.status || error?.response?.status || 0) || undefined,
    retryable: isRetryable(error)
  };
}

function normalizeBrowserUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) throw new Error('Missing url.');

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid url: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https urls are supported.');
  }
  return parsed.toString();
}

function decodeHtmlEntities(rawValue) {
  const input = String(rawValue || '');
  if (!input) return '';
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, token) => {
    const raw = String(token || '').trim();
    if (!raw) return full;
    if (raw[0] === '#') {
      const hex = raw[1] && raw[1].toLowerCase() === 'x';
      const numeric = Number.parseInt(raw.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(numeric) || numeric < 0) return full;
      try {
        return String.fromCodePoint(numeric);
      } catch {
        return full;
      }
    }
    const mapped = named[raw.toLowerCase()];
    return mapped !== undefined ? mapped : full;
  });
}

function stripHtmlToText(rawHtml) {
  const html = String(rawHtml || '');
  if (!html) return '';
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutScripts).replace(/\s+/g, ' ').trim();
}

function extractHtmlTagContent(rawHtml, tagName) {
  const html = String(rawHtml || '');
  const safeTag = String(tagName || '').trim();
  if (!html || !safeTag) return '';
  const escaped = safeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = html.match(re);
  return match ? stripHtmlToText(match[1]) : '';
}

function extractMetaContent(rawHtml, metaName) {
  const html = String(rawHtml || '');
  const name = String(metaName || '').trim();
  if (!html || !name) return '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagMatch = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*>`, 'i'));
  if (!tagMatch) return '';
  const tag = tagMatch[0];
  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
  return content ? decodeHtmlEntities(content[1]).replace(/\s+/g, ' ').trim() : '';
}

function extractLinks(rawHtml, baseUrl, maxLinks = 20) {
  const html = String(rawHtml || '');
  if (!html || !maxLinks) return [];

  const out = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorRe.exec(html);
  while (match && out.length < maxLinks) {
    const hrefRaw = String(match[1] || '').trim();
    const label = stripHtmlToText(match[2] || '').slice(0, 160);
    const lowerHref = hrefRaw.toLowerCase();
    if (lowerHref && !lowerHref.startsWith('#')
      && !lowerHref.startsWith('javascript:')
      && !lowerHref.startsWith('mailto:')
      && !lowerHref.startsWith('tel:')
      && !lowerHref.startsWith('data:')) {
      try {
        const absolute = new URL(hrefRaw, baseUrl).toString();
        if (!seen.has(absolute)) {
          seen.add(absolute);
          out.push({ href: absolute, text: label });
        }
      } catch {
        // Ignore malformed href values.
      }
    }
    match = anchorRe.exec(html);
  }
  return out;
}

async function fetchBrowserPageSummary(rawUrl, options = {}) {
  const url = normalizeBrowserUrl(rawUrl);
  const timeoutMs = Math.max(1_000, Math.min(30_000, toNumber(options.timeoutMs, 15_000)));
  const maxTextChars = Math.max(300, Math.min(40_000, toNumber(options.maxTextChars, 4_000)));
  const maxLinks = Math.max(0, Math.min(80, toNumber(options.maxLinks, 20)));
  const includeHtml = Boolean(options.includeHtml);
  const maxHtmlChars = Math.max(2_000, Math.min(500_000, toNumber(options.maxHtmlChars, 120_000)));

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: abortController.signal,
      headers: {
        'user-agent': 'Social-Flow-BrowserAgent/1.0',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const fullBody = await response.text();
    const html = fullBody.slice(0, maxHtmlChars);
    const text = stripHtmlToText(html);
    const finalUrl = String(response.url || url);
    const contentType = String(response.headers.get('content-type') || '').trim();

    return {
      ok: response.ok,
      url,
      finalUrl,
      status: Number(response.status || 0) || 0,
      statusText: String(response.statusText || ''),
      contentType,
      title: extractHtmlTagContent(html, 'title'),
      description: extractMetaContent(html, 'description') || extractMetaContent(html, 'og:description'),
      textPreview: text.slice(0, maxTextChars),
      textLength: text.length,
      htmlLength: fullBody.length,
      truncated: fullBody.length > html.length,
      links: extractLinks(html, finalUrl, maxLinks),
      html: includeHtml ? html : '',
      fetchedAt: storage.nowIso()
    };
  } catch (error) {
    if (error && String(error.name || '') === 'AbortError') {
      const timeoutError = new Error(`Browser fetch timed out after ${timeoutMs}ms.`);
      timeoutError.code = 'BROWSER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pathGet(source, rawPath) {
  const pathText = String(rawPath || '').trim().replace(/^\./, '');
  if (!pathText) return source;
  const parts = pathText.split('.').map((x) => x.trim()).filter(Boolean);
  let current = source;
  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    current = current[key];
  }
  return current;
}

function parseYamlScalar(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function parseRecipeYaml(content) {
  const rawLines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, '  '));

  const lines = rawLines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return '';
      return line;
    })
    .filter(Boolean);

  const out = { steps: [] };
  let idx = 0;

  function currentIndent(line) {
    const m = String(line || '').match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  function parseNestedObject(baseIndent, startIndex) {
    const obj = {};
    let i = startIndex;
    while (i < lines.length) {
      const line = lines[i];
      const indent = currentIndent(line);
      if (indent < baseIndent) break;
      const trimmed = line.trim();
      if (!trimmed) {
        i += 1;
        continue;
      }
      const nestedMatch = trimmed.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
      if (!nestedMatch) break;
      const key = nestedMatch[1];
      const rhs = nestedMatch[2] || '';
      if (!rhs) {
        const nested = parseNestedObject(indent + 2, i + 1);
        obj[key] = nested.value;
        i = nested.nextIndex;
      } else {
        obj[key] = parseYamlScalar(rhs);
        i += 1;
      }
    }
    return { value: obj, nextIndex: i };
  }

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (trimmed === 'steps:' || trimmed.startsWith('steps:')) {
      idx += 1;
      while (idx < lines.length) {
        const stepLine = lines[idx];
        const stepIndent = currentIndent(stepLine);
        const stepTrimmed = stepLine.trim();
        if (stepIndent < 2) break;
        if (!stepTrimmed.startsWith('- ')) {
          idx += 1;
          continue;
        }

        const step = {};
        const firstPair = stepTrimmed.slice(2);
        const firstMatch = firstPair.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
        if (firstMatch) {
          const key = firstMatch[1];
          const rhs = firstMatch[2] || '';
          step[key] = rhs ? parseYamlScalar(rhs) : '';
        }
        idx += 1;

        while (idx < lines.length) {
          const detailLine = lines[idx];
          const detailIndent = currentIndent(detailLine);
          const detailTrimmed = detailLine.trim();
          if (detailIndent <= stepIndent) break;
          const pair = detailTrimmed.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
          if (!pair) {
            idx += 1;
            continue;
          }
          const key = pair[1];
          const rhs = pair[2] || '';
          if (!rhs) {
            const nested = parseNestedObject(detailIndent + 2, idx + 1);
            step[key] = nested.value;
            idx = nested.nextIndex;
            continue;
          }
          step[key] = parseYamlScalar(rhs);
          idx += 1;
        }

        out.steps.push(step);
      }
      continue;
    }

    const topMatch = trimmed.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1];
      const rhs = topMatch[2] || '';
      out[key] = rhs ? parseYamlScalar(rhs) : '';
    }
    idx += 1;
  }

  return out;
}

function recipeToYaml(recipe) {
  const doc = storage.isPlainObject(recipe) ? recipe : {};
  const lines = [];
  const push = (line = '') => lines.push(line);

  if (doc.slug) push(`slug: ${doc.slug}`);
  if (doc.name) push(`name: ${JSON.stringify(doc.name)}`);
  if (doc.description) push(`description: ${JSON.stringify(doc.description)}`);
  if (doc.mode) push(`mode: ${doc.mode}`);
  push('steps:');

  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  steps.forEach((step) => {
    push(`  - agent_slug: ${String(step.agent_slug || '')}`);
    push(`    action_key: ${String(step.action_key || '')}`);
    if (step.format_guide) push(`    format_guide: ${JSON.stringify(String(step.format_guide || ''))}`);
    const props = storage.isPlainObject(step.action_props) ? step.action_props : {};
    const propKeys = Object.keys(props);
    if (propKeys.length === 0) {
      push('    action_props: {}');
      return;
    }
    push('    action_props:');
    propKeys.forEach((key) => {
      const val = props[key];
      if (storage.isPlainObject(val) || Array.isArray(val)) {
        push(`      ${key}: ${JSON.stringify(val)}`);
      } else {
        push(`      ${key}: ${JSON.stringify(val)}`);
      }
    });
  });

  return `${lines.join('\n')}\n`;
}

class HostedPlatform {
  constructor(options = {}) {
    this.executeSdkAction = typeof options.executeSdkAction === 'function'
      ? options.executeSdkAction
      : async () => ({ ok: true });

    this.rootDir = storage.hostedRoot();
    this.lockDir = storage.ensureDir(path.join(this.rootDir, 'locks'));
    this.vaultFile = path.join(this.rootDir, 'vault.json');
    this.usersFile = path.join(this.rootDir, 'users.json');
    this.agentsFile = path.join(this.rootDir, 'user-agents.json');
    this.usageFile = path.join(this.rootDir, 'usage.json');
    this.logFile = path.join(this.rootDir, 'hosted-observability.jsonl');

    this.recipesRoot = storage.resolveVersionedDir('recipes', 'SOCIAL_HOSTED_RECIPES_DIR');
    this.triggersRoot = storage.resolveVersionedDir('triggers', 'SOCIAL_HOSTED_TRIGGERS_DIR');
    this.triggersFile = path.join(this.triggersRoot, 'triggers.json');

    this.schedulerHandle = null;
    this.cronRunCache = new Map();
    this.rateBuckets = new Map();
    this.browserSessions = new Map();
    this.webchat = new WebchatChannel({
      emitEvent: (payload) => this.emitEvent(payload),
      log: (entry = {}) => this.appendLog({
        ...entry,
        service: String(entry.service || 'webchat_channel')
      })
    });
    this.baileys = new BaileysChannel({
      emitEvent: (payload) => this.emitEvent(payload),
      log: (entry = {}) => this.appendLog({
        ...entry,
        service: String(entry.service || 'baileys_channel')
      })
    });

    this.tools = this.buildToolCatalog();
    this.toolMap = new Map(this.tools.map((tool) => [tool.key, tool]));

    this.bootstrapUsersFromEnv();
  }

  lockPath(name) {
    return path.join(this.lockDir, `${storage.sanitizeId(name, 'lock')}.lock`);
  }

  async withLock(name, fn, options = {}) {
    return storage.withFileLock(this.lockPath(name), fn, options);
  }

  start() {
    if (this.schedulerHandle) return;
    const intervalMs = Math.max(15_000, toNumber(process.env.SOCIAL_TRIGGER_TICK_MS, 30_000));
    this.schedulerHandle = setInterval(() => {
      this.runDueCronTriggers().catch((error) => {
        this.appendLog({
          event: 'trigger.tick.error',
          level: 'error',
          error: errorPayload(error, 'Cron trigger tick failed')
        });
      });
    }, intervalMs);
    if (typeof this.schedulerHandle.unref === 'function') {
      this.schedulerHandle.unref();
    }
  }

  async stop() {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
    if (this.baileys && typeof this.baileys.stop === 'function') {
      this.baileys.stop();
    }
    await this.closeAllBrowserSessions();
  }

  browserSessionSnapshot(record) {
    const row = storage.isPlainObject(record) ? record : {};
    return {
      id: String(row.id || ''),
      userId: String(row.userId || ''),
      createdAt: String(row.createdAt || ''),
      updatedAt: String(row.updatedAt || ''),
      lastUrl: String(row.lastUrl || ''),
      lastTitle: String(row.lastTitle || '')
    };
  }

  browserSessionRecordForUser(userId, sessionId) {
    const safeUserId = storage.sanitizeId(userId);
    const id = String(sessionId || '').trim();
    if (!id) {
      const error = new Error('Missing browser session id.');
      error.code = 'BROWSER_SESSION_REQUIRED';
      error.status = 400;
      throw error;
    }
    const record = this.browserSessions.get(id);
    if (!record || String(record.userId || '') !== safeUserId) {
      const error = new Error('Browser session not found.');
      error.code = 'BROWSER_SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    return record;
  }

  async refreshBrowserSessionMeta(record) {
    const rec = record;
    if (!rec || !rec.page) return;
    rec.updatedAt = storage.nowIso();
    try {
      rec.lastUrl = String(rec.page.url() || '');
    } catch {
      rec.lastUrl = '';
    }
    try {
      rec.lastTitle = String((await rec.page.title()) || '');
    } catch {
      rec.lastTitle = '';
    }
  }

  async createBrowserSession(userId, payload = {}) {
    const safeUserId = storage.sanitizeId(userId);
    const playwright = await loadPlaywrightOrThrow({ stdio: 'pipe' });

    const headless = payload.headless !== false;
    const viewportWidth = Math.max(320, Math.min(3840, toNumber(payload.viewportWidth, 1366)));
    const viewportHeight = Math.max(240, Math.min(2160, toNumber(payload.viewportHeight, 900)));
    const timeoutMs = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    const userAgent = String(payload.userAgent || '').trim();

    let browser = null;
    try {
      browser = await playwright.chromium.launch({ headless });
      const context = await browser.newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        userAgent: userAgent || undefined
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      const id = storage.genId('brows');
      const record = {
        id,
        userId: safeUserId,
        createdAt: storage.nowIso(),
        updatedAt: storage.nowIso(),
        lastUrl: '',
        lastTitle: '',
        browser,
        context,
        page
      };
      this.browserSessions.set(id, record);

      return {
        session: this.browserSessionSnapshot(record),
        browser: {
          engine: 'chromium',
          headless,
          viewportWidth,
          viewportHeight
        }
      };
    } catch (error) {
      if (browser && typeof browser.close === 'function') {
        try {
          await browser.close();
        } catch {
          // ignore close errors
        }
      }
      throw normalizeBrowserError(error);
    }
  }

  async listBrowserSessions(userId) {
    const safeUserId = storage.sanitizeId(userId);
    return Array.from(this.browserSessions.values())
      .filter((row) => String(row.userId || '') === safeUserId)
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) * -1)
      .map((row) => this.browserSessionSnapshot(row));
  }

  async closeBrowserSession(userId, sessionId) {
    const record = this.browserSessionRecordForUser(userId, sessionId);
    this.browserSessions.delete(record.id);
    try {
      if (record.browser && typeof record.browser.close === 'function') {
        await record.browser.close();
      }
    } catch (error) {
      throw normalizeBrowserError(error);
    }
    return { closed: true, sessionId: record.id };
  }

  async closeAllBrowserSessions() {
    const sessions = Array.from(this.browserSessions.values());
    this.browserSessions.clear();
    await Promise.allSettled(sessions.map(async (record) => {
      if (record.browser && typeof record.browser.close === 'function') {
        await record.browser.close();
      }
    }));
  }

  async browserGoto(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const url = normalizeBrowserUrl(payload.url || payload.href || '');
    const waitUntil = normalizeWaitUntil(payload.waitUntil);
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    try {
      const response = await record.page.goto(url, { waitUntil, timeout });
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        navigation: {
          requestedUrl: url,
          finalUrl: record.lastUrl,
          status: response ? Number(response.status() || 0) : 0,
          ok: response ? Boolean(response.ok()) : true,
          waitUntil
        }
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser navigation failed');
    }
  }

  async browserClick(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const selector = String(payload.selector || '').trim();
    if (!selector) {
      const error = new Error('Missing selector.');
      error.code = 'BROWSER_SELECTOR_REQUIRED';
      error.status = 400;
      throw error;
    }
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    const button = normalizeMouseButton(payload.button);
    const clickCount = Math.max(1, Math.min(5, toNumber(payload.clickCount, 1)));
    try {
      await record.page.waitForSelector(selector, { state: 'visible', timeout });
      await record.page.click(selector, { button, clickCount, timeout });
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        button,
        clickCount,
        clicked: true
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser click failed');
    }
  }

  async browserType(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const selector = String(payload.selector || '').trim();
    if (!selector) {
      const error = new Error('Missing selector.');
      error.code = 'BROWSER_SELECTOR_REQUIRED';
      error.status = 400;
      throw error;
    }
    const text = String(payload.text || payload.value || '');
    const clear = Boolean(payload.clear);
    const delay = Math.max(0, Math.min(300, toNumber(payload.delayMs, 0)));
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    try {
      await record.page.waitForSelector(selector, { state: 'visible', timeout });
      if (clear) {
        await record.page.fill(selector, '', { timeout });
      }
      if (clear && delay <= 0) {
        await record.page.fill(selector, text, { timeout });
      } else {
        await record.page.type(selector, text, { delay, timeout });
      }
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        typedChars: text.length,
        clear,
        delayMs: delay
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser type failed');
    }
  }

  async browserPress(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const key = String(payload.key || '').trim();
    if (!key) {
      const error = new Error('Missing key.');
      error.code = 'BROWSER_KEY_REQUIRED';
      error.status = 400;
      throw error;
    }
    const selector = String(payload.selector || '').trim();
    const delay = Math.max(0, Math.min(300, toNumber(payload.delayMs, 0)));
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    try {
      if (selector) {
        await record.page.waitForSelector(selector, { state: 'visible', timeout });
        await record.page.focus(selector, { timeout });
      }
      await record.page.keyboard.press(key, { delay });
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        key,
        pressed: true
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser key press failed');
    }
  }

  async browserWaitFor(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const selector = String(payload.selector || '').trim();
    if (!selector) {
      const error = new Error('Missing selector.');
      error.code = 'BROWSER_SELECTOR_REQUIRED';
      error.status = 400;
      throw error;
    }
    const state = normalizeWaitState(payload.state);
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    try {
      await record.page.waitForSelector(selector, { state, timeout });
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        state,
        matched: true
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser wait failed');
    }
  }

  async browserExtractText(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const selector = String(payload.selector || '').trim();
    const includeHtml = Boolean(payload.includeHtml);
    const maxChars = Math.max(200, Math.min(120_000, toNumber(payload.maxChars, 4_000)));
    const maxHtmlChars = Math.max(500, Math.min(400_000, toNumber(payload.maxHtmlChars, 80_000)));
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    try {
      let text = '';
      let html = '';

      if (selector) {
        await record.page.waitForSelector(selector, { state: 'attached', timeout });
        const locator = record.page.locator(selector).first();
        try {
          text = String(await locator.innerText({ timeout }));
        } catch {
          text = String(await locator.textContent({ timeout }) || '');
        }
        if (includeHtml) {
          html = String(await locator.evaluate((node) => node.outerHTML || '') || '');
        }
      } else {
        text = String(await record.page.evaluate(() => {
          if (!document || !document.body) return '';
          return document.body.innerText || document.body.textContent || '';
        }) || '');
        if (includeHtml) {
          html = String(await record.page.content() || '');
        }
      }

      const compactText = text.replace(/\s+/g, ' ').trim();
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        text: compactText.slice(0, maxChars),
        textLength: compactText.length,
        truncated: compactText.length > maxChars,
        html: includeHtml ? html.slice(0, maxHtmlChars) : ''
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser text extraction failed');
    }
  }

  async browserScreenshot(userId, payload = {}) {
    const record = this.browserSessionRecordForUser(userId, payload.sessionId || payload.id || '');
    const selector = String(payload.selector || '').trim();
    const fullPage = Boolean(payload.fullPage);
    const type = normalizeScreenshotType(payload.type);
    const timeout = normalizeTimeout(payload.timeoutMs, PLAYWRIGHT_TIMEOUT_MS);
    const quality = Math.max(1, Math.min(100, toNumber(payload.quality, 80)));
    try {
      let buffer;
      if (selector) {
        await record.page.waitForSelector(selector, { state: 'visible', timeout });
        buffer = await record.page.locator(selector).first().screenshot({
          type,
          ...(type === 'jpeg' ? { quality } : {})
        });
      } else {
        buffer = await record.page.screenshot({
          type,
          fullPage,
          ...(type === 'jpeg' ? { quality } : {})
        });
      }
      await this.refreshBrowserSessionMeta(record);
      return {
        session: this.browserSessionSnapshot(record),
        selector,
        fullPage,
        image: {
          mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
          dataBase64: Buffer.from(buffer).toString('base64'),
          sizeBytes: Buffer.byteLength(buffer)
        }
      };
    } catch (error) {
      throw normalizeBrowserError(error, 'Browser screenshot failed');
    }
  }

  distributionModel() {
    return {
      toolName: TOOL_NAME,
      tiers: [
        {
          name: 'Tier 1',
          offer: 'CLI + self-hosted gateway',
          pricing: '$0/mo',
          billing: 'Free and open source'
        },
        {
          name: 'Tier 2',
          offer: 'Cloud hosted with BYOK',
          pricing: `$${TIER_2_PRICE_USD}/mo`,
          billing: 'Per workspace'
        },
        {
          name: 'Tier 3',
          offer: 'Enterprise white-label + on-prem',
          pricing: 'Custom',
          billing: 'Annual contract'
        }
      ],
      targetHosting: 'Railway'
    };
  }

  servicesCatalog() {
    return clone(SUPPORTED_BYOK_SERVICES);
  }

  usersDoc() {
    const doc = storage.readJson(this.usersFile, { users: [] });
    const users = Array.isArray(doc?.users) ? doc.users : [];
    return { users };
  }

  saveUsersDoc(doc) {
    const safe = {
      users: Array.isArray(doc?.users) ? doc.users : []
    };
    storage.writeJsonAtomic(this.usersFile, safe);
  }

  bootstrapUsersFromEnv() {
    const bootstrapApiKey = String(process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY || '').trim();
    if (!bootstrapApiKey) return;

    const userId = storage.sanitizeId(process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID || 'default');
    const userName = String(process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_NAME || 'Default Hosted User').trim();
    const hash = storage.sha256Hex(bootstrapApiKey);

    const doc = this.usersDoc();
    const existingIndex = doc.users.findIndex((row) => String(row.id || '') === userId);
    const now = storage.nowIso();

    if (existingIndex >= 0) {
      doc.users[existingIndex] = {
        ...doc.users[existingIndex],
        id: userId,
        name: userName,
        apiKeyHash: hash,
        updatedAt: now
      };
    } else {
      doc.users.push({
        id: userId,
        name: userName,
        apiKeyHash: hash,
        createdAt: now,
        updatedAt: now
      });
    }

    this.saveUsersDoc(doc);
  }

  createAutoProvisionUser(apiKey) {
    const hash = storage.sha256Hex(apiKey);
    const userId = storage.sanitizeId(`user_${hash.slice(0, 14)}`);
    const now = storage.nowIso();

    const doc = this.usersDoc();
    doc.users.push({
      id: userId,
      name: `Auto Provisioned ${userId.slice(-4)}`,
      apiKeyHash: hash,
      createdAt: now,
      updatedAt: now
    });
    this.saveUsersDoc(doc);

    return {
      id: userId,
      name: `Auto Provisioned ${userId.slice(-4)}`
    };
  }

  authenticateApiKey(rawApiKey) {
    const apiKey = String(rawApiKey || '').trim();
    if (!apiKey) return null;

    const hash = storage.sha256Hex(apiKey);
    const doc = this.usersDoc();
    const found = doc.users.find((row) => String(row.apiKeyHash || '') === hash);
    if (found) {
      return {
        id: String(found.id || ''),
        name: String(found.name || ''),
        createdAt: String(found.createdAt || ''),
        updatedAt: String(found.updatedAt || '')
      };
    }

    if (toBool(process.env.SOCIAL_HOSTED_AUTO_PROVISION, false)) {
      return this.createAutoProvisionUser(apiKey);
    }

    return null;
  }

  userFromRequest(req) {
    const headerValue = String(req?.headers?.['x-api-key'] || req?.headers?.['X-API-Key'] || '').trim();
    if (!headerValue) {
      return {
        ok: false,
        status: 401,
        error: 'Missing X-API-Key header.'
      };
    }

    const user = this.authenticateApiKey(headerValue);
    if (!user) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid X-API-Key.'
      };
    }

    return { ok: true, user };
  }

  masterKeyBuffer() {
    const source = String(
      process.env.SOCIAL_HOSTED_MASTER_KEY
      || process.env.SOCIAL_GATEWAY_API_KEY
      || process.env.META_GATEWAY_API_KEY
      || ''
    ).trim();

    if (!source) {
      throw new Error('Missing encryption key material. Set SOCIAL_HOSTED_MASTER_KEY.');
    }

    return createHash('sha256').update(source, 'utf8').digest();
  }

  encryptSecret(secretText) {
    const plain = String(secretText || '');
    if (!plain) throw new Error('Secret cannot be empty.');

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKeyBuffer(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: enc.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    };
  }

  decryptSecret(payload) {
    const iv = Buffer.from(String(payload?.iv || ''), 'base64');
    const data = Buffer.from(String(payload?.ciphertext || ''), 'base64');
    const tag = Buffer.from(String(payload?.tag || ''), 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.masterKeyBuffer(), iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return text;
  }

  vaultDoc() {
    const doc = storage.readJson(this.vaultFile, { keys: [] });
    return {
      keys: Array.isArray(doc?.keys) ? doc.keys : []
    };
  }

  saveVaultDoc(doc) {
    const safe = {
      keys: Array.isArray(doc?.keys) ? doc.keys : []
    };
    storage.writeJsonAtomic(this.vaultFile, safe);
  }
  async createVaultKey({ userId, service, key, label = '' }) {
    const safeUserId = storage.sanitizeId(userId);
    const serviceId = storage.sanitizeId(String(service || '').toLowerCase());
    const keyText = String(key || '').trim();
    if (!safeUserId) throw new Error('Missing user id.');
    if (!serviceId) throw new Error('Missing service.');
    if (!keyText) throw new Error('Missing key.');

    return this.withLock('vault', async () => {
      const doc = this.vaultDoc();
      const now = storage.nowIso();
      const encrypted = this.encryptSecret(keyText);
      const record = {
        id: storage.genId('key'),
        userId: safeUserId,
        service: serviceId,
        label: String(label || '').trim(),
        keyMask: storage.maskSecret(keyText),
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: ''
      };
      doc.keys.push(record);
      this.saveVaultDoc(doc);
      this.appendLog({
        userId: safeUserId,
        event: 'vault.key.created',
        service: serviceId,
        keyId: record.id
      });
      return {
        id: record.id,
        service: record.service,
        label: record.label,
        keyMask: record.keyMask,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      };
    });
  }

  async listVaultKeys(userId) {
    const safeUserId = storage.sanitizeId(userId);
    const doc = this.vaultDoc();
    return doc.keys
      .filter((row) => String(row.userId || '') === safeUserId)
      .sort((a, b) => (String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1))
      .map((row) => ({
        id: String(row.id || ''),
        service: String(row.service || ''),
        label: String(row.label || ''),
        keyMask: String(row.keyMask || ''),
        createdAt: String(row.createdAt || ''),
        updatedAt: String(row.updatedAt || ''),
        lastUsedAt: String(row.lastUsedAt || '')
      }));
  }

  async deleteVaultKey({ userId, keyId }) {
    const safeUserId = storage.sanitizeId(userId);
    const targetId = String(keyId || '').trim();
    if (!targetId) throw new Error('Missing key id.');

    return this.withLock('vault', async () => {
      const doc = this.vaultDoc();
      const index = doc.keys.findIndex((row) => String(row.id || '') === targetId && String(row.userId || '') === safeUserId);
      if (index < 0) {
        return { deleted: false };
      }
      const [removed] = doc.keys.splice(index, 1);
      this.saveVaultDoc(doc);
      this.appendLog({
        userId: safeUserId,
        event: 'vault.key.deleted',
        service: String(removed.service || ''),
        keyId: targetId
      });
      return { deleted: true, id: targetId };
    });
  }

  async markVaultKeyUsed(keyId) {
    const targetId = String(keyId || '').trim();
    if (!targetId) return;

    await this.withLock('vault', async () => {
      const doc = this.vaultDoc();
      const row = doc.keys.find((item) => String(item.id || '') === targetId);
      if (!row) return;
      row.lastUsedAt = storage.nowIso();
      row.updatedAt = storage.nowIso();
      this.saveVaultDoc(doc);
    });
  }

  async getByokKey(userId, serviceList = []) {
    const safeUserId = storage.sanitizeId(userId);
    const services = Array.isArray(serviceList) && serviceList.length
      ? serviceList.map((x) => storage.sanitizeId(x.toLowerCase())).filter(Boolean)
      : [];

    const doc = this.vaultDoc();
    const rows = doc.keys
      .filter((row) => String(row.userId || '') === safeUserId)
      .sort((a, b) => (String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1));

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (services.length && !services.includes(String(row.service || ''))) continue;
      try {
        const plaintext = this.decryptSecret(row);
        await this.markVaultKeyUsed(row.id);
        return {
          id: String(row.id || ''),
          service: String(row.service || ''),
          key: plaintext,
          mask: String(row.keyMask || '')
        };
      } catch {
        // ignore broken key material
      }
    }

    return null;
  }

  usageDoc() {
    const doc = storage.readJson(this.usageFile, { days: {} });
    return {
      days: storage.isPlainObject(doc?.days) ? doc.days : {}
    };
  }

  saveUsageDoc(doc) {
    const safe = {
      days: storage.isPlainObject(doc?.days) ? doc.days : {}
    };
    storage.writeJsonAtomic(this.usageFile, safe);
  }

  async incrementUsage(userId, service) {
    const safeUserId = storage.sanitizeId(userId);
    const serviceId = storage.sanitizeId(service || 'unknown');
    const day = isoDay();

    await this.withLock('usage', async () => {
      const doc = this.usageDoc();
      doc.days[day] = doc.days[day] || {};
      doc.days[day][safeUserId] = doc.days[day][safeUserId] || {};
      doc.days[day][safeUserId][serviceId] = Number(doc.days[day][safeUserId][serviceId] || 0) + 1;
      this.saveUsageDoc(doc);
    });
  }

  usageSummary(userId) {
    const safeUserId = storage.sanitizeId(userId);
    const doc = this.usageDoc();
    const day = isoDay();
    const today = storage.isPlainObject(doc.days?.[day]?.[safeUserId])
      ? doc.days[day][safeUserId]
      : {};

    const totals = {};
    Object.keys(doc.days || {}).forEach((d) => {
      const byUser = doc.days[d] && doc.days[d][safeUserId] && typeof doc.days[d][safeUserId] === 'object'
        ? doc.days[d][safeUserId]
        : {};
      Object.keys(byUser).forEach((service) => {
        totals[service] = Number(totals[service] || 0) + Number(byUser[service] || 0);
      });
    });

    return {
      day,
      today,
      totals
    };
  }

  enforceServiceRateLimit({ userId, service }) {
    const safeUserId = storage.sanitizeId(userId);
    const serviceId = storage.sanitizeId(service || 'unknown');
    const limit = Number(SERVICE_LIMITS_PER_MIN[serviceId] || 60);
    const key = `${safeUserId}|${serviceId}`;
    const now = Date.now();

    const existing = this.rateBuckets.get(key);
    const bucket = (!existing || existing.resetAt <= now)
      ? { count: 0, resetAt: now + 60_000 }
      : existing;

    if (bucket.count >= limit) {
      const retryAfterMs = Math.max(250, bucket.resetAt - now);
      const error = new Error(`Rate limit exceeded for ${serviceId}.`);
      error.status = 429;
      error.code = 'SERVICE_RATE_LIMIT';
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    bucket.count += 1;
    this.rateBuckets.set(key, bucket);
    return {
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: new Date(bucket.resetAt).toISOString()
    };
  }

  parseCliArgs(value) {
    if (Array.isArray(value)) {
      return value.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 64);
    }
    if (typeof value === 'string') {
      const chunks = String(value)
        .split(' ')
        .map((x) => x.trim())
        .filter(Boolean);
      return chunks.slice(0, 64);
    }
    return [];
  }

  resolveCliEntrypoint() {
    const custom = String(process.env.SOCIAL_HOSTED_CLI_ENTRY || '').trim();
    const candidates = [
      custom,
      path.resolve(process.cwd(), 'bin', 'social.js'),
      path.resolve(__dirname, '..', '..', 'bin', 'social.js'),
      path.resolve(process.cwd(), 'dist-legacy', 'bin', 'social.js')
    ].filter(Boolean);

    for (let i = 0; i < candidates.length; i += 1) {
      if (fs.existsSync(candidates[i])) return candidates[i];
    }

    throw new Error('Unable to resolve CLI entrypoint for wrapper mode.');
  }

  async executeCli(args, options = {}) {
    const argv = this.parseCliArgs(args);
    const timeoutMs = Math.max(1000, Math.min(120_000, Number(options.timeoutMs || 30_000)));
    const entry = this.resolveCliEntrypoint();

    return new Promise((resolve) => {
      const started = Date.now();
      let child = null;
      try {
        child = spawn(process.execPath, [entry, '--no-banner', ...argv], {
          cwd: process.cwd(),
          env: { ...process.env },
          windowsHide: true,
          shell: false
        });
      } catch (error) {
        resolve({
          args: argv,
          exitCode: -1,
          signal: '',
          stdout: '',
          stderr: String(error?.message || error || ''),
          durationMs: Date.now() - started,
          ok: false,
          error: String(error?.message || error || '')
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      const outputLimit = 1024 * 1024;
      let settled = false;

      const done = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += Buffer.from(chunk).toString('utf8');
        if (stdout.length > outputLimit) stdout = stdout.slice(stdout.length - outputLimit);
      });

      child.stderr.on('data', (chunk) => {
        stderr += Buffer.from(chunk).toString('utf8');
        if (stderr.length > outputLimit) stderr = stderr.slice(stderr.length - outputLimit);
      });

      child.on('error', (error) => {
        done({
          args: argv,
          exitCode: -1,
          signal: '',
          stdout: stdout.trim(),
          stderr: [stderr, String(error?.message || error || '')].filter(Boolean).join('\n').trim(),
          durationMs: Date.now() - started,
          ok: false,
          error: String(error?.message || error || '')
        });
      });

      child.on('close', (code, signal) => {
        done({
          args: argv,
          exitCode: Number(code),
          signal: signal || '',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs: Date.now() - started,
          ok: Number(code) === 0
        });
      });
    });
  }

  buildToolCatalog() {
    return [
      {
        key: 'meta.status',
        service: 'meta_marketing',
        title: 'Meta Status',
        description: 'Fetch gateway status snapshot from SDK executor.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        handler: async () => this.executeSdkAction('status', {})
      },
      {
        key: 'meta.doctor',
        service: 'meta_marketing',
        title: 'Meta Doctor',
        description: 'Run health doctor checks for configured Meta setup.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        handler: async () => this.executeSdkAction('doctor', {})
      },
      {
        key: 'meta.get_profile',
        service: 'meta_marketing',
        title: 'Meta Profile',
        description: 'Fetch current profile from Graph API via SDK action.',
        inputSchema: {
          type: 'object',
          properties: {
            fields: { type: 'string' }
          },
          additionalProperties: false
        },
        handler: async (props) => this.executeSdkAction('get_profile', {
          fields: String(props.fields || 'id,name').trim() || 'id,name'
        })
      },
      {
        key: 'meta.list_ads',
        service: 'meta_marketing',
        title: 'Meta List Ads',
        description: 'List campaigns for an ad account.',
        inputSchema: {
          type: 'object',
          properties: {
            adAccountId: { type: 'string' },
            limit: { type: 'number' },
            fields: { type: 'string' }
          },
          additionalProperties: false
        },
        handler: async (props) => this.executeSdkAction('list_ads', {
          adAccountId: String(props.adAccountId || props.accountId || '').trim(),
          limit: Number(props.limit || 25) || 25,
          fields: String(props.fields || '').trim()
        })
      },
      {
        key: 'meta.create_post',
        service: 'meta_marketing',
        title: 'Meta Create Post',
        description: 'Create or schedule a Facebook page post.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            message: { type: 'string' },
            link: { type: 'string' },
            draft: { type: 'boolean' },
            schedule: { type: 'string' }
          },
          additionalProperties: false
        },
        handler: async (props) => this.executeSdkAction('create_post', {
          pageId: String(props.pageId || '').trim(),
          message: String(props.message || '').trim(),
          link: String(props.link || '').trim(),
          draft: Boolean(props.draft),
          schedule: props.schedule !== undefined ? String(props.schedule) : ''
        })
      },
      {
        key: 'whatsapp.send_text',
        service: 'whatsapp_cloud',
        title: 'WhatsApp Send Text',
        description: 'Send a WhatsApp text message via SDK action wrapper.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            body: { type: 'string' }
          },
          required: ['to', 'body'],
          additionalProperties: false
        },
        handler: async (props) => this.executeSdkAction('send_whatsapp', {
          from: String(props.from || props.phoneNumberId || '').trim(),
          to: String(props.to || '').trim(),
          body: String(props.body || '').trim()
        })
      },
      {
        key: 'gateway.logs',
        service: 'gateway',
        title: 'Gateway Logs',
        description: 'Read gateway action logs.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' }
          },
          additionalProperties: false
        },
        handler: async (props) => this.executeSdkAction('logs', {
          limit: Number(props.limit || 20) || 20
        })
      },
      {
        key: 'cli.command',
        service: 'cli_runtime',
        title: 'CLI Wrapper Command',
        description: 'Execute existing Social Flow CLI commands through REST wrapper.',
        inputSchema: {
          type: 'object',
          properties: {
            argv: {
              type: 'array',
              items: { type: 'string' }
            },
            timeoutMs: { type: 'number' }
          },
          required: ['argv'],
          additionalProperties: false
        },
        handler: async (props) => {
          const argv = this.parseCliArgs(props.argv || []);
          return this.executeCli(argv, {
            timeoutMs: Number(props.timeoutMs || 30_000) || 30_000
          });
        }
      },
      {
        key: 'browser.list_sessions',
        service: 'web_browser',
        title: 'Browser List Sessions',
        description: 'List active browser automation sessions for the current user.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        handler: async (_props, context) => this.listBrowserSessions(context.userId || 'default')
      },
      {
        key: 'browser.session_create',
        service: 'web_browser',
        title: 'Browser Session Create',
        description: 'Start a new Playwright Chromium session.',
        inputSchema: {
          type: 'object',
          properties: {
            headless: { type: 'boolean' },
            viewportWidth: { type: 'number' },
            viewportHeight: { type: 'number' },
            userAgent: { type: 'string' },
            timeoutMs: { type: 'number' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.createBrowserSession(context.userId || 'default', {
          headless: props.headless,
          viewportWidth: props.viewportWidth,
          viewportHeight: props.viewportHeight,
          userAgent: props.userAgent,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.goto',
        service: 'web_browser',
        title: 'Browser Goto',
        description: 'Navigate an existing browser session to a URL.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            url: { type: 'string' },
            waitUntil: { type: 'string' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId', 'url'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserGoto(context.userId || 'default', {
          sessionId: props.sessionId,
          url: props.url,
          waitUntil: props.waitUntil,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.click',
        service: 'web_browser',
        title: 'Browser Click',
        description: 'Click an element in a browser session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            selector: { type: 'string' },
            button: { type: 'string' },
            clickCount: { type: 'number' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId', 'selector'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserClick(context.userId || 'default', {
          sessionId: props.sessionId,
          selector: props.selector,
          button: props.button,
          clickCount: props.clickCount,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.type',
        service: 'web_browser',
        title: 'Browser Type',
        description: 'Type or fill text into an element.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            selector: { type: 'string' },
            text: { type: 'string' },
            clear: { type: 'boolean' },
            delayMs: { type: 'number' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId', 'selector', 'text'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserType(context.userId || 'default', {
          sessionId: props.sessionId,
          selector: props.selector,
          text: props.text,
          clear: props.clear,
          delayMs: props.delayMs,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.press',
        service: 'web_browser',
        title: 'Browser Press',
        description: 'Press a keyboard key in the browser session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            key: { type: 'string' },
            selector: { type: 'string' },
            delayMs: { type: 'number' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId', 'key'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserPress(context.userId || 'default', {
          sessionId: props.sessionId,
          key: props.key,
          selector: props.selector,
          delayMs: props.delayMs,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.wait_for',
        service: 'web_browser',
        title: 'Browser Wait For',
        description: 'Wait for a selector state transition.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            selector: { type: 'string' },
            state: { type: 'string' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId', 'selector'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserWaitFor(context.userId || 'default', {
          sessionId: props.sessionId,
          selector: props.selector,
          state: props.state,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.extract_text',
        service: 'web_browser',
        title: 'Browser Extract Text',
        description: 'Extract text (and optional HTML) from page or selector.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            selector: { type: 'string' },
            includeHtml: { type: 'boolean' },
            maxChars: { type: 'number' },
            maxHtmlChars: { type: 'number' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserExtractText(context.userId || 'default', {
          sessionId: props.sessionId,
          selector: props.selector,
          includeHtml: props.includeHtml,
          maxChars: props.maxChars,
          maxHtmlChars: props.maxHtmlChars,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.screenshot',
        service: 'web_browser',
        title: 'Browser Screenshot',
        description: 'Capture page or element screenshot as base64 image.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            selector: { type: 'string' },
            fullPage: { type: 'boolean' },
            type: { type: 'string' },
            quality: { type: 'number' },
            timeoutMs: { type: 'number' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.browserScreenshot(context.userId || 'default', {
          sessionId: props.sessionId,
          selector: props.selector,
          fullPage: props.fullPage,
          type: props.type,
          quality: props.quality,
          timeoutMs: props.timeoutMs
        })
      },
      {
        key: 'browser.session_close',
        service: 'web_browser',
        title: 'Browser Session Close',
        description: 'Close and dispose a browser session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.closeBrowserSession(context.userId || 'default', props.sessionId)
      },
      {
        key: 'browser.fetch_page',
        service: 'web_browser',
        title: 'Browser Fetch Page',
        description: 'Fetch and summarize an HTTP(S) web page with extracted links.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            timeoutMs: { type: 'number' },
            maxTextChars: { type: 'number' },
            maxLinks: { type: 'number' },
            includeHtml: { type: 'boolean' },
            maxHtmlChars: { type: 'number' }
          },
          required: ['url'],
          additionalProperties: false
        },
        handler: async (props) => fetchBrowserPageSummary(props.url, {
          timeoutMs: Number(props.timeoutMs || 15_000) || 15_000,
          maxTextChars: Number(props.maxTextChars || 4_000) || 4_000,
          maxLinks: Number(props.maxLinks || 20) || 20,
          includeHtml: Boolean(props.includeHtml),
          maxHtmlChars: Number(props.maxHtmlChars || 120_000) || 120_000
        })
      },
      {
        key: 'webchat.create_widget_key',
        service: 'webchat_channel',
        title: 'Webchat Create Widget Key',
        description: 'Create a public widget key for starting anonymous chat sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.createWidgetKey({
          userId: context.userId || 'default',
          label: String(props.label || '').trim()
        })
      },
      {
        key: 'webchat.list_widget_keys',
        service: 'webchat_channel',
        title: 'Webchat List Widget Keys',
        description: 'List masked widget keys for the current user.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        handler: async (_props, context) => this.webchat.listWidgetKeys(context.userId || 'default')
      },
      {
        key: 'webchat.delete_widget_key',
        service: 'webchat_channel',
        title: 'Webchat Delete Widget Key',
        description: 'Delete one widget key by id.',
        inputSchema: {
          type: 'object',
          properties: {
            keyId: { type: 'string' }
          },
          required: ['keyId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.deleteWidgetKey({
          userId: context.userId || 'default',
          keyId: String(props.keyId || '').trim()
        })
      },
      {
        key: 'webchat.create_session',
        service: 'webchat_channel',
        title: 'Webchat Create Session',
        description: 'Create an operator-owned internal webchat session.',
        inputSchema: {
          type: 'object',
          properties: {
            visitorId: { type: 'string' },
            metadata: { type: 'object' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.createSession({
          userId: context.userId || 'default',
          visitorId: String(props.visitorId || '').trim(),
          metadata: storage.isPlainObject(props.metadata) ? props.metadata : {},
          source: 'internal'
        })
      },
      {
        key: 'webchat.list_sessions',
        service: 'webchat_channel',
        title: 'Webchat List Sessions',
        description: 'List webchat sessions with optional status filter.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            limit: { type: 'number' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.listSessions(context.userId || 'default', {
          status: String(props.status || '').trim(),
          limit: Number(props.limit || 100) || 100
        })
      },
      {
        key: 'webchat.get_messages',
        service: 'webchat_channel',
        title: 'Webchat Get Messages',
        description: 'Read stored messages for one webchat session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => {
          const sessionId = String(props.sessionId || '').trim();
          const session = await this.webchat.getSession(context.userId || 'default', sessionId);
          if (!session) {
            const error = new Error('Session not found.');
            error.status = 404;
            error.code = 'WEBCHAT_SESSION_NOT_FOUND';
            throw error;
          }
          return {
            session,
            messages: this.webchat.listMessages({
              userId: context.userId || 'default',
              sessionId,
              limit: Number(props.limit || 200) || 200
            })
          };
        }
      },
      {
        key: 'webchat.reply',
        service: 'webchat_channel',
        title: 'Webchat Reply',
        description: 'Append an outbound operator message to a webchat session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object' }
          },
          required: ['sessionId', 'text'],
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.appendOutbound({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim(),
          text: String(props.text || '').trim(),
          metadata: storage.isPlainObject(props.metadata) ? props.metadata : {},
          source: 'agent'
        })
      },
      {
        key: 'webchat.set_status',
        service: 'webchat_channel',
        title: 'Webchat Set Status',
        description: 'Open or close a webchat session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            status: { type: 'string' }
          },
          required: ['sessionId', 'status'],
          additionalProperties: false
        },
        handler: async (props, context) => this.webchat.setSessionStatus({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim(),
          status: String(props.status || '').trim()
        })
      },
      {
        key: 'baileys.create_session',
        service: 'baileys_channel',
        title: 'Baileys Create Session',
        description: 'Create a WhatsApp Web session placeholder.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            phone: { type: 'string' },
            metadata: { type: 'object' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.createSession({
          userId: context.userId || 'default',
          label: String(props.label || '').trim(),
          phone: String(props.phone || '').trim(),
          metadata: storage.isPlainObject(props.metadata) ? props.metadata : {}
        })
      },
      {
        key: 'baileys.list_sessions',
        service: 'baileys_channel',
        title: 'Baileys List Sessions',
        description: 'List WhatsApp Web sessions for the current user.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            limit: { type: 'number' }
          },
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.listSessions(context.userId || 'default', {
          status: String(props.status || '').trim(),
          limit: Number(props.limit || 100) || 100
        })
      },
      {
        key: 'baileys.connect_session',
        service: 'baileys_channel',
        title: 'Baileys Connect Session',
        description: 'Connect and request QR for a Baileys session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            force: { type: 'boolean' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.connectSession({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim(),
          force: Boolean(props.force)
        })
      },
      {
        key: 'baileys.disconnect_session',
        service: 'baileys_channel',
        title: 'Baileys Disconnect Session',
        description: 'Disconnect an active Baileys session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            logout: { type: 'boolean' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.disconnectSession({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim(),
          logout: Boolean(props.logout)
        })
      },
      {
        key: 'baileys.delete_session',
        service: 'baileys_channel',
        title: 'Baileys Delete Session',
        description: 'Delete a Baileys session and clear local auth state.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.deleteSession({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim()
        })
      },
      {
        key: 'baileys.send_text',
        service: 'baileys_channel',
        title: 'Baileys Send Text',
        description: 'Send outbound text through a connected Baileys session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            to: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object' }
          },
          required: ['sessionId', 'text'],
          additionalProperties: false
        },
        handler: async (props, context) => this.baileys.sendText({
          userId: context.userId || 'default',
          sessionId: String(props.sessionId || '').trim(),
          to: String(props.to || '').trim(),
          text: String(props.text || props.body || '').trim(),
          metadata: storage.isPlainObject(props.metadata) ? props.metadata : {}
        })
      },
      {
        key: 'baileys.get_messages',
        service: 'baileys_channel',
        title: 'Baileys Get Messages',
        description: 'Read persisted message history for one Baileys session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['sessionId'],
          additionalProperties: false
        },
        handler: async (props, context) => {
          const sessionId = String(props.sessionId || '').trim();
          const session = await this.baileys.getSession(context.userId || 'default', sessionId);
          return {
            session,
            messages: this.baileys.listMessages({
              userId: context.userId || 'default',
              sessionId,
              limit: Number(props.limit || 200) || 200
            })
          };
        }
      }
    ];
  }

  async createWebchatWidgetKey(userId, payload = {}) {
    return this.webchat.createWidgetKey({
      userId,
      label: String(payload.label || '').trim()
    });
  }

  async listWebchatWidgetKeys(userId) {
    return this.webchat.listWidgetKeys(userId);
  }

  async deleteWebchatWidgetKey(userId, keyId) {
    return this.webchat.deleteWidgetKey({ userId, keyId });
  }

  async createWebchatSession(userId, payload = {}) {
    return this.webchat.createSession({
      userId,
      visitorId: String(payload.visitorId || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {},
      source: String(payload.source || 'internal')
    });
  }

  async listWebchatSessions(userId, options = {}) {
    return this.webchat.listSessions(userId, options);
  }

  async getWebchatSessionMessages(userId, sessionId, limit = 200) {
    const session = await this.webchat.getSession(userId, sessionId);
    if (!session) {
      const error = new Error('Session not found.');
      error.status = 404;
      error.code = 'WEBCHAT_SESSION_NOT_FOUND';
      throw error;
    }
    return {
      session,
      messages: this.webchat.listMessages({ userId, sessionId, limit })
    };
  }

  async replyWebchatSession(userId, sessionId, payload = {}) {
    return this.webchat.appendOutbound({
      userId,
      sessionId,
      text: String(payload.text || payload.body || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {},
      source: String(payload.source || 'operator')
    });
  }

  async setWebchatSessionStatus(userId, sessionId, status) {
    return this.webchat.setSessionStatus({
      userId,
      sessionId,
      status
    });
  }

  async startPublicWebchatSession(payload = {}) {
    return this.webchat.startPublicSession({
      widgetKey: String(payload.widgetKey || payload.widget_key || '').trim(),
      visitorId: String(payload.visitorId || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {}
    });
  }

  async appendPublicWebchatMessage(payload = {}) {
    return this.webchat.appendInboundByToken({
      sessionToken: String(payload.sessionToken || payload.session_token || '').trim(),
      text: String(payload.text || payload.body || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {},
      source: String(payload.source || 'public')
    });
  }

  async createBaileysSession(userId, payload = {}) {
    return this.baileys.createSession({
      userId,
      label: String(payload.label || '').trim(),
      phone: String(payload.phone || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {}
    });
  }

  async listBaileysSessions(userId, options = {}) {
    return this.baileys.listSessions(userId, options);
  }

  async connectBaileysSession(userId, sessionId, options = {}) {
    return this.baileys.connectSession({
      userId,
      sessionId,
      force: Boolean(options.force)
    });
  }

  async disconnectBaileysSession(userId, sessionId, options = {}) {
    return this.baileys.disconnectSession({
      userId,
      sessionId,
      logout: Boolean(options.logout)
    });
  }

  async deleteBaileysSession(userId, sessionId) {
    return this.baileys.deleteSession({ userId, sessionId });
  }

  async sendBaileysText(userId, sessionId, payload = {}) {
    return this.baileys.sendText({
      userId,
      sessionId,
      to: String(payload.to || '').trim(),
      text: String(payload.text || payload.body || '').trim(),
      metadata: storage.isPlainObject(payload.metadata) ? payload.metadata : {}
    });
  }

  async getBaileysMessages(userId, sessionId, limit = 200) {
    const session = await this.baileys.getSession(userId, sessionId);
    return {
      session,
      messages: this.baileys.listMessages({
        userId,
        sessionId,
        limit
      })
    };
  }

  listTools() {
    return this.tools.map((tool) => ({
      key: tool.key,
      service: tool.service,
      title: tool.title,
      description: tool.description,
      inputSchema: clone(tool.inputSchema)
    }));
  }

  toolByKey(toolKey) {
    return this.toolMap.get(String(toolKey || '').trim()) || null;
  }

  async executeTool(toolKey, actionProps, context = {}) {
    const tool = this.toolByKey(toolKey);
    if (!tool) {
      const error = new Error(`Unknown tool: ${toolKey}`);
      error.code = 'UNKNOWN_TOOL';
      error.status = 400;
      throw error;
    }

    const userId = storage.sanitizeId(context.userId || 'default');
    this.enforceServiceRateLimit({ userId, service: tool.service });
    await this.incrementUsage(userId, tool.service);

    const maxAttempts = Math.max(1, Math.min(5, Number(actionProps?.max_attempts || 3) || 3));
    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      const started = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        const output = await tool.handler(actionProps || {}, context);
        const elapsed = Date.now() - started;
        this.appendLog({
          userId,
          event: 'tool.execution',
          status: 'ok',
          service: tool.service,
          toolKey: tool.key,
          attempt,
          durationMs: elapsed,
          traceId: context.traceId || ''
        });
        return {
          tool_key: tool.key,
          service: tool.service,
          attempt,
          duration_ms: elapsed,
          output
        };
      } catch (error) {
        lastError = error;
        const elapsed = Date.now() - started;
        const retryable = isRetryable(error);
        this.appendLog({
          userId,
          event: 'tool.execution',
          status: 'error',
          service: tool.service,
          toolKey: tool.key,
          attempt,
          durationMs: elapsed,
          traceId: context.traceId || '',
          error: errorPayload(error)
        });

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }

        const retryAfterMs = Number(error?.retryAfterMs || 0);
        const base = retryAfterMs > 0 ? retryAfterMs : 250 * (2 ** (attempt - 1));
        const waitMs = Math.min(8000, Math.max(120, base));
        // eslint-disable-next-line no-await-in-loop
        await storage.sleep(waitMs);
      }
    }

    throw lastError || new Error('Tool execution failed.');
  }

  userAgentsDoc() {
    const doc = storage.readJson(this.agentsFile, { users: {} });
    return {
      users: storage.isPlainObject(doc?.users) ? doc.users : {}
    };
  }

  saveUserAgentsDoc(doc) {
    const safe = {
      users: storage.isPlainObject(doc?.users) ? doc.users : {}
    };
    storage.writeJsonAtomic(this.agentsFile, safe);
  }

  listUserAgents(userId) {
    const safeUserId = storage.sanitizeId(userId);
    const doc = this.userAgentsDoc();
    const list = Array.isArray(doc.users?.[safeUserId]) ? doc.users[safeUserId] : [];
    return list.map((agent) => ({
      slug: storage.sanitizeId(agent.slug || ''),
      name: String(agent.name || '').trim(),
      description: String(agent.description || '').trim(),
      tools: Array.isArray(agent.tools) ? agent.tools.map((x) => String(x || '').trim()).filter(Boolean) : [],
      source: 'user',
      createdAt: String(agent.createdAt || ''),
      updatedAt: String(agent.updatedAt || '')
    }));
  }

  listAgents(userId) {
    const builtins = BUILTIN_AGENTS.map((agent) => ({ ...agent, source: 'builtin' }));
    const userAgents = this.listUserAgents(userId);
    return [...builtins, ...userAgents];
  }

  async upsertUserAgent(userId, payload = {}) {
    const safeUserId = storage.sanitizeId(userId);
    const slug = storage.sanitizeId(payload.slug || payload.id || '');
    if (!slug) throw new Error('Agent slug is required.');
    if (BUILTIN_AGENTS.some((agent) => agent.slug === slug)) {
      throw new Error(`Agent slug is reserved: ${slug}`);
    }

    const name = String(payload.name || slug).trim() || slug;
    const description = String(payload.description || '').trim();
    const tools = Array.isArray(payload.tools)
      ? payload.tools.map((x) => String(x || '').trim()).filter((x) => Boolean(this.toolByKey(x)))
      : [];

    if (!tools.length) {
      throw new Error('User-defined agent requires at least one valid tool key.');
    }

    return this.withLock('agents', async () => {
      const doc = this.userAgentsDoc();
      const list = Array.isArray(doc.users[safeUserId]) ? doc.users[safeUserId] : [];
      const now = storage.nowIso();
      const index = list.findIndex((row) => String(row.slug || '') === slug);
      const next = {
        slug,
        name,
        description,
        tools,
        createdAt: index >= 0 ? String(list[index].createdAt || now) : now,
        updatedAt: now
      };

      if (index >= 0) list[index] = next;
      else list.push(next);

      doc.users[safeUserId] = list;
      this.saveUserAgentsDoc(doc);

      this.appendLog({
        userId: safeUserId,
        event: 'agent.upserted',
        agentSlug: slug,
        status: 'ok'
      });

      return { ...next, source: 'user' };
    });
  }

  async deleteUserAgent(userId, slugValue) {
    const safeUserId = storage.sanitizeId(userId);
    const slug = storage.sanitizeId(slugValue || '');
    if (!slug) throw new Error('Missing agent slug.');

    return this.withLock('agents', async () => {
      const doc = this.userAgentsDoc();
      const list = Array.isArray(doc.users[safeUserId]) ? doc.users[safeUserId] : [];
      const index = list.findIndex((row) => String(row.slug || '') === slug);
      if (index < 0) return { deleted: false };
      list.splice(index, 1);
      doc.users[safeUserId] = list;
      this.saveUserAgentsDoc(doc);
      this.appendLog({ userId: safeUserId, event: 'agent.deleted', agentSlug: slug, status: 'ok' });
      return { deleted: true, slug };
    });
  }

  resolveAgent(userId, slug) {
    const candidate = String(slug || '').trim();
    const all = this.listAgents(userId);
    return all.find((row) => String(row.slug || '') === candidate) || null;
  }

  routeAgentSlugs(task) {
    const raw = String(task || '').toLowerCase();
    const out = [];

    if (/\b(whatsapp|message|send text|send message|waba)\b/.test(raw)) {
      out.push('messaging-agent');
    }
    if (/\b(browser|browse|web page|webpage|website|url|link|crawl|scrape|research)\b/.test(raw)) {
      out.push('browser-agent');
    }
    if (/\b(webchat|live chat|widget|visitor|inbox)\b/.test(raw)) {
      out.push('webchat-agent');
    }
    if (/\b(baileys|whatsapp web|qr code|pair device)\b/.test(raw)) {
      out.push('baileys-agent');
    }
    if (/\b(ad|ads|campaign|creative|roas|cpc|post|insights)\b/.test(raw)) {
      out.push('marketing-agent');
    }
    if (/\b(report|analytics|diagnose|logs|summary)\b/.test(raw)) {
      out.push('analytics-agent');
    }
    if (/\b(cli|ops|doctor|status|deploy|runbook)\b/.test(raw)) {
      out.push('ops-agent');
    }

    if (!out.length) out.push('router-agent');

    const dedupe = [];
    const seen = new Set();
    out.forEach((slug) => {
      if (seen.has(slug)) return;
      seen.add(slug);
      dedupe.push(slug);
    });
    return dedupe;
  }

  resolveToolForAgent(agent, task, actionKey) {
    if (!agent) return '';
    const allowedTools = Array.isArray(agent.tools) ? agent.tools : [];

    const normalizedAction = String(actionKey || '').trim().toLowerCase();
    if (normalizedAction) {
      const mapped = ACTION_TOOL_MAP[normalizedAction] || normalizedAction;
      if (allowedTools.includes(mapped)) return mapped;
      if (this.toolByKey(mapped)) return mapped;
    }

    const taskText = String(task || '').toLowerCase();
    if (/\b(browser|browse|web page|webpage|website|url|link|crawl|scrape|research)\b/.test(taskText)) {
      if (/\b(list|show)\b/.test(taskText) && /\bsession(s)?\b/.test(taskText) && allowedTools.includes('browser.list_sessions')) {
        return 'browser.list_sessions';
      }
      if (/\b(create|new|start|open)\b/.test(taskText) && /\bsession(s)?\b/.test(taskText) && allowedTools.includes('browser.session_create')) {
        return 'browser.session_create';
      }
      if (/\b(close|end|stop|dispose)\b/.test(taskText) && /\bsession(s)?\b/.test(taskText) && allowedTools.includes('browser.session_close')) {
        return 'browser.session_close';
      }
      if (/\b(screenshot|screen shot|capture)\b/.test(taskText) && allowedTools.includes('browser.screenshot')) {
        return 'browser.screenshot';
      }
      if (/\b(extract|read|scrape|content|text)\b/.test(taskText) && allowedTools.includes('browser.extract_text')) {
        return 'browser.extract_text';
      }
      if (/\b(click|tap)\b/.test(taskText) && allowedTools.includes('browser.click')) {
        return 'browser.click';
      }
      if (/\b(type|fill|enter)\b/.test(taskText) && allowedTools.includes('browser.type')) {
        return 'browser.type';
      }
      if (/\b(key|press|keyboard|enter key)\b/.test(taskText) && allowedTools.includes('browser.press')) {
        return 'browser.press';
      }
      if (/\b(wait|until|visible|hidden)\b/.test(taskText) && allowedTools.includes('browser.wait_for')) {
        return 'browser.wait_for';
      }
      if (/\b(open|visit|navigate|goto)\b/.test(taskText) && allowedTools.includes('browser.goto')) {
        return 'browser.goto';
      }
      if (allowedTools.includes('browser.fetch_page')) {
        return 'browser.fetch_page';
      }
    }
    if (/\b(send|whatsapp|message|text)\b/.test(taskText) && allowedTools.includes('whatsapp.send_text')) {
      return 'whatsapp.send_text';
    }
    if (/\b(webchat|visitor|widget|inbox)\b/.test(taskText) && allowedTools.includes('webchat.list_sessions')) {
      return 'webchat.list_sessions';
    }
    if (/\b(webchat|reply|respond)\b/.test(taskText) && allowedTools.includes('webchat.reply')) {
      return 'webchat.reply';
    }
    if (/\b(baileys|whatsapp web|qr|pair)\b/.test(taskText) && allowedTools.includes('baileys.list_sessions')) {
      return 'baileys.list_sessions';
    }
    if (/\b(connect|pair|qr)\b/.test(taskText) && allowedTools.includes('baileys.connect_session')) {
      return 'baileys.connect_session';
    }
    if (/\b(send|message|text)\b/.test(taskText) && allowedTools.includes('baileys.send_text')) {
      return 'baileys.send_text';
    }
    if (/\b(post|publish|facebook)\b/.test(taskText) && allowedTools.includes('meta.create_post')) {
      return 'meta.create_post';
    }
    if (/\b(ad|campaign|cpc|roas|insight)\b/.test(taskText) && allowedTools.includes('meta.list_ads')) {
      return 'meta.list_ads';
    }
    if (/\b(log|history|trace)\b/.test(taskText) && allowedTools.includes('gateway.logs')) {
      return 'gateway.logs';
    }
    if (/\b(help|command|cli|execute)\b/.test(taskText) && allowedTools.includes('cli.command')) {
      return 'cli.command';
    }

    return allowedTools[0] || '';
  }

  async executeAgentStep(step, context = {}) {
    const userId = storage.sanitizeId(context.userId || step.userId || 'default');
    const agent = this.resolveAgent(userId, step.agent_slug || step.agentSlug || '');
    if (!agent) {
      const error = new Error(`Unknown agent: ${step.agent_slug || step.agentSlug || ''}`);
      error.status = 400;
      error.code = 'UNKNOWN_AGENT';
      throw error;
    }

    const toolKey = this.resolveToolForAgent(agent, context.task || step.task || '', step.action_key || step.actionKey || '');
    if (!toolKey) {
      const error = new Error(`No compatible tool for agent ${agent.slug}.`);
      error.status = 400;
      error.code = 'NO_AGENT_TOOL';
      throw error;
    }

    const started = Date.now();
    const result = await this.executeTool(toolKey, storage.isPlainObject(step.action_props) ? step.action_props : {}, {
      userId,
      traceId: context.traceId || '',
      task: context.task || step.task || '',
      agentSlug: agent.slug
    });

    return {
      agent_slug: agent.slug,
      agent_name: agent.name,
      description: agent.description,
      tool_key: toolKey,
      duration_ms: Date.now() - started,
      output: result.output
    };
  }

  normalizeRecipe(rawRecipe, input = {}) {
    const source = storage.isPlainObject(rawRecipe) ? rawRecipe : {};
    const slug = storage.sanitizeId(source.slug || input.slug || '');
    if (!slug) throw new Error('Recipe slug is required.');

    const steps = Array.isArray(source.steps) ? source.steps : [];
    if (!steps.length) throw new Error('Recipe requires at least one step.');

    const normalizedSteps = steps.map((step, idx) => {
      const item = storage.isPlainObject(step) ? step : {};
      const agentSlug = String(item.agent_slug || item.agentSlug || '').trim();
      const actionKey = String(item.action_key || item.actionKey || '').trim();
      if (!agentSlug) throw new Error(`Recipe step ${idx + 1} missing agent_slug.`);
      if (!actionKey) throw new Error(`Recipe step ${idx + 1} missing action_key.`);
      const actionProps = storage.isPlainObject(item.action_props)
        ? item.action_props
        : (storage.isPlainObject(item.actionProps) ? item.actionProps : {});
      return {
        agent_slug: agentSlug,
        action_key: actionKey,
        action_props: actionProps,
        format_guide: String(item.format_guide || item.formatGuide || '').trim()
      };
    });

    const mode = String(source.mode || input.mode || 'sequential').trim().toLowerCase();

    return {
      slug,
      name: String(source.name || input.name || slug).trim() || slug,
      description: String(source.description || input.description || '').trim(),
      mode: mode === 'parallel' ? 'parallel' : 'sequential',
      steps: normalizedSteps,
      metadata: storage.isPlainObject(source.metadata) ? source.metadata : {}
    };
  }

  parseRecipeInput(payload = {}) {
    if (storage.isPlainObject(payload.recipe)) {
      return this.normalizeRecipe(payload.recipe, payload);
    }

    const content = String(payload.content || '').trim();
    if (!content) {
      throw new Error('Provide either recipe object or content string.');
    }

    const format = String(payload.format || '').trim().toLowerCase();
    let parsed = null;

    if (format === 'yaml' || format === 'yml') {
      parsed = parseRecipeYaml(content);
    } else if (format === 'json' || !format) {
      parsed = JSON.parse(content);
    } else {
      throw new Error(`Unsupported recipe format: ${format}`);
    }

    return this.normalizeRecipe(parsed, payload);
  }

  recipeDir(userId) {
    const safeUserId = storage.sanitizeId(userId);
    return storage.ensureDir(path.join(this.recipesRoot, safeUserId));
  }

  recipeCandidates(userId, slug) {
    const safeSlug = storage.sanitizeId(slug || '');
    const dir = this.recipeDir(userId);
    return {
      json: path.join(dir, `${safeSlug}.json`),
      yaml: path.join(dir, `${safeSlug}.yaml`),
      yml: path.join(dir, `${safeSlug}.yml`)
    };
  }

  readRecipeFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = fs.readFileSync(filePath, 'utf8');
    if (ext === '.json') return JSON.parse(raw);
    if (ext === '.yaml' || ext === '.yml') return parseRecipeYaml(raw);
    return null;
  }

  findRecipeFile(userId, slug) {
    const candidates = this.recipeCandidates(userId, slug);
    if (fs.existsSync(candidates.json)) return candidates.json;
    if (fs.existsSync(candidates.yaml)) return candidates.yaml;
    if (fs.existsSync(candidates.yml)) return candidates.yml;
    return '';
  }

  async listRecipes(userId) {
    const dir = this.recipeDir(userId);
    const files = fs.readdirSync(dir)
      .filter((name) => /\.(json|yaml|yml)$/i.test(name));

    const map = new Map();
    files.forEach((name) => {
      const fullPath = path.join(dir, name);
      try {
        const parsed = this.readRecipeFromFile(fullPath);
        const normalized = this.normalizeRecipe(parsed, { slug: path.basename(name, path.extname(name)) });
        const stat = fs.statSync(fullPath);
        const row = {
          ...normalized,
          format: path.extname(name).replace('.', '').toLowerCase(),
          filePath: fullPath,
          updatedAt: stat.mtime.toISOString(),
          createdAt: stat.birthtime.toISOString()
        };
        const existing = map.get(normalized.slug);
        if (!existing || String(existing.updatedAt || '') < row.updatedAt) {
          map.set(normalized.slug, row);
        }
      } catch {
        // ignore malformed recipe files
      }
    });

    return Array.from(map.values()).sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || '')));
  }

  async getRecipe(userId, slug) {
    const filePath = this.findRecipeFile(userId, slug);
    if (!filePath) return null;

    const parsed = this.readRecipeFromFile(filePath);
    const normalized = this.normalizeRecipe(parsed, { slug });
    const stat = fs.statSync(filePath);
    return {
      ...normalized,
      format: path.extname(filePath).replace('.', '').toLowerCase(),
      filePath,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString()
    };
  }

  async upsertRecipe(userId, payload = {}) {
    const safeUserId = storage.sanitizeId(userId);
    const recipe = this.parseRecipeInput(payload);
    const format = String(payload.format || 'json').trim().toLowerCase();
    const outputFormat = (format === 'yaml' || format === 'yml') ? 'yaml' : 'json';

    return this.withLock(`recipes_${safeUserId}`, async () => {
      const candidates = this.recipeCandidates(safeUserId, recipe.slug);
      const now = storage.nowIso();
      const previous = await this.getRecipe(safeUserId, recipe.slug);

      if (outputFormat === 'json') {
        storage.writeJsonAtomic(candidates.json, {
          ...recipe,
          createdAt: previous?.createdAt || now,
          updatedAt: now
        });
        try { fs.rmSync(candidates.yaml, { force: true }); } catch {}
        try { fs.rmSync(candidates.yml, { force: true }); } catch {}
      } else {
        const yamlText = recipeToYaml({
          ...recipe,
          createdAt: previous?.createdAt || now,
          updatedAt: now
        });
        fs.writeFileSync(candidates.yaml, yamlText, 'utf8');
        try { fs.rmSync(candidates.json, { force: true }); } catch {}
        try { fs.rmSync(candidates.yml, { force: true }); } catch {}
      }

      this.appendLog({
        userId: safeUserId,
        event: 'recipe.upserted',
        recipeSlug: recipe.slug,
        format: outputFormat,
        status: 'ok'
      });

      const saved = await this.getRecipe(safeUserId, recipe.slug);
      return saved;
    });
  }

  async deleteRecipe(userId, slug) {
    const safeUserId = storage.sanitizeId(userId);
    const safeSlug = storage.sanitizeId(slug || '');
    if (!safeSlug) throw new Error('Missing recipe slug.');

    return this.withLock(`recipes_${safeUserId}`, async () => {
      const candidates = this.recipeCandidates(safeUserId, safeSlug);
      const exists = fs.existsSync(candidates.json) || fs.existsSync(candidates.yaml) || fs.existsSync(candidates.yml);
      try { fs.rmSync(candidates.json, { force: true }); } catch {}
      try { fs.rmSync(candidates.yaml, { force: true }); } catch {}
      try { fs.rmSync(candidates.yml, { force: true }); } catch {}

      if (exists) {
        this.appendLog({ userId: safeUserId, event: 'recipe.deleted', recipeSlug: safeSlug, status: 'ok' });
      }

      return { deleted: exists, slug: safeSlug };
    });
  }

  interpolateValue(template, context = {}) {
    if (Array.isArray(template)) {
      return template.map((item) => this.interpolateValue(item, context));
    }
    if (storage.isPlainObject(template)) {
      const out = {};
      Object.keys(template).forEach((key) => {
        out[key] = this.interpolateValue(template[key], context);
      });
      return out;
    }

    if (typeof template !== 'string') return template;

    const text = String(template);

    const directMatch = text.match(/^\$(prev|input)(?:\.([a-zA-Z0-9_.-]+))?$/);
    if (directMatch) {
      const sourceName = directMatch[1];
      const pathExpr = directMatch[2] || '';
      const source = sourceName === 'prev' ? context.prev : context.input;
      return pathGet(source, pathExpr);
    }

    return text.replace(/\$(prev|input)(?:\.([a-zA-Z0-9_.-]+))?/g, (raw, sourceName, pathExpr) => {
      const source = sourceName === 'prev' ? context.prev : context.input;
      const value = pathGet(source, pathExpr || '');
      if (value === undefined || value === null) return '';
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    });
  }

  primaryLlmKeyRequirement(userId) {
    return this.getByokKey(userId, ['openai', 'openrouter', 'xai']);
  }

  async orchestrate(payload = {}) {
    const userId = storage.sanitizeId(payload.userId || 'default');
    const task = String(payload.task || '').trim();
    if (!task) {
      throw new Error('Task is required.');
    }

    const byokLlm = await this.primaryLlmKeyRequirement(userId);
    if (!byokLlm) {
      const err = new Error('Missing BYOK LLM key. Add openai/openrouter/xai via POST /api/keys.');
      err.code = 'MISSING_BYOK_LLM_KEY';
      err.status = 428;
      throw err;
    }

    const traceId = String(payload.traceId || storage.genId('trace'));
    const startedAt = Date.now();

    const pipeline = storage.isPlainObject(payload.pipeline) ? payload.pipeline : {};
    const pipelineSteps = Array.isArray(pipeline.steps) ? pipeline.steps : [];

    const steps = pipelineSteps.length
      ? pipelineSteps.map((step, idx) => ({
        id: idx + 1,
        agent_slug: String(step.agent_slug || step.agentSlug || '').trim(),
        action_key: String(step.action_key || step.actionKey || '').trim(),
        action_props: storage.isPlainObject(step.action_props)
          ? step.action_props
          : (storage.isPlainObject(step.actionProps) ? step.actionProps : {}),
        format_guide: String(step.format_guide || step.formatGuide || '').trim()
      }))
      : this.routeAgentSlugs(task).map((slug, idx) => ({
        id: idx + 1,
        agent_slug: slug,
        action_key: '',
        action_props: {},
        format_guide: ''
      }));

    const mode = String(pipeline.mode || payload.mode || 'sequential').trim().toLowerCase() === 'parallel'
      ? 'parallel'
      : 'sequential';

    const results = [];

    if (mode === 'parallel') {
      const runAll = steps.map(async (step) => {
        const stepStart = Date.now();
        try {
          const interpolatedProps = this.interpolateValue(step.action_props, {
            prev: null,
            input: storage.isPlainObject(payload.input) ? payload.input : {}
          });
          const out = await this.executeAgentStep({ ...step, action_props: interpolatedProps }, {
            userId,
            traceId,
            task
          });
          return {
            ...out,
            ok: true,
            duration_ms: Date.now() - stepStart
          };
        } catch (error) {
          return {
            agent_slug: String(step.agent_slug || ''),
            tool_key: ACTION_TOOL_MAP[String(step.action_key || '').toLowerCase()] || String(step.action_key || ''),
            ok: false,
            duration_ms: Date.now() - stepStart,
            error: errorPayload(error)
          };
        }
      });
      const rows = await Promise.all(runAll);
      rows.forEach((row) => results.push(row));
    } else {
      let prevOutput = null;
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        const stepStart = Date.now();
        const props = this.interpolateValue(step.action_props, {
          prev: prevOutput,
          input: storage.isPlainObject(payload.input) ? payload.input : {}
        });
        try {
          // eslint-disable-next-line no-await-in-loop
          const out = await this.executeAgentStep({ ...step, action_props: props }, {
            userId,
            traceId,
            task
          });
          prevOutput = out.output;
          results.push({
            ...out,
            ok: true,
            duration_ms: Date.now() - stepStart
          });
        } catch (error) {
          results.push({
            agent_slug: String(step.agent_slug || ''),
            tool_key: ACTION_TOOL_MAP[String(step.action_key || '').toLowerCase()] || String(step.action_key || ''),
            ok: false,
            duration_ms: Date.now() - stepStart,
            error: errorPayload(error)
          });
          break;
        }
      }
    }

    const ok = results.every((row) => row.ok);
    const response = {
      ok,
      traceId,
      userId,
      mode,
      task,
      byok: {
        provider: byokLlm.service,
        keyMask: byokLlm.mask,
        source: 'user_vault'
      },
      plan: steps.map((step) => ({
        id: step.id,
        agent_slug: step.agent_slug,
        action_key: step.action_key,
        action_props: step.action_props,
        format_guide: step.format_guide
      })),
      results,
      duration_ms: Date.now() - startedAt,
      created_at: storage.nowIso()
    };

    this.appendLog({
      userId,
      traceId,
      event: 'orchestrate.completed',
      status: ok ? 'ok' : 'error',
      mode,
      durationMs: response.duration_ms,
      resultCount: results.length
    });

    await this.emitEvent({
      userId,
      eventName: 'orchestrate.completed',
      payload: {
        task,
        traceId,
        ok,
        results
      }
    });

    return response;
  }

  async runRecipe(payload = {}) {
    const userId = storage.sanitizeId(payload.userId || 'default');
    const slug = storage.sanitizeId(payload.slug || payload.recipe_slug || '');
    if (!slug) throw new Error('Recipe slug is required.');

    const recipe = await this.getRecipe(userId, slug);
    if (!recipe) {
      const error = new Error(`Recipe not found: ${slug}`);
      error.status = 404;
      error.code = 'RECIPE_NOT_FOUND';
      throw error;
    }

    const traceId = String(payload.traceId || storage.genId('recipe_trace'));
    const start = Date.now();

    const mode = String(recipe.mode || 'sequential').toLowerCase() === 'parallel' ? 'parallel' : 'sequential';
    const steps = Array.isArray(recipe.steps) ? recipe.steps : [];

    const results = [];

    if (mode === 'parallel') {
      const rows = await Promise.all(steps.map(async (step) => {
        const stepStart = Date.now();
        try {
          const props = this.interpolateValue(step.action_props, {
            prev: null,
            input: storage.isPlainObject(payload.input) ? payload.input : {}
          });
          const out = await this.executeAgentStep({ ...step, action_props: props }, {
            userId,
            task: `recipe:${slug}`,
            traceId
          });
          return {
            ...out,
            ok: true,
            duration_ms: Date.now() - stepStart
          };
        } catch (error) {
          return {
            agent_slug: String(step.agent_slug || ''),
            tool_key: ACTION_TOOL_MAP[String(step.action_key || '').toLowerCase()] || String(step.action_key || ''),
            ok: false,
            duration_ms: Date.now() - stepStart,
            error: errorPayload(error)
          };
        }
      }));
      rows.forEach((row) => results.push(row));
    } else {
      let prev = null;
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        const stepStart = Date.now();
        try {
          const props = this.interpolateValue(step.action_props, {
            prev,
            input: storage.isPlainObject(payload.input) ? payload.input : {}
          });
          // eslint-disable-next-line no-await-in-loop
          const out = await this.executeAgentStep({ ...step, action_props: props }, {
            userId,
            task: `recipe:${slug}`,
            traceId
          });
          prev = out.output;
          results.push({ ...out, ok: true, duration_ms: Date.now() - stepStart });
        } catch (error) {
          results.push({
            agent_slug: String(step.agent_slug || ''),
            tool_key: ACTION_TOOL_MAP[String(step.action_key || '').toLowerCase()] || String(step.action_key || ''),
            ok: false,
            duration_ms: Date.now() - stepStart,
            error: errorPayload(error)
          });
          break;
        }
      }
    }

    const ok = results.every((row) => row.ok);
    const output = {
      ok,
      traceId,
      userId,
      recipe_slug: slug,
      mode,
      steps: recipe.steps,
      results,
      duration_ms: Date.now() - start,
      created_at: storage.nowIso()
    };

    this.appendLog({
      userId,
      traceId,
      event: 'recipe.run',
      status: ok ? 'ok' : 'error',
      recipeSlug: slug,
      mode,
      durationMs: output.duration_ms,
      resultCount: results.length
    });

    await this.emitEvent({
      userId,
      eventName: 'recipe.completed',
      payload: {
        recipe_slug: slug,
        traceId,
        ok,
        results
      }
    });

    return output;
  }

  triggersDoc() {
    const doc = storage.readJson(this.triggersFile, { triggers: [] });
    return {
      triggers: Array.isArray(doc?.triggers) ? doc.triggers : []
    };
  }

  saveTriggersDoc(doc) {
    const safe = {
      triggers: Array.isArray(doc?.triggers) ? doc.triggers : []
    };
    storage.writeJsonAtomic(this.triggersFile, safe);
  }

  sanitizeTriggerOutput(trigger) {
    const row = storage.isPlainObject(trigger) ? trigger : {};
    const out = {
      id: String(row.id || ''),
      userId: String(row.userId || ''),
      name: String(row.name || ''),
      type: String(row.type || ''),
      recipe_slug: String(row.recipe_slug || ''),
      schedule: String(row.schedule || ''),
      event_name: String(row.event_name || ''),
      enabled: row.enabled !== false,
      createdAt: String(row.createdAt || ''),
      updatedAt: String(row.updatedAt || ''),
      lastRunAt: String(row.lastRunAt || ''),
      lastStatus: String(row.lastStatus || ''),
      lastError: String(row.lastError || '')
    };
    if (out.type === 'webhook') {
      out.webhook_token = String(row.webhook_token || '');
      out.webhook_path = `/api/triggers/webhook/${encodeURIComponent(out.webhook_token)}`;
    }
    return out;
  }

  async listTriggers(userId) {
    const safeUserId = storage.sanitizeId(userId);
    const doc = this.triggersDoc();
    return doc.triggers
      .filter((row) => String(row.userId || '') === safeUserId)
      .sort((a, b) => (String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1))
      .map((row) => this.sanitizeTriggerOutput(row));
  }

  async createTrigger(userId, payload = {}) {
    const safeUserId = storage.sanitizeId(userId);
    const type = String(payload.type || 'cron').trim().toLowerCase();
    if (!TRIGGER_TYPES.has(type)) {
      throw new Error('Trigger type must be cron, webhook, or event.');
    }

    const recipeSlug = storage.sanitizeId(payload.recipe_slug || payload.recipeSlug || payload.recipe || '');
    if (!recipeSlug) throw new Error('recipe_slug is required.');

    const recipe = await this.getRecipe(safeUserId, recipeSlug);
    if (!recipe) throw new Error(`Recipe not found: ${recipeSlug}`);

    const name = String(payload.name || `${type}:${recipeSlug}`).trim() || `${type}:${recipeSlug}`;
    const schedule = String(payload.schedule || '').trim();
    const eventName = String(payload.event_name || payload.eventName || '').trim();

    if (type === 'cron' && !schedule) {
      throw new Error('Cron trigger requires schedule expression (5-field cron).');
    }
    if (type === 'event' && !eventName) {
      throw new Error('Event trigger requires event_name.');
    }

    return this.withLock('triggers', async () => {
      const doc = this.triggersDoc();
      const now = storage.nowIso();
      const trigger = {
        id: storage.genId('trg'),
        userId: safeUserId,
        name,
        type,
        recipe_slug: recipeSlug,
        schedule,
        event_name: eventName,
        webhook_token: type === 'webhook' ? randomBytes(16).toString('hex') : '',
        enabled: payload.enabled !== false,
        createdAt: now,
        updatedAt: now,
        lastRunAt: '',
        lastStatus: '',
        lastError: ''
      };
      doc.triggers.push(trigger);
      this.saveTriggersDoc(doc);

      this.appendLog({
        userId: safeUserId,
        event: 'trigger.created',
        triggerId: trigger.id,
        type,
        recipeSlug,
        status: 'ok'
      });

      return this.sanitizeTriggerOutput(trigger);
    });
  }

  async deleteTrigger(userId, triggerId) {
    const safeUserId = storage.sanitizeId(userId);
    const id = String(triggerId || '').trim();
    if (!id) throw new Error('Missing trigger id.');

    return this.withLock('triggers', async () => {
      const doc = this.triggersDoc();
      const index = doc.triggers.findIndex((row) => String(row.id || '') === id && String(row.userId || '') === safeUserId);
      if (index < 0) return { deleted: false };
      doc.triggers.splice(index, 1);
      this.saveTriggersDoc(doc);
      this.appendLog({ userId: safeUserId, event: 'trigger.deleted', triggerId: id, status: 'ok' });
      return { deleted: true, id };
    });
  }

  cronFieldMatch(field, value, min, max) {
    const token = String(field || '').trim();
    if (!token || token === '*') return true;

    const checkSegment = (segment) => {
      const part = String(segment || '').trim();
      if (!part) return false;

      const everyMatch = part.match(/^\*\/(\d+)$/);
      if (everyMatch) {
        const step = Math.max(1, Number(everyMatch[1]) || 1);
        return ((value - min) % step) === 0;
      }

      const rangeStepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
      if (rangeStepMatch) {
        const start = Number(rangeStepMatch[1]);
        const end = Number(rangeStepMatch[2]);
        const step = Math.max(1, Number(rangeStepMatch[3]) || 1);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (value < start || value > end) return false;
        return ((value - start) % step) === 0;
      }

      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return value >= start && value <= end;
      }

      const exact = Number(part);
      if (!Number.isFinite(exact)) return false;
      return value === exact;
    };

    return token
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .some((segment) => checkSegment(segment));
  }

  cronMatches(schedule, date = new Date()) {
    const fields = String(schedule || '').trim().split(/\s+/).filter(Boolean);
    if (fields.length !== 5) return false;

    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const dow = date.getDay();

    return this.cronFieldMatch(fields[0], minute, 0, 59)
      && this.cronFieldMatch(fields[1], hour, 0, 23)
      && this.cronFieldMatch(fields[2], day, 1, 31)
      && this.cronFieldMatch(fields[3], month, 1, 12)
      && this.cronFieldMatch(fields[4], dow, 0, 6);
  }

  cronRunCacheKey(triggerId, date = new Date()) {
    const slot = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}`;
    return `${String(triggerId || '')}|${slot}`;
  }

  async updateTriggerRunState(triggerId, patch = {}) {
    const id = String(triggerId || '').trim();
    if (!id) return;

    await this.withLock('triggers', async () => {
      const doc = this.triggersDoc();
      const row = doc.triggers.find((item) => String(item.id || '') === id);
      if (!row) return;
      Object.assign(row, patch, { updatedAt: storage.nowIso() });
      this.saveTriggersDoc(doc);
    });
  }

  async fireTriggerById(userId, triggerId, payload = {}, reason = 'manual') {
    const safeUserId = storage.sanitizeId(userId);
    const id = String(triggerId || '').trim();
    if (!id) throw new Error('Missing trigger id.');

    const doc = this.triggersDoc();
    const row = doc.triggers.find((item) => String(item.id || '') === id && String(item.userId || '') === safeUserId);
    if (!row) {
      const notFound = new Error(`Trigger not found: ${id}`);
      notFound.status = 404;
      notFound.code = 'TRIGGER_NOT_FOUND';
      throw notFound;
    }

    const start = Date.now();
    try {
      const result = await this.runRecipe({
        userId: safeUserId,
        slug: row.recipe_slug,
        input: storage.isPlainObject(payload) ? payload : {},
        traceId: storage.genId('trigger_trace')
      });

      await this.updateTriggerRunState(id, {
        lastRunAt: storage.nowIso(),
        lastStatus: result.ok ? 'ok' : 'error',
        lastError: result.ok ? '' : 'One or more steps failed'
      });

      this.appendLog({
        userId: safeUserId,
        event: 'trigger.fired',
        triggerId: id,
        reason,
        status: result.ok ? 'ok' : 'error',
        durationMs: Date.now() - start,
        recipeSlug: row.recipe_slug
      });

      return {
        ok: result.ok,
        trigger: this.sanitizeTriggerOutput({ ...row, lastRunAt: storage.nowIso(), lastStatus: result.ok ? 'ok' : 'error' }),
        result,
        reason,
        duration_ms: Date.now() - start
      };
    } catch (error) {
      await this.updateTriggerRunState(id, {
        lastRunAt: storage.nowIso(),
        lastStatus: 'error',
        lastError: String(error?.message || error || '')
      });

      this.appendLog({
        userId: safeUserId,
        event: 'trigger.fired',
        triggerId: id,
        reason,
        status: 'error',
        durationMs: Date.now() - start,
        error: errorPayload(error)
      });

      throw error;
    }
  }

  async fireTriggerWebhook(token, payload = {}) {
    const key = String(token || '').trim();
    if (!key) {
      const error = new Error('Missing webhook token.');
      error.status = 400;
      throw error;
    }

    const doc = this.triggersDoc();
    const row = doc.triggers.find((item) => String(item.type || '') === 'webhook' && String(item.webhook_token || '') === key);
    if (!row) {
      const error = new Error('Unknown webhook token.');
      error.status = 404;
      error.code = 'TRIGGER_WEBHOOK_NOT_FOUND';
      throw error;
    }

    return this.fireTriggerById(row.userId, row.id, payload, 'webhook');
  }

  async emitEvent({ userId, eventName, payload }) {
    const safeUserId = storage.sanitizeId(userId);
    const event = String(eventName || '').trim();
    if (!event) return [];

    const doc = this.triggersDoc();
    const targets = doc.triggers.filter((row) => {
      if (String(row.userId || '') !== safeUserId) return false;
      if (String(row.type || '') !== 'event') return false;
      if (row.enabled === false) return false;
      return String(row.event_name || '') === event;
    });

    const out = [];
    for (let i = 0; i < targets.length; i += 1) {
      const trigger = targets[i];
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.fireTriggerById(safeUserId, trigger.id, payload, `event:${event}`);
        out.push({ triggerId: trigger.id, ok: true, result });
      } catch (error) {
        out.push({ triggerId: trigger.id, ok: false, error: errorPayload(error) });
      }
    }

    return out;
  }

  async runDueCronTriggers(nowDate = new Date()) {
    const doc = this.triggersDoc();
    const due = doc.triggers.filter((row) => {
      if (String(row.type || '') !== 'cron') return false;
      if (row.enabled === false) return false;
      return this.cronMatches(row.schedule, nowDate);
    });

    for (let i = 0; i < due.length; i += 1) {
      const trigger = due[i];
      const cacheKey = this.cronRunCacheKey(trigger.id, nowDate);
      if (this.cronRunCache.has(cacheKey)) continue;
      this.cronRunCache.set(cacheKey, true);
      // eslint-disable-next-line no-await-in-loop
      await this.fireTriggerById(trigger.userId, trigger.id, {}, 'cron').catch((error) => {
        this.appendLog({
          userId: trigger.userId,
          event: 'trigger.cron.error',
          triggerId: trigger.id,
          status: 'error',
          error: errorPayload(error)
        });
      });
    }

    if (this.cronRunCache.size > 4000) {
      const keys = Array.from(this.cronRunCache.keys()).slice(-2000);
      this.cronRunCache = new Map(keys.map((cacheKey) => [cacheKey, true]));
    }

    return {
      now: nowDate.toISOString(),
      checked: due.length
    };
  }

  appendLog(entry = {}) {
    const row = {
      timestamp: storage.nowIso(),
      level: String(entry.level || 'info'),
      userId: String(entry.userId || ''),
      traceId: String(entry.traceId || ''),
      event: String(entry.event || 'event'),
      status: String(entry.status || ''),
      service: String(entry.service || ''),
      toolKey: String(entry.toolKey || ''),
      agentSlug: String(entry.agentSlug || ''),
      triggerId: String(entry.triggerId || ''),
      recipeSlug: String(entry.recipeSlug || ''),
      durationMs: Number(entry.durationMs || 0) || 0,
      resultCount: Number(entry.resultCount || 0) || 0,
      mode: String(entry.mode || ''),
      reason: String(entry.reason || ''),
      keyId: String(entry.keyId || ''),
      error: entry.error || undefined,
      meta: storage.isPlainObject(entry.meta) ? entry.meta : undefined
    };

    const line = `${JSON.stringify(row)}\n`;
    fs.appendFileSync(this.logFile, line, 'utf8');
  }

  listLogs({ userId = '', limit = 80 } = {}) {
    const max = Math.max(1, Math.min(500, Number(limit || 80) || 80));
    if (!fs.existsSync(this.logFile)) return [];

    const raw = fs.readFileSync(this.logFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const row = JSON.parse(lines[i]);
        if (userId && String(row.userId || '') !== String(userId || '')) continue;
        out.push(row);
        if (out.length >= max) break;
      } catch {
        // ignore malformed line
      }
    }
    return out;
  }

  listCliCommandCatalog() {
    return [
      'auth',
      'marketing',
      'whatsapp',
      'ops',
      'hatch',
      'studio',
      'gateway',
      'agent',
      'accounts',
      'doctor'
    ];
  }

  restCatalog() {
    return {
      endpoints: [
        'POST /api/orchestrate',
        'POST /api/keys',
        'GET /api/keys',
        'DELETE /api/keys/:id',
        'POST /api/webchat/public/session/start',
        'POST /api/webchat/public/session/message',
        'GET /api/channels/webchat/widget-keys',
        'POST /api/channels/webchat/widget-keys',
        'DELETE /api/channels/webchat/widget-keys/:id',
        'GET /api/channels/webchat/sessions',
        'POST /api/channels/webchat/sessions',
        'GET /api/channels/webchat/sessions/:id/messages',
        'POST /api/channels/webchat/sessions/:id/reply',
        'POST /api/channels/webchat/sessions/:id/status',
        'GET /api/channels/baileys/sessions',
        'POST /api/channels/baileys/sessions',
        'POST /api/channels/baileys/sessions/:id/connect',
        'POST /api/channels/baileys/sessions/:id/disconnect',
        'POST /api/channels/baileys/sessions/:id/send',
        'GET /api/channels/baileys/sessions/:id/messages',
        'DELETE /api/channels/baileys/sessions/:id',
        'GET /api/agents',
        'POST /api/agents',
        'DELETE /api/agents/:slug',
        'GET /api/tools',
        'GET /api/recipes',
        'POST /api/recipes',
        'DELETE /api/recipes/:slug',
        'POST /api/recipes/:slug/run',
        'GET /api/triggers',
        'POST /api/triggers',
        'DELETE /api/triggers/:id',
        'POST /api/triggers/:id/run',
        'POST /api/triggers/webhook/:token',
        'GET /api/logs',
        'GET /api/usage',
        'GET /api/cli/commands',
        'POST /api/cli/execute'
      ]
    };
  }

  defaultHostedSummary() {
    return {
      toolName: TOOL_NAME,
      byokServices: this.servicesCatalog(),
      agents: BUILTIN_AGENTS.map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description,
        tools: row.tools
      })),
      toolActions: {
        meta_marketing: ['status', 'doctor', 'get_profile', 'list_ads', 'create_post'],
        whatsapp_cloud: ['send_whatsapp', 'logs'],
        web_browser: [
          'fetch_page',
          'list_sessions',
          'session_create',
          'goto',
          'click',
          'type',
          'press',
          'wait_for',
          'extract_text',
          'screenshot',
          'session_close'
        ],
        webchat_channel: ['create_widget_key', 'list_widget_keys', 'list_sessions', 'get_messages', 'reply', 'set_status'],
        baileys_channel: ['create_session', 'list_sessions', 'connect_session', 'disconnect_session', 'send_text', 'get_messages']
      },
      orchestrationModes: ['sequential', 'parallel'],
      triggerTypes: ['cron', 'webhook', 'event']
    };
  }
}

module.exports = {
  HostedPlatform,
  TOOL_NAME,
  TIER_2_PRICE_USD,
  SUPPORTED_BYOK_SERVICES,
  BUILTIN_AGENTS
};

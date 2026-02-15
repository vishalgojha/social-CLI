const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeJsonAtomic(filePath, data) {
  writeTextAtomic(filePath, JSON.stringify(data, null, 2));
}

function getHomeRoot() {
  if (process.env.SOCIAL_CLI_HOME) return path.resolve(process.env.SOCIAL_CLI_HOME);
  if (process.env.META_CLI_HOME) return path.resolve(process.env.META_CLI_HOME);
  return os.homedir();
}

function contextRoot() {
  return path.join(getHomeRoot(), '.social-cli', 'context');
}

function legacyContextRoot() {
  return path.join(getHomeRoot(), '.meta-cli', 'context');
}

function sanitizeScope(scope) {
  const s = String(scope || '').trim() || 'default';
  // Prevent path traversal: allow only a-zA-Z0-9._- and collapse others to _
  const safe = s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.length ? safe : 'default';
}

function scopeDir(scope) {
  return path.join(contextRoot(), sanitizeScope(scope));
}

function legacyScopeDir(scope) {
  return path.join(legacyContextRoot(), sanitizeScope(scope));
}

function scopeMemoryPath(scope) {
  return path.join(scopeDir(scope), 'memory.json');
}

function legacyScopeMemoryPath(scope) {
  return path.join(legacyScopeDir(scope), 'memory.json');
}

function scopeSummaryPath(scope) {
  return path.join(scopeDir(scope), 'summary.md');
}

function legacyScopeSummaryPath(scope) {
  return path.join(legacyScopeDir(scope), 'summary.md');
}

function detectScopeCandidates(intent, appId) {
  const text = String(intent || '');
  const out = [];

  const m1 = text.match(/\bfor\s+([a-zA-Z0-9._-]{2,64})\b/i);
  if (m1) out.push(m1[1]);

  const m2 = text.match(/\bclient\s*[:=]?\s*([a-zA-Z0-9._-]{2,64})\b/i);
  if (m2) out.push(m2[1]);

  const m3 = text.match(/\bapp[-\s]?([0-9]{4,})\b/i);
  if (m3) out.push(`app-${m3[1]}`);

  if (appId) out.push(`app-${appId}`);
  out.push('default');

  // Unique, preserve order.
  const seen = new Set();
  return out
    .map(sanitizeScope)
    .filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

function listScopes() {
  const names = new Set();
  [contextRoot(), legacyContextRoot()].forEach((root) => {
    if (!fs.existsSync(root)) return;
    try {
      fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .forEach((d) => names.add(d.name));
    } catch {
      // ignore root read errors
    }
  });
  return Array.from(names).sort();
}

function loadScopeSummary(scope) {
  const next = readText(scopeSummaryPath(scope));
  if (next) return next;
  return readText(legacyScopeSummaryPath(scope));
}

function loadScopeMemory(scope) {
  let mem = readJson(scopeMemoryPath(scope));
  if (!Array.isArray(mem)) mem = readJson(legacyScopeMemoryPath(scope));
  if (!Array.isArray(mem)) return [];
  return mem;
}

function redactSecretsDeep(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactSecretsDeep);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => {
      const lk = k.toLowerCase();
      if (lk.includes('token') || lk.includes('secret') || lk === 'authorization' || lk === 'access_token') {
        out[k] = '***redacted***';
      } else {
        out[k] = redactSecretsDeep(value[k]);
      }
    });
    return out;
  }
  if (typeof value === 'string') {
    // Heuristic: redact common Meta-style token prefix and long secrets.
    const s = value;
    if (/^EAAB/i.test(s) || s.length > 80) return '***redacted***';
    return s;
  }
  return value;
}

function buildSummaryMarkdown(memory) {
  const last = memory.slice(Math.max(0, memory.length - 25));
  const decisions = last.filter((e) => e.type === 'decision').slice(-5);
  const statuses = last.filter((e) => e.type === 'status').slice(-10);

  const lines = [];
  lines.push('# Agent Memory Summary');
  lines.push('');
  if (!memory.length) {
    lines.push('_No entries yet._');
    lines.push('');
    return lines.join('\n');
  }

  const latestTs = memory[memory.length - 1]?.timestamp || '';
  lines.push(`Last updated: ${latestTs}`);
  lines.push('');

  if (decisions.length) {
    lines.push('## Recent Decisions');
    decisions.forEach((d) => {
      const intent = d?.content?.intent || '';
      const risk = d?.content?.risk || '';
      lines.push(`- ${d.timestamp} (${risk}) ${String(intent).split('\n')[0]}`);
    });
    lines.push('');
  }

  if (statuses.length) {
    lines.push('## Recent Status');
    statuses.forEach((s) => {
      const ok = s?.content?.ok;
      const msg = s?.content?.run === 'complete'
        ? `run complete (ok=${ok})`
        : `step ${s?.content?.step || '?'} ${s?.content?.tool || ''} (ok=${ok})`;
      lines.push(`- ${s.timestamp} ${msg}`);
    });
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('- Memory never stores tokens/secrets (they are redacted).');
  lines.push('- This summary is generated from the last entries in memory.json.');
  lines.push('');
  return lines.join('\n');
}

async function appendScopeMemory(scope, entry) {
  const dir = scopeDir(scope);
  ensureDir(dir);

  const memPath = scopeMemoryPath(scope);
  const memory = loadScopeMemory(scope);
  const safeEntry = {
    timestamp: entry.timestamp || new Date().toISOString(),
    type: entry.type || 'status',
    content: redactSecretsDeep(entry.content)
  };

  memory.push(safeEntry);
  writeJsonAtomic(memPath, memory);

  // Update summary on every append.
  const summary = buildSummaryMarkdown(memory);
  writeTextAtomic(scopeSummaryPath(scope), summary);
}

async function forgetScope(scope) {
  [scopeDir(scope), legacyScopeDir(scope)].forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

async function clearAllScopes() {
  [contextRoot(), legacyContextRoot()].forEach((root) => {
    if (!fs.existsSync(root)) return;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function getMemoryStalenessDays(scope) {
  const mem = loadScopeMemory(scope);
  if (!mem.length) return null;
  const last = mem[mem.length - 1];
  const ts = Date.parse(last.timestamp);
  if (Number.isNaN(ts)) return null;
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return Math.floor(days);
}

module.exports = {
  contextRoot,
  sanitizeScope,
  scopeDir,
  detectScopeCandidates,
  listScopes,
  loadScopeSummary,
  loadScopeMemory,
  appendScopeMemory,
  forgetScope,
  clearAllScopes,
  getMemoryStalenessDays
};

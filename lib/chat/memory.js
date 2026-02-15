const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sanitizeSessionId(sessionId) {
  const raw = String(sessionId || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || '';
}

function generateSessionId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `chat_${stamp}_${rnd}`;
}

function getHomeRoot() {
  if (process.env.SOCIAL_CLI_HOME) return path.resolve(process.env.SOCIAL_CLI_HOME);
  if (process.env.META_CLI_HOME) return path.resolve(process.env.META_CLI_HOME);
  return os.homedir();
}

function chatRoot() {
  return path.join(getHomeRoot(), '.social-cli', 'chat', 'sessions');
}

function legacyChatRoot() {
  return path.join(getHomeRoot(), '.meta-cli', 'chat', 'sessions');
}

function sessionPath(sessionId) {
  return path.join(chatRoot(), `${sanitizeSessionId(sessionId)}.json`);
}

function legacySessionPath(sessionId) {
  return path.join(legacyChatRoot(), `${sanitizeSessionId(sessionId)}.json`);
}

class PersistentMemory {
  constructor(sessionId) {
    this.id = sanitizeSessionId(sessionId) || generateSessionId();
    this.filePath = sessionPath(this.id);
    this.legacyFilePath = legacySessionPath(this.id);
  }

  exists() {
    return fs.existsSync(this.filePath) || fs.existsSync(this.legacyFilePath);
  }

  load() {
    const current = readJson(this.filePath);
    if (current) return current;
    return readJson(this.legacyFilePath);
  }

  save(payload) {
    const data = {
      sessionId: this.id,
      updatedAt: new Date().toISOString(),
      ...payload
    };
    writeJsonAtomic(this.filePath, data);
  }

  static list(limit = 20) {
    const seen = new Map();
    [chatRoot(), legacyChatRoot()].forEach((root) => {
      if (!fs.existsSync(root)) return;
      fs.readdirSync(root)
        .filter((name) => name.endsWith('.json'))
        .forEach((name) => {
          const full = path.join(root, name);
          const stat = fs.statSync(full);
          const sessionId = name.slice(0, -5);
          const existing = seen.get(sessionId);
          const next = {
            sessionId,
            updatedAt: stat.mtime.toISOString(),
            filePath: full
          };
          if (!existing || Date.parse(next.updatedAt) > Date.parse(existing.updatedAt)) {
            seen.set(sessionId, next);
          }
        });
    });
    return Array.from(seen.values())
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }
}

module.exports = {
  PersistentMemory,
  generateSessionId,
  sanitizeSessionId
};

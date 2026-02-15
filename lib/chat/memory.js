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

function chatRoot() {
  const homeRoot = process.env.META_CLI_HOME ? path.resolve(process.env.META_CLI_HOME) : os.homedir();
  return path.join(homeRoot, '.meta-cli', 'chat', 'sessions');
}

function sessionPath(sessionId) {
  return path.join(chatRoot(), `${sanitizeSessionId(sessionId)}.json`);
}

class PersistentMemory {
  constructor(sessionId) {
    this.id = sanitizeSessionId(sessionId) || generateSessionId();
    this.filePath = sessionPath(this.id);
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  load() {
    return readJson(this.filePath);
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
    const root = chatRoot();
    if (!fs.existsSync(root)) return [];
    const files = fs.readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const full = path.join(root, name);
        const stat = fs.statSync(full);
        return {
          sessionId: name.slice(0, -5),
          updatedAt: stat.mtime.toISOString(),
          filePath: full
        };
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return files.slice(0, limit);
  }
}

module.exports = {
  PersistentMemory,
  generateSessionId,
  sanitizeSessionId
};

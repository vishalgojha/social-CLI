const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const storage = require('../hosted/storage');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isPlainObject(value) {
  return storage.isPlainObject(value);
}

class WebchatChannel {
  constructor(options = {}) {
    this.rootDir = storage.resolveVersionedDir('webchat', 'SOCIAL_WEBCHAT_DIR');
    this.sessionsFile = path.join(this.rootDir, 'sessions.json');
    this.widgetKeysFile = path.join(this.rootDir, 'widget-keys.json');
    this.messageDir = storage.ensureDir(path.join(this.rootDir, 'messages'));
    this.lockDir = storage.ensureDir(path.join(this.rootDir, 'locks'));

    this.emitEvent = typeof options.emitEvent === 'function' ? options.emitEvent : async () => [];
    this.log = typeof options.log === 'function' ? options.log : () => {};

    this.inboundBuckets = new Map();
    this.defaultInboundPerMinute = Math.max(5, toNumber(process.env.SOCIAL_WEBCHAT_INBOUND_PER_MINUTE, 60));
  }

  lockPath(name) {
    return path.join(this.lockDir, `${storage.sanitizeId(name, 'lock')}.lock`);
  }

  async withLock(name, fn, options = {}) {
    return storage.withFileLock(this.lockPath(name), fn, options);
  }

  sessionsDoc() {
    const doc = storage.readJson(this.sessionsFile, { sessions: [] });
    return {
      sessions: Array.isArray(doc?.sessions) ? doc.sessions : []
    };
  }

  saveSessionsDoc(doc) {
    storage.writeJsonAtomic(this.sessionsFile, {
      sessions: Array.isArray(doc?.sessions) ? doc.sessions : []
    });
  }

  widgetKeysDoc() {
    const doc = storage.readJson(this.widgetKeysFile, { keys: [] });
    return {
      keys: Array.isArray(doc?.keys) ? doc.keys : []
    };
  }

  saveWidgetKeysDoc(doc) {
    storage.writeJsonAtomic(this.widgetKeysFile, {
      keys: Array.isArray(doc?.keys) ? doc.keys : []
    });
  }

  sanitizeWidgetKey(row) {
    const item = isPlainObject(row) ? row : {};
    return {
      id: String(item.id || ''),
      userId: String(item.userId || ''),
      label: String(item.label || ''),
      keyMask: String(item.keyMask || ''),
      status: String(item.status || 'active'),
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
      lastUsedAt: String(item.lastUsedAt || '')
    };
  }

  sanitizeSession(row) {
    const session = isPlainObject(row) ? row : {};
    return {
      id: String(session.id || ''),
      userId: String(session.userId || ''),
      status: String(session.status || 'open'),
      channel: String(session.channel || 'webchat'),
      source: String(session.source || ''),
      visitorId: String(session.visitorId || ''),
      metadata: isPlainObject(session.metadata) ? session.metadata : {},
      messageCount: Number(session.messageCount || 0) || 0,
      unreadCount: Number(session.unreadCount || 0) || 0,
      lastMessagePreview: String(session.lastMessagePreview || ''),
      lastMessageDirection: String(session.lastMessageDirection || ''),
      lastInboundAt: String(session.lastInboundAt || ''),
      lastOutboundAt: String(session.lastOutboundAt || ''),
      createdAt: String(session.createdAt || ''),
      updatedAt: String(session.updatedAt || '')
    };
  }

  messageLogPath(userId, sessionId) {
    const user = storage.sanitizeId(userId || 'default');
    const sid = storage.sanitizeId(sessionId || 'session');
    const dir = storage.ensureDir(path.join(this.messageDir, user));
    return path.join(dir, `${sid}.jsonl`);
  }

  appendMessageLog({ userId, sessionId, entry }) {
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(this.messageLogPath(userId, sessionId), line, 'utf8');
  }

  listMessages({ userId, sessionId, limit = 200 }) {
    const filePath = this.messageLogPath(userId, sessionId);
    if (!fs.existsSync(filePath)) return [];
    const max = Math.max(1, Math.min(1000, Number(limit || 200) || 200));
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        out.push(JSON.parse(lines[i]));
        if (out.length >= max) break;
      } catch {
        // ignore malformed line
      }
    }
    return out.reverse();
  }

  createPublicSessionToken() {
    return randomBytes(20).toString('hex');
  }

  createWidgetKeySecret() {
    return `wk_${randomBytes(24).toString('hex')}`;
  }

  inboundRateKey(input) {
    const raw = String(input || '').trim();
    return raw || 'unknown';
  }

  enforceInboundRateLimit(inputKey) {
    const key = this.inboundRateKey(inputKey);
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = this.defaultInboundPerMinute;

    const existing = this.inboundBuckets.get(key);
    const bucket = (!existing || existing.resetAt <= now)
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    if (bucket.count >= limit) {
      const waitMs = Math.max(1000, bucket.resetAt - now);
      const error = new Error('Webchat inbound rate limit exceeded.');
      error.status = 429;
      error.code = 'WEBCHAT_RATE_LIMIT';
      error.retryAfterMs = waitMs;
      throw error;
    }

    bucket.count += 1;
    this.inboundBuckets.set(key, bucket);

    if (this.inboundBuckets.size > 5000) {
      for (const [bucketKey, row] of this.inboundBuckets.entries()) {
        if (!row || row.resetAt <= now) this.inboundBuckets.delete(bucketKey);
      }
    }
  }

  async createWidgetKey({ userId, label = '' }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const keyValue = this.createWidgetKeySecret();
    const keyHash = storage.sha256Hex(keyValue);
    const now = storage.nowIso();

    return this.withLock('webchat_widget_keys', async () => {
      const doc = this.widgetKeysDoc();
      const row = {
        id: storage.genId('wkey'),
        userId: safeUserId,
        label: String(label || '').trim(),
        keyHash,
        keyMask: storage.maskSecret(keyValue),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastUsedAt: ''
      };
      doc.keys.push(row);
      this.saveWidgetKeysDoc(doc);
      return {
        ...this.sanitizeWidgetKey(row),
        key: keyValue
      };
    });
  }

  async listWidgetKeys(userId) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const doc = this.widgetKeysDoc();
    return doc.keys
      .filter((row) => String(row.userId || '') === safeUserId)
      .sort((a, b) => (String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1))
      .map((row) => this.sanitizeWidgetKey(row));
  }

  async deleteWidgetKey({ userId, keyId }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const id = String(keyId || '').trim();
    if (!id) throw new Error('Missing widget key id.');

    return this.withLock('webchat_widget_keys', async () => {
      const doc = this.widgetKeysDoc();
      const index = doc.keys.findIndex((row) => String(row.id || '') === id && String(row.userId || '') === safeUserId);
      if (index < 0) return { deleted: false };
      doc.keys.splice(index, 1);
      this.saveWidgetKeysDoc(doc);
      return { deleted: true, id };
    });
  }

  async resolveUserByWidgetKey(rawKey) {
    const value = String(rawKey || '').trim();
    if (!value) return null;
    const hash = storage.sha256Hex(value);

    return this.withLock('webchat_widget_keys', async () => {
      const doc = this.widgetKeysDoc();
      const row = doc.keys.find((item) => String(item.keyHash || '') === hash && String(item.status || 'active') === 'active');
      if (!row) return null;
      row.lastUsedAt = storage.nowIso();
      row.updatedAt = storage.nowIso();
      this.saveWidgetKeysDoc(doc);
      return {
        userId: String(row.userId || ''),
        keyId: String(row.id || ''),
        label: String(row.label || '')
      };
    });
  }

  async createSession({ userId, visitorId = '', metadata = {}, source = 'internal' }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const now = storage.nowIso();
    const publicToken = this.createPublicSessionToken();
    const publicTokenHash = storage.sha256Hex(publicToken);

    const session = {
      id: storage.genId('wsess'),
      userId: safeUserId,
      status: 'open',
      channel: 'webchat',
      source: String(source || 'internal'),
      visitorId: String(visitorId || '').trim(),
      metadata: isPlainObject(metadata) ? metadata : {},
      messageCount: 0,
      unreadCount: 0,
      lastMessagePreview: '',
      lastMessageDirection: '',
      lastInboundAt: '',
      lastOutboundAt: '',
      publicTokenHash,
      publicTokenMask: storage.maskSecret(publicToken),
      createdAt: now,
      updatedAt: now
    };

    await this.withLock('webchat_sessions', async () => {
      const doc = this.sessionsDoc();
      doc.sessions.push(session);
      this.saveSessionsDoc(doc);
    });

    return {
      session: this.sanitizeSession(session),
      publicToken: publicToken,
      publicTokenMask: session.publicTokenMask
    };
  }

  async getSession(userId, sessionId) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const doc = this.sessionsDoc();
    const row = doc.sessions.find((item) => String(item.id || '') === sid && String(item.userId || '') === safeUserId);
    return row ? this.sanitizeSession(row) : null;
  }

  findSessionByToken(token) {
    const hash = storage.sha256Hex(String(token || '').trim());
    if (!hash) return null;
    const doc = this.sessionsDoc();
    return doc.sessions.find((row) => String(row.publicTokenHash || '') === hash) || null;
  }

  async listSessions(userId, options = {}) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100) || 100));
    const statusFilter = String(options.status || '').trim().toLowerCase();

    const doc = this.sessionsDoc();
    let rows = doc.sessions.filter((row) => String(row.userId || '') === safeUserId);
    if (statusFilter) rows = rows.filter((row) => String(row.status || '').toLowerCase() === statusFilter);

    rows.sort((a, b) => (String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1));
    return rows.slice(0, limit).map((row) => this.sanitizeSession(row));
  }

  async updateSessionInternal(sessionId, updater) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('Missing session id.');

    return this.withLock('webchat_sessions', async () => {
      const doc = this.sessionsDoc();
      const index = doc.sessions.findIndex((row) => String(row.id || '') === sid);
      if (index < 0) return null;

      const current = doc.sessions[index];
      const next = updater(current);
      if (!next) return null;

      doc.sessions[index] = {
        ...current,
        ...next,
        updatedAt: storage.nowIso()
      };
      this.saveSessionsDoc(doc);
      return doc.sessions[index];
    });
  }

  async appendInboundByToken({ sessionToken, text, metadata = {}, source = 'public' }) {
    const token = String(sessionToken || '').trim();
    const body = String(text || '').trim();
    if (!token) throw new Error('Missing session token.');
    if (!body) throw new Error('Message text is required.');

    this.enforceInboundRateLimit(token);

    const sessionRow = this.findSessionByToken(token);
    if (!sessionRow) {
      const error = new Error('Invalid session token.');
      error.status = 404;
      error.code = 'WEBCHAT_SESSION_NOT_FOUND';
      throw error;
    }

    if (String(sessionRow.status || '') === 'closed') {
      const error = new Error('Session is closed.');
      error.status = 409;
      error.code = 'WEBCHAT_SESSION_CLOSED';
      throw error;
    }

    const entry = {
      id: storage.genId('wmsg'),
      sessionId: String(sessionRow.id || ''),
      userId: String(sessionRow.userId || ''),
      direction: 'inbound',
      text: body,
      metadata: isPlainObject(metadata) ? metadata : {},
      source: String(source || 'public'),
      createdAt: storage.nowIso()
    };

    const updated = await this.updateSessionInternal(sessionRow.id, (current) => ({
      messageCount: Number(current.messageCount || 0) + 1,
      unreadCount: Number(current.unreadCount || 0) + 1,
      lastMessagePreview: body.slice(0, 220),
      lastMessageDirection: 'inbound',
      lastInboundAt: entry.createdAt
    }));

    this.appendMessageLog({ userId: sessionRow.userId, sessionId: sessionRow.id, entry });

    this.log({
      userId: sessionRow.userId,
      event: 'webchat.message.inbound',
      status: 'ok',
      meta: {
        sessionId: sessionRow.id,
        source: entry.source
      }
    });

    await this.emitEvent({
      userId: String(sessionRow.userId || ''),
      eventName: 'webchat.message.received',
      payload: {
        sessionId: String(sessionRow.id || ''),
        text: body,
        metadata: entry.metadata,
        source: entry.source
      }
    });

    return {
      session: this.sanitizeSession(updated || sessionRow),
      message: entry
    };
  }

  async appendOutbound({ userId, sessionId, text, metadata = {}, source = 'operator' }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const sid = String(sessionId || '').trim();
    const body = String(text || '').trim();

    if (!sid) throw new Error('Session id is required.');
    if (!body) throw new Error('Reply text is required.');

    const current = this.sessionsDoc().sessions.find((row) => String(row.id || '') === sid && String(row.userId || '') === safeUserId);
    if (!current) {
      const error = new Error('Session not found.');
      error.status = 404;
      throw error;
    }
    if (String(current.status || '') === 'closed') {
      const error = new Error('Session is closed.');
      error.status = 409;
      throw error;
    }

    const entry = {
      id: storage.genId('wmsg'),
      sessionId: sid,
      userId: safeUserId,
      direction: 'outbound',
      text: body,
      metadata: isPlainObject(metadata) ? metadata : {},
      source: String(source || 'operator'),
      createdAt: storage.nowIso()
    };

    const updated = await this.updateSessionInternal(sid, (row) => ({
      messageCount: Number(row.messageCount || 0) + 1,
      lastMessagePreview: body.slice(0, 220),
      lastMessageDirection: 'outbound',
      lastOutboundAt: entry.createdAt,
      unreadCount: Number(row.unreadCount || 0)
    }));

    this.appendMessageLog({ userId: safeUserId, sessionId: sid, entry });

    this.log({
      userId: safeUserId,
      event: 'webchat.message.outbound',
      status: 'ok',
      meta: {
        sessionId: sid,
        source: entry.source
      }
    });

    await this.emitEvent({
      userId: safeUserId,
      eventName: 'webchat.message.sent',
      payload: {
        sessionId: sid,
        text: body,
        metadata: entry.metadata,
        source: entry.source
      }
    });

    return {
      session: this.sanitizeSession(updated || current),
      message: entry
    };
  }

  async setSessionStatus({ userId, sessionId, status }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const sid = String(sessionId || '').trim();
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!sid) throw new Error('Session id is required.');
    if (!['open', 'closed'].includes(nextStatus)) {
      throw new Error('Session status must be open or closed.');
    }

    const updated = await this.updateSessionInternal(sid, (row) => {
      if (String(row.userId || '') !== safeUserId) return null;
      return { status: nextStatus };
    });

    if (!updated) {
      const error = new Error('Session not found.');
      error.status = 404;
      throw error;
    }

    this.log({
      userId: safeUserId,
      event: 'webchat.session.status',
      status: 'ok',
      meta: { sessionId: sid, nextStatus }
    });

    return this.sanitizeSession(updated);
  }

  async startPublicSession({ widgetKey, visitorId = '', metadata = {} }) {
    const resolved = await this.resolveUserByWidgetKey(widgetKey);
    if (!resolved) {
      const error = new Error('Invalid widget key.');
      error.status = 401;
      error.code = 'WEBCHAT_WIDGET_KEY_INVALID';
      throw error;
    }

    const created = await this.createSession({
      userId: resolved.userId,
      visitorId,
      metadata,
      source: 'public'
    });

    this.log({
      userId: resolved.userId,
      event: 'webchat.session.created',
      status: 'ok',
      meta: {
        sessionId: created.session.id,
        source: 'public',
        widgetKeyId: resolved.keyId
      }
    });

    await this.emitEvent({
      userId: resolved.userId,
      eventName: 'webchat.session.started',
      payload: {
        sessionId: created.session.id,
        visitorId: created.session.visitorId,
        metadata: created.session.metadata,
        source: 'public'
      }
    });

    return created;
  }
}

module.exports = {
  WebchatChannel
};

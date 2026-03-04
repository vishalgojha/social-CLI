const fs = require('fs');
const path = require('path');
const storage = require('../hosted/storage');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isPlainObject(value) {
  return storage.isPlainObject(value);
}

function noop() {}

class BaileysChannel {
  constructor(options = {}) {
    this.rootDir = storage.resolveVersionedDir('baileys', 'SOCIAL_BAILEYS_DIR');
    this.sessionsFile = path.join(this.rootDir, 'sessions.json');
    this.messageDir = storage.ensureDir(path.join(this.rootDir, 'messages'));
    this.authDir = storage.ensureDir(path.join(this.rootDir, 'auth'));
    this.lockDir = storage.ensureDir(path.join(this.rootDir, 'locks'));

    this.emitEvent = typeof options.emitEvent === 'function' ? options.emitEvent : async () => [];
    this.log = typeof options.log === 'function' ? options.log : noop;

    this.runtime = new Map();
    this.baileysModule = undefined;

    this.minReconnectDelayMs = Math.max(1000, toNumber(process.env.SOCIAL_BAILEYS_RECONNECT_MIN_MS, 3000));
    this.maxReconnectDelayMs = Math.max(this.minReconnectDelayMs, toNumber(process.env.SOCIAL_BAILEYS_RECONNECT_MAX_MS, 60000));
    this.circuitFailureThreshold = Math.max(2, toNumber(process.env.SOCIAL_BAILEYS_CIRCUIT_FAILS, 8));
    this.circuitCooldownMs = Math.max(30_000, toNumber(process.env.SOCIAL_BAILEYS_CIRCUIT_COOLDOWN_MS, 5 * 60 * 1000));
  }

  stop() {
    for (const sessionId of this.runtime.keys()) {
      this.disconnectRuntime(sessionId, false);
    }
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

  sanitizeSession(row) {
    const item = isPlainObject(row) ? row : {};
    return {
      id: String(item.id || ''),
      userId: String(item.userId || ''),
      label: String(item.label || ''),
      status: String(item.status || 'idle'),
      phone: String(item.phone || ''),
      metadata: isPlainObject(item.metadata) ? item.metadata : {},
      qr: String(item.qr || ''),
      qrUpdatedAt: String(item.qrUpdatedAt || ''),
      reconnectCount: Number(item.reconnectCount || 0) || 0,
      messageCount: Number(item.messageCount || 0) || 0,
      unreadCount: Number(item.unreadCount || 0) || 0,
      lastMessagePreview: String(item.lastMessagePreview || ''),
      lastMessageDirection: String(item.lastMessageDirection || ''),
      lastInboundAt: String(item.lastInboundAt || ''),
      lastOutboundAt: String(item.lastOutboundAt || ''),
      lastConnectedAt: String(item.lastConnectedAt || ''),
      lastDisconnectedAt: String(item.lastDisconnectedAt || ''),
      lastError: String(item.lastError || ''),
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || '')
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

  authStateDir(sessionId) {
    const sid = storage.sanitizeId(sessionId || 'session');
    return storage.ensureDir(path.join(this.authDir, sid));
  }

  runtimeFor(sessionId, create = true) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    if (!create) return this.runtime.get(sid) || null;
    if (!this.runtime.has(sid)) {
      this.runtime.set(sid, {
        socket: null,
        connectingPromise: null,
        reconnectTimer: null,
        reconnectDelayMs: this.minReconnectDelayMs,
        consecutiveFailures: 0,
        circuitOpenUntil: 0
      });
    }
    return this.runtime.get(sid);
  }

  cleanupRuntimeSocket(sessionId) {
    const runtime = this.runtimeFor(sessionId, false);
    if (!runtime) return;
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    if (runtime.socket) {
      try {
        if (typeof runtime.socket.end === 'function') runtime.socket.end();
      } catch {
        // ignore socket cleanup failures
      }
    }
    runtime.socket = null;
  }

  disconnectRuntime(sessionId, removeRuntime = true) {
    const sid = String(sessionId || '').trim();
    const runtime = this.runtimeFor(sid, false);
    if (!runtime) return;
    this.cleanupRuntimeSocket(sid);
    if (removeRuntime) this.runtime.delete(sid);
  }

  async updateSessionInternal(sessionId, updater) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('Missing session id.');

    return this.withLock('baileys_sessions', async () => {
      const doc = this.sessionsDoc();
      const idx = doc.sessions.findIndex((row) => String(row.id || '') === sid);
      if (idx < 0) return null;
      const current = doc.sessions[idx];
      const nextPatch = updater(current);
      if (!nextPatch) return null;
      doc.sessions[idx] = {
        ...current,
        ...nextPatch,
        updatedAt: storage.nowIso()
      };
      this.saveSessionsDoc(doc);
      return doc.sessions[idx];
    });
  }

  async resolveSessionForUser(userId, sessionId) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const sid = String(sessionId || '').trim();
    if (!sid) {
      const error = new Error('Session id is required.');
      error.status = 400;
      throw error;
    }
    const doc = this.sessionsDoc();
    const row = doc.sessions.find((item) => String(item.id || '') === sid && String(item.userId || '') === safeUserId);
    if (!row) {
      const error = new Error('Session not found.');
      error.status = 404;
      error.code = 'BAILEYS_SESSION_NOT_FOUND';
      throw error;
    }
    return row;
  }

  async createSession({ userId, label = '', phone = '', metadata = {} }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const now = storage.nowIso();
    const session = {
      id: storage.genId('bwsess'),
      userId: safeUserId,
      label: String(label || '').trim(),
      status: 'idle',
      phone: String(phone || '').trim(),
      metadata: isPlainObject(metadata) ? metadata : {},
      qr: '',
      qrUpdatedAt: '',
      reconnectCount: 0,
      messageCount: 0,
      unreadCount: 0,
      lastMessagePreview: '',
      lastMessageDirection: '',
      lastInboundAt: '',
      lastOutboundAt: '',
      lastConnectedAt: '',
      lastDisconnectedAt: '',
      lastError: '',
      createdAt: now,
      updatedAt: now
    };

    await this.withLock('baileys_sessions', async () => {
      const doc = this.sessionsDoc();
      doc.sessions.push(session);
      this.saveSessionsDoc(doc);
    });

    this.log({
      userId: safeUserId,
      event: 'baileys.session.created',
      status: 'ok',
      meta: { sessionId: session.id }
    });

    return this.sanitizeSession(session);
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

  async getSession(userId, sessionId) {
    const row = await this.resolveSessionForUser(userId, sessionId);
    return this.sanitizeSession(row);
  }

  async deleteSession({ userId, sessionId }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('Session id is required.');

    await this.disconnectSession({ userId: safeUserId, sessionId: sid }).catch(() => {});

    return this.withLock('baileys_sessions', async () => {
      const doc = this.sessionsDoc();
      const idx = doc.sessions.findIndex((row) => String(row.id || '') === sid && String(row.userId || '') === safeUserId);
      if (idx < 0) return { deleted: false };
      doc.sessions.splice(idx, 1);
      this.saveSessionsDoc(doc);

      try {
        fs.rmSync(this.messageLogPath(safeUserId, sid), { force: true });
      } catch {
        // ignore cleanup errors
      }
      try {
        fs.rmSync(this.authStateDir(sid), { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      this.disconnectRuntime(sid, true);

      this.log({
        userId: safeUserId,
        event: 'baileys.session.deleted',
        status: 'ok',
        meta: { sessionId: sid }
      });

      return { deleted: true, id: sid };
    });
  }

  async requireBaileys() {
    if (this.baileysModule !== undefined) return this.baileysModule;
    try {
      // eslint-disable-next-line global-require
      this.baileysModule = require('@whiskeysockets/baileys');
    } catch {
      this.baileysModule = null;
    }
    return this.baileysModule;
  }

  socketFactory(mod) {
    if (!mod) return null;
    if (typeof mod.default === 'function') return mod.default;
    if (typeof mod.makeWASocket === 'function') return mod.makeWASocket;
    return null;
  }

  parseDisconnect(update, mod) {
    const error = update?.lastDisconnect?.error;
    const statusCode = Number(error?.output?.statusCode || error?.output?.payload?.statusCode || 0) || 0;
    const loggedOutCode = Number(mod?.DisconnectReason?.loggedOut || 401) || 401;
    return {
      code: statusCode || String(error?.code || ''),
      message: String(error?.message || '').trim(),
      loggedOut: statusCode === loggedOutCode
    };
  }

  scheduleReconnect(userId, sessionId) {
    const runtime = this.runtimeFor(sessionId, true);
    if (!runtime) return;

    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    const now = Date.now();
    if (runtime.circuitOpenUntil && runtime.circuitOpenUntil > now) return;

    if (runtime.consecutiveFailures >= this.circuitFailureThreshold) {
      runtime.circuitOpenUntil = now + this.circuitCooldownMs;
      this.updateSessionInternal(sessionId, (row) => ({
        status: 'error',
        lastError: `Reconnect circuit open until ${new Date(runtime.circuitOpenUntil).toISOString()}`,
        reconnectCount: Number(row.reconnectCount || 0) + 1
      })).catch(() => {});
      return;
    }

    const jitter = Math.floor(Math.random() * 300);
    const delayMs = Math.min(this.maxReconnectDelayMs, runtime.reconnectDelayMs + jitter);
    runtime.reconnectDelayMs = Math.min(this.maxReconnectDelayMs, runtime.reconnectDelayMs * 2);
    runtime.reconnectTimer = setTimeout(() => {
      this.connectSession({ userId, sessionId, force: true }).catch((error) => {
        this.log({
          userId,
          event: 'baileys.session.reconnect.error',
          status: 'error',
          error: {
            code: String(error?.code || 'BAILEYS_RECONNECT_FAILED'),
            message: String(error?.message || 'Reconnect failed')
          },
          meta: { sessionId }
        });
      });
    }, delayMs);
    if (typeof runtime.reconnectTimer.unref === 'function') runtime.reconnectTimer.unref();
  }

  async connectSession({ userId, sessionId, force = false }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const row = await this.resolveSessionForUser(safeUserId, sessionId);
    const sid = String(row.id || '');

    const runtime = this.runtimeFor(sid, true);
    if (!runtime) {
      const error = new Error('Unable to initialize runtime.');
      error.status = 500;
      throw error;
    }

    if (runtime.connectingPromise) {
      await runtime.connectingPromise;
      const latest = await this.resolveSessionForUser(safeUserId, sid);
      return this.sanitizeSession(latest);
    }

    if (!force && runtime.circuitOpenUntil && runtime.circuitOpenUntil > Date.now()) {
      const error = new Error(`Reconnect circuit is open until ${new Date(runtime.circuitOpenUntil).toISOString()}`);
      error.status = 429;
      error.code = 'BAILEYS_CIRCUIT_OPEN';
      error.retryAfterMs = runtime.circuitOpenUntil - Date.now();
      throw error;
    }

    runtime.connectingPromise = (async () => {
      await this.updateSessionInternal(sid, () => ({
        status: 'connecting',
        lastError: ''
      }));

      const mod = await this.requireBaileys();
      const makeSocket = this.socketFactory(mod);
      const authStateFactory = mod && typeof mod.useMultiFileAuthState === 'function'
        ? mod.useMultiFileAuthState
        : null;

      if (!mod || !makeSocket || !authStateFactory) {
        const error = new Error('Baileys dependency is not installed. Install @whiskeysockets/baileys to enable WhatsApp Web sessions.');
        error.status = 503;
        error.code = 'BAILEYS_DEPENDENCY_MISSING';
        await this.updateSessionInternal(sid, () => ({
          status: 'unavailable',
          lastError: String(error.message || '')
        }));
        throw error;
      }

      const authDir = this.authStateDir(sid);
      const state = await authStateFactory(authDir);
      let version;
      if (typeof mod.fetchLatestBaileysVersion === 'function') {
        try {
          const ver = await mod.fetchLatestBaileysVersion();
          if (Array.isArray(ver?.version)) version = ver.version;
        } catch {
          // ignore version lookup failure
        }
      }

      const socket = makeSocket({
        auth: state.state,
        printQRInTerminal: false,
        browser: ['Social Flow', 'Chrome', '1.0'],
        version
      });

      runtime.socket = socket;
      runtime.reconnectDelayMs = this.minReconnectDelayMs;
      runtime.circuitOpenUntil = 0;

      socket.ev.on('creds.update', () => {
        Promise.resolve(state.saveCreds()).catch(() => {});
      });

      socket.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate({
          userId: safeUserId,
          sessionId: sid,
          update,
          mod
        }).catch((error) => {
          this.log({
            userId: safeUserId,
            event: 'baileys.connection.update.error',
            status: 'error',
            error: {
              code: String(error?.code || 'BAILEYS_CONN_UPDATE_FAILED'),
              message: String(error?.message || 'Connection update failed')
            },
            meta: { sessionId: sid }
          });
        });
      });

      socket.ev.on('messages.upsert', (payload) => {
        this.handleMessagesUpsert({
          userId: safeUserId,
          sessionId: sid,
          payload
        }).catch((error) => {
          this.log({
            userId: safeUserId,
            event: 'baileys.messages.upsert.error',
            status: 'error',
            error: {
              code: String(error?.code || 'BAILEYS_MESSAGE_UPSERT_FAILED'),
              message: String(error?.message || 'Failed to process inbound messages')
            },
            meta: { sessionId: sid }
          });
        });
      });
    })();

    try {
      await runtime.connectingPromise;
    } finally {
      runtime.connectingPromise = null;
    }

    const latest = await this.resolveSessionForUser(safeUserId, sid);
    return this.sanitizeSession(latest);
  }

  async handleConnectionUpdate({ userId, sessionId, update, mod }) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const runtime = this.runtimeFor(sid, true);
    if (!runtime) return;

    const connection = String(update?.connection || '').trim().toLowerCase();
    const qr = String(update?.qr || '').trim();

    if (qr) {
      await this.updateSessionInternal(sid, () => ({
        status: 'connecting',
        qr,
        qrUpdatedAt: storage.nowIso()
      }));
      this.log({
        userId,
        event: 'baileys.session.qr',
        status: 'ok',
        meta: { sessionId: sid }
      });
    }

    if (connection === 'open') {
      runtime.consecutiveFailures = 0;
      runtime.reconnectDelayMs = this.minReconnectDelayMs;
      runtime.circuitOpenUntil = 0;
      await this.updateSessionInternal(sid, () => ({
        status: 'connected',
        qr: '',
        qrUpdatedAt: '',
        lastConnectedAt: storage.nowIso(),
        lastError: ''
      }));
      this.log({
        userId,
        event: 'baileys.session.connected',
        status: 'ok',
        meta: { sessionId: sid }
      });
      await this.emitEvent({
        userId,
        eventName: 'baileys.session.connected',
        payload: { sessionId: sid }
      });
      return;
    }

    if (connection === 'close') {
      const details = this.parseDisconnect(update, mod);
      runtime.socket = null;
      runtime.consecutiveFailures += 1;

      await this.updateSessionInternal(sid, (row) => ({
        status: details.loggedOut ? 'logged_out' : 'disconnected',
        lastDisconnectedAt: storage.nowIso(),
        lastError: details.message || (details.code ? `Disconnected (${details.code})` : 'Disconnected'),
        reconnectCount: Number(row.reconnectCount || 0) + 1
      }));

      this.log({
        userId,
        event: 'baileys.session.disconnected',
        status: details.loggedOut ? 'warn' : 'error',
        meta: {
          sessionId: sid,
          code: details.code,
          loggedOut: details.loggedOut
        }
      });

      await this.emitEvent({
        userId,
        eventName: 'baileys.session.disconnected',
        payload: {
          sessionId: sid,
          code: details.code,
          message: details.message || '',
          loggedOut: details.loggedOut
        }
      });

      if (!details.loggedOut) {
        this.scheduleReconnect(userId, sid);
      }
    }
  }

  extractText(message) {
    if (!isPlainObject(message)) return '';
    if (typeof message.conversation === 'string') return message.conversation;
    if (typeof message.extendedTextMessage?.text === 'string') return message.extendedTextMessage.text;
    if (typeof message.imageMessage?.caption === 'string') return message.imageMessage.caption;
    if (typeof message.videoMessage?.caption === 'string') return message.videoMessage.caption;
    if (isPlainObject(message.ephemeralMessage?.message)) return this.extractText(message.ephemeralMessage.message);
    if (isPlainObject(message.viewOnceMessage?.message)) return this.extractText(message.viewOnceMessage.message);
    if (isPlainObject(message.documentWithCaptionMessage?.message)) return this.extractText(message.documentWithCaptionMessage.message);
    if (typeof message.protocolMessage?.type === 'number') return `[protocol:${message.protocolMessage.type}]`;
    return '';
  }

  async handleMessagesUpsert({ userId, sessionId, payload }) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (!messages.length) return;

    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      const text = this.extractText(msg?.message);
      const remoteJid = String(msg?.key?.remoteJid || '').trim();
      const participant = String(msg?.key?.participant || '').trim();
      const fromMe = msg?.key?.fromMe === true;
      const timestamp = Number(msg?.messageTimestamp || 0);
      const createdAt = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : storage.nowIso();

      const entry = {
        id: storage.genId('bmsg'),
        sessionId: sid,
        userId: storage.sanitizeId(userId || 'default'),
        direction: fromMe ? 'outbound' : 'inbound',
        text: text || '',
        from: fromMe ? 'me' : (participant || remoteJid),
        to: fromMe ? remoteJid : 'me',
        metadata: {
          remoteJid,
          participant,
          hasMedia: Boolean(
            msg?.message?.imageMessage
            || msg?.message?.videoMessage
            || msg?.message?.audioMessage
            || msg?.message?.documentMessage
          )
        },
        source: 'baileys',
        createdAt
      };

      this.appendMessageLog({ userId, sessionId: sid, entry });
      await this.updateSessionInternal(sid, (row) => ({
        messageCount: Number(row.messageCount || 0) + 1,
        unreadCount: Number(row.unreadCount || 0) + (fromMe ? 0 : 1),
        lastMessagePreview: String((text || `[${remoteJid || 'message'}]`).slice(0, 220)),
        lastMessageDirection: fromMe ? 'outbound' : 'inbound',
        lastInboundAt: fromMe ? String(row.lastInboundAt || '') : createdAt,
        lastOutboundAt: fromMe ? createdAt : String(row.lastOutboundAt || '')
      }));

      if (!fromMe) {
        await this.emitEvent({
          userId,
          eventName: 'baileys.message.received',
          payload: {
            sessionId: sid,
            from: entry.from,
            text: entry.text,
            metadata: entry.metadata
          }
        });
      }
    }
  }

  normalizeJid(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.includes('@')) return value;
    const digits = value.replace(/[^0-9]/g, '');
    if (!digits) return '';
    return `${digits}@s.whatsapp.net`;
  }

  async disconnectSession({ userId, sessionId, logout = false }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const row = await this.resolveSessionForUser(safeUserId, sessionId);
    const sid = String(row.id || '');
    const runtime = this.runtimeFor(sid, false);

    if (runtime && runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    if (runtime && runtime.socket) {
      try {
        if (logout && typeof runtime.socket.logout === 'function') {
          await runtime.socket.logout();
        }
      } catch {
        // ignore logout failures
      }
      try {
        if (typeof runtime.socket.end === 'function') runtime.socket.end();
      } catch {
        // ignore close errors
      }
      runtime.socket = null;
    }

    const updated = await this.updateSessionInternal(sid, (current) => ({
      status: logout ? 'logged_out' : 'disconnected',
      lastDisconnectedAt: storage.nowIso(),
      qr: '',
      qrUpdatedAt: '',
      lastError: String(current.lastError || '')
    }));

    this.log({
      userId: safeUserId,
      event: 'baileys.session.disconnected.manual',
      status: 'ok',
      meta: { sessionId: sid, logout: Boolean(logout) }
    });

    return this.sanitizeSession(updated || row);
  }

  async sendText({ userId, sessionId, to, text, metadata = {} }) {
    const safeUserId = storage.sanitizeId(userId || 'default');
    const row = await this.resolveSessionForUser(safeUserId, sessionId);
    const sid = String(row.id || '');
    const body = String(text || '').trim();
    if (!body) throw new Error('Message text is required.');

    const jid = this.normalizeJid(to || row.phone || '');
    if (!jid) {
      const error = new Error('Recipient is required. Provide `to` as phone number or jid.');
      error.status = 400;
      throw error;
    }

    const runtime = this.runtimeFor(sid, false);
    if (!runtime || !runtime.socket || String(row.status || '').toLowerCase() !== 'connected') {
      const error = new Error('Baileys session is not connected.');
      error.status = 409;
      error.code = 'BAILEYS_SESSION_NOT_CONNECTED';
      throw error;
    }

    const result = await runtime.socket.sendMessage(jid, { text: body });
    const entry = {
      id: storage.genId('bmsg'),
      sessionId: sid,
      userId: safeUserId,
      direction: 'outbound',
      text: body,
      from: 'me',
      to: jid,
      metadata: isPlainObject(metadata) ? metadata : {},
      source: 'baileys',
      providerMessageId: String(result?.key?.id || ''),
      createdAt: storage.nowIso()
    };

    this.appendMessageLog({ userId: safeUserId, sessionId: sid, entry });
    const updated = await this.updateSessionInternal(sid, (current) => ({
      messageCount: Number(current.messageCount || 0) + 1,
      lastMessagePreview: body.slice(0, 220),
      lastMessageDirection: 'outbound',
      lastOutboundAt: entry.createdAt
    }));

    this.log({
      userId: safeUserId,
      event: 'baileys.message.outbound',
      status: 'ok',
      meta: { sessionId: sid, to: jid }
    });

    await this.emitEvent({
      userId: safeUserId,
      eventName: 'baileys.message.sent',
      payload: {
        sessionId: sid,
        to: jid,
        text: body,
        providerMessageId: entry.providerMessageId
      }
    });

    return {
      session: this.sanitizeSession(updated || row),
      message: entry,
      provider: {
        id: entry.providerMessageId
      }
    };
  }
}

module.exports = {
  BaileysChannel
};

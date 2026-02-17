const intentsSchema = require('../ai/intents.json');

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(v) {
  return String(v || '').trim();
}

function affirmative(text) {
  const s = normalizeText(text).toLowerCase();
  return ['y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'do it', 'proceed', 'go ahead', 'sounds good'].includes(s);
}

function negative(text) {
  const s = normalizeText(text).toLowerCase();
  return ['n', 'no', 'nope', 'cancel', 'stop', 'not now'].includes(s);
}

function extractQuoted(text) {
  const m = normalizeText(text).match(/["']([^"']{2,300})["']/);
  return m ? m[1] : '';
}

function extractDateHint(text) {
  const raw = normalizeText(text).toLowerCase();
  if (raw.includes('tomorrow')) return 'tomorrow';
  if (raw.includes('today')) return 'today';
  if (raw.includes('next week')) return 'next week';
  const iso = raw.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return iso ? iso[0] : '';
}

function extractProductHint(text) {
  const raw = normalizeText(text);
  const quoted = extractQuoted(raw);
  if (quoted) return quoted;

  const m = raw.match(/\b(?:product|course|launch)\s+(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 '&._-]{1,120})/i);
  if (!m) return '';
  const candidate = m[1]
    .split(/\b(?:tomorrow|today|next week|on|for|and)\b/i)[0]
    .trim()
    .replace(/[,.!?]+$/, '');
  return candidate;
}

class ConversationContext {
  constructor(seed = {}) {
    this.messages = Array.isArray(seed.messages) ? seed.messages.slice(-200) : [];
    this.facts = seed.facts && typeof seed.facts === 'object' ? { ...seed.facts } : {};
    this.pendingActions = Array.isArray(seed.pendingActions) ? seed.pendingActions : [];
    this.executedActions = Array.isArray(seed.executedActions) ? seed.executedActions : [];
    this.lastResults = Array.isArray(seed.lastResults) ? seed.lastResults.slice(-50) : [];
    this.sessionMeta = seed.sessionMeta && typeof seed.sessionMeta === 'object'
      ? { ...seed.sessionMeta }
      : { createdAt: nowIso() };
    this.clarificationChoices = Array.isArray(seed.clarificationChoices)
      ? seed.clarificationChoices.slice(0, 10)
      : [];
  }

  toJSON() {
    return {
      messages: this.messages.slice(-200),
      facts: { ...this.facts },
      pendingActions: this.pendingActions.slice(-50),
      executedActions: this.executedActions.slice(-100),
      lastResults: this.lastResults.slice(-50),
      clarificationChoices: this.clarificationChoices.slice(0, 10),
      sessionMeta: { ...this.sessionMeta, updatedAt: nowIso() }
    };
  }

  addMessage(role, content) {
    const item = {
      role,
      content: normalizeText(content),
      timestamp: nowIso()
    };
    this.messages.push(item);
    if (role === 'user') {
      this.extractFacts(item.content);
    }
    if (this.messages.length > 200) this.messages = this.messages.slice(-200);
  }

  addResult(action, result) {
    const row = {
      action,
      result,
      timestamp: nowIso()
    };
    this.lastResults.push(row);
    this.executedActions.push({
      tool: action.tool || '',
      description: action.description || '',
      timestamp: row.timestamp,
      success: Boolean(result && result.success !== false)
    });
    this.pendingActions = [];
    this.clarificationChoices = [];
    if (this.lastResults.length > 50) this.lastResults = this.lastResults.slice(-50);
    if (this.executedActions.length > 100) this.executedActions = this.executedActions.slice(-100);
  }

  addError(action, error) {
    this.lastResults.push({
      action,
      error: String(error?.message || error || ''),
      timestamp: nowIso()
    });
    if (this.lastResults.length > 50) this.lastResults = this.lastResults.slice(-50);
  }

  setClarificationChoices(choices) {
    this.clarificationChoices = Array.isArray(choices)
      ? choices
        .map((x) => ({
          label: normalizeText(x?.label),
          prompt: normalizeText(x?.prompt)
        }))
        .filter((x) => x.label && x.prompt)
        .slice(0, 10)
      : [];
  }

  clearClarificationChoices() {
    this.clarificationChoices = [];
  }

  hasClarificationChoices() {
    return this.clarificationChoices.length > 0;
  }

  resolveClarificationChoice(userInput) {
    const raw = normalizeText(userInput);
    if (!raw || !this.clarificationChoices.length) return null;

    const idx = Number.parseInt(raw, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= this.clarificationChoices.length) {
      const choice = this.clarificationChoices[idx - 1];
      return { ...choice, index: idx };
    }

    const lower = raw.toLowerCase();
    const direct = this.clarificationChoices.findIndex((x) =>
      x.label.toLowerCase() === lower || x.prompt.toLowerCase() === lower
    );
    if (direct >= 0) {
      const choice = this.clarificationChoices[direct];
      return { ...choice, index: direct + 1 };
    }
    return null;
  }

  setPendingActions(actions) {
    this.pendingActions = Array.isArray(actions) ? actions : [];
  }

  clearPendingActions() {
    this.pendingActions = [];
  }

  setActiveSpecialist(id, name = '') {
    const roleId = normalizeText(id) || 'router';
    this.sessionMeta.activeSpecialist = roleId;
    this.sessionMeta.activeSpecialistName = normalizeText(name) || roleId;
    const existing = Array.isArray(this.sessionMeta.specialistsSeen)
      ? this.sessionMeta.specialistsSeen
      : [];
    if (!existing.includes(roleId)) {
      this.sessionMeta.specialistsSeen = [...existing, roleId].slice(-20);
    } else {
      this.sessionMeta.specialistsSeen = existing.slice(-20);
    }
    this.sessionMeta.updatedAt = nowIso();
  }

  extractFacts(content) {
    const text = normalizeText(content);
    if (!text) return;

    const lower = text.toLowerCase();
    const product = extractProductHint(text);
    const dateHint = extractDateHint(text);
    const quoted = extractQuoted(text);

    if (product) this.facts.productName = product;
    if (dateHint) this.facts.launchDateHint = dateHint;

    if (lower.includes('facebook')) this.facts.channels = Array.from(new Set([...(this.facts.channels || []), 'facebook']));
    if (lower.includes('instagram')) this.facts.channels = Array.from(new Set([...(this.facts.channels || []), 'instagram']));
    if (lower.includes('whatsapp')) this.facts.channels = Array.from(new Set([...(this.facts.channels || []), 'whatsapp']));
    if (lower.includes('all channels') || lower.match(/\ball\b/)) {
      this.facts.channels = ['facebook', 'instagram', 'whatsapp'];
    }

    if (quoted && (lower.includes('post') || lower.includes('caption') || lower.includes('message'))) {
      this.facts.lastCopy = quoted;
    }
  }

  getLatestUserMessage() {
    const last = [...this.messages].reverse().find((m) => m.role === 'user');
    return last ? last.content : '';
  }

  getHistory(limit = 20) {
    return this.messages.slice(-limit);
  }

  getSummary() {
    return {
      facts: { ...this.facts },
      pendingActions: this.pendingActions.length,
      executedActions: this.executedActions.length,
      recentTools: this.executedActions.slice(-5).map((x) => x.tool),
      activeSpecialist: this.sessionMeta.activeSpecialist || 'router',
      specialistsSeen: Array.isArray(this.sessionMeta.specialistsSeen)
        ? this.sessionMeta.specialistsSeen.slice(-10)
        : []
    };
  }

  hasPendingActions() {
    return this.pendingActions.length > 0;
  }

  userConfirmedLatest(userInput) {
    return affirmative(userInput);
  }

  userRejectedLatest(userInput) {
    return negative(userInput);
  }

  riskForAction(action) {
    const tool = String(action?.tool || '');
    return intentsSchema[tool]?.risk || 'low';
  }
}

module.exports = {
  ConversationContext,
  affirmative,
  negative
};

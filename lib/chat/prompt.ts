const fs = require('fs');
const path = require('path');
const intentsSchema = require('../ai/intents.json');

function toolDescriptions() {
  return Object.entries(intentsSchema).map(([name, v]) => ({
    name,
    risk: v.risk || 'low',
    required: Array.isArray(v.required) ? v.required : [],
    optional: Array.isArray(v.optional) ? v.optional : [],
    description: v.description || ''
  }));
}

let cachedIdentity = null;
const cachedSpecialistIdentities = new Map();

function readTextIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return String(fs.readFileSync(filePath, 'utf8') || '').trim();
  } catch {
    return '';
  }
}

function repoRootCandidates() {
  return [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..')
  ];
}

function loadAgentIdentity() {
  if (cachedIdentity !== null) return cachedIdentity;
  const candidates = repoRootCandidates().flatMap((root) => ([
    path.join(root, 'IDENTITY.md'),
    path.join(root, 'soul.md')
  ]));
  for (const candidate of candidates) {
    const text = readTextIfPresent(candidate);
    if (text) {
      cachedIdentity = text;
      return cachedIdentity;
    }
  }
  cachedIdentity = '';
  return cachedIdentity;
}

function loadSpecialistIdentity(specialistId) {
  const id = String(specialistId || '').trim().toLowerCase();
  if (!id) return '';
  if (cachedSpecialistIdentities.has(id)) return cachedSpecialistIdentities.get(id);
  const candidates = repoRootCandidates().map((root) => path.join(root, 'identities', `${id}.md`));
  for (const candidate of candidates) {
    const text = readTextIfPresent(candidate);
    if (text) {
      cachedSpecialistIdentities.set(id, text);
      return text;
    }
  }
  cachedSpecialistIdentities.set(id, '');
  return '';
}

function systemPrompt(options = {}) {
  const promptParts = [
    'You are Meta AI Agent for Facebook, Instagram, WhatsApp, and Marketing APIs.',
    'Be conversational, practical, and clear.',
    'You must ask clarifying questions when required fields are missing.',
    'For high-risk actions (posting, messaging, campaign creation), propose actions and wait for user confirmation.',
    'Use the available tools list and session context.',
    'Return ONLY JSON.',
    '',
    'JSON schema:',
    '{',
    '  "message": "string",',
    '  "actions": [',
    '    {',
    '      "tool": "one of available tool names",',
    '      "params": { "any": "json object" },',
    '      "description": "short user-facing progress line"',
    '    }',
    '  ],',
    '  "mode": "template|extract|clarify|generate",',
    '  "needsInput": true|false,',
    '  "suggestions": ["optional follow-up suggestion strings"]',
    '}'
  ];
  const identity = loadAgentIdentity();
  if (identity) {
    promptParts.push('', 'AGENT IDENTITY:', identity);
  }
  const specialistId = String(options.specialistId || '').trim().toLowerCase();
  const specialistName = String(options.specialistName || specialistId || '').trim();
  const specialistIdentity = loadSpecialistIdentity(specialistId);
  if (specialistIdentity) {
    promptParts.push(
      '',
      `ACTIVE SPECIALIST: ${specialistName || specialistId}`,
      specialistIdentity
    );
  }
  return promptParts.join('\n');
}

function buildUserPrompt({ summary, history, latest }) {
  return [
    `CONTEXT SUMMARY:\n${JSON.stringify(summary || {}, null, 2)}`,
    '',
    `HISTORY:\n${JSON.stringify(history || [], null, 2)}`,
    '',
    `LATEST USER MESSAGE:\n${JSON.stringify(latest || '')}`
  ].join('\n');
}

function parseJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

module.exports = {
  toolDescriptions,
  loadAgentIdentity,
  loadSpecialistIdentity,
  systemPrompt,
  buildUserPrompt,
  parseJsonPayload
};

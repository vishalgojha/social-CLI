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

function systemPrompt() {
  return [
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
    '  "needsInput": true|false,',
    '  "suggestions": ["optional follow-up suggestion strings"]',
    '}'
  ].join('\n');
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
  systemPrompt,
  buildUserPrompt,
  parseJsonPayload
};

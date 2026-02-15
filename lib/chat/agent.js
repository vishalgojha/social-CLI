const axios = require('axios');
const intentsSchema = require('../ai/intents.json');
const { aiParseIntent } = require('../ai/parser');
const { validateIntent } = require('../ai/validator');
const { executeIntent } = require('../ai/executor');
const { toolDescriptions, systemPrompt, buildUserPrompt, parseJsonPayload } = require('./prompt');

function hasLlmKey() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.META_AI_KEY);
}

function isSmallTalk(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return true;
  return ['hi', 'hello', 'hey', 'thanks', 'thank you', 'cool', 'great', 'awesome'].includes(s);
}

function deriveSuggestionForAction(action) {
  if (action === 'post_facebook' || action === 'post_instagram') {
    return 'Want me to create a follow-up analytics check for tomorrow?';
  }
  if (action === 'post_whatsapp') {
    return 'Need me to prepare a follow-up template message too?';
  }
  if (action === 'query_insights' || action === 'get_analytics') {
    return 'I can also break this down by campaign status if you want.';
  }
  return 'I can keep going if you want another action.';
}

function uniq(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach((x) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function highRisk(actions) {
  return (actions || []).some((a) => intentsSchema[a.tool]?.risk === 'high');
}

function defaultMessageForIntent(intent) {
  const action = intent.action;
  if (action === 'post_facebook') return 'I can post that to Facebook. Review this plan and confirm when ready.';
  if (action === 'post_instagram') return 'I can publish that to Instagram. Review and confirm to proceed.';
  if (action === 'post_whatsapp') return 'I can send that WhatsApp message. Confirm and I will execute it.';
  if (action === 'query_pages') return 'I can fetch your Facebook pages now.';
  if (action === 'query_me') return 'I can fetch your profile now.';
  if (action === 'query_insights' || action === 'get_analytics') return 'I can pull your ad analytics now.';
  if (action === 'list_campaigns') return 'I can list your campaigns now.';
  if (action === 'check_limits') return 'I can check your current rate limit status now.';
  if (action === 'schedule_post') return 'I can schedule that post. Confirm to continue.';
  if (action === 'create_campaign') return 'I can create this campaign. Confirm to proceed.';
  return 'I can do that. Confirm and I will proceed.';
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => ({
      tool: String(a?.tool || '').trim(),
      params: a?.params && typeof a.params === 'object' ? a.params : {},
      description: String(a?.description || '').trim() || `Run ${String(a?.tool || '')}`
    }))
    .filter((a) => a.tool && intentsSchema[a.tool]);
}

class AutonomousAgent {
  constructor({ context, config, options }) {
    this.context = context;
    this.config = config;
    this.options = options || {};
    this.tools = toolDescriptions();
  }

  async process(userInput) {
    this.context.addMessage('user', userInput);

    if (this.context.hasPendingActions()) {
      if (this.context.userConfirmedLatest(userInput)) {
        const pending = this.context.pendingActions.slice();
        this.context.clearPendingActions();
        const msg = pending.length > 1
          ? `Perfect. I'll execute ${pending.length} actions now.`
          : 'Perfect. I will execute that now.';
        this.context.addMessage('agent', msg);
        return { message: msg, actions: pending, needsInput: false, suggestions: this.proactiveSuggestionsFromContext() };
      }
      if (this.context.userRejectedLatest(userInput)) {
        this.context.clearPendingActions();
        const msg = 'No problem. Tell me what to change and I will adjust the plan.';
        this.context.addMessage('agent', msg);
        return { message: msg, actions: [], needsInput: true, suggestions: this.proactiveSuggestionsFromContext() };
      }
    }

    if (isSmallTalk(userInput)) {
      const msg = 'I can help with posts, scheduling, WhatsApp messaging, analytics, and campaigns. What do you want to do?';
      this.context.addMessage('agent', msg);
      return { message: msg, actions: [], needsInput: true, suggestions: this.proactiveSuggestionsFromContext() };
    }

    let decision = null;
    if (hasLlmKey()) {
      decision = await this.tryLlmDecision();
    }

    if (!decision) {
      decision = await this.heuristicDecision(userInput);
    }

    if (decision.actions.length > 0) {
      this.context.setPendingActions(decision.actions);
      if (highRisk(decision.actions)) {
        decision.message = `${decision.message}\n\nThis is a high-risk action. Reply "yes" to execute or "no" to cancel.`;
        decision.needsInput = true;
      } else {
        decision.message = `${decision.message}\n\nReply "yes" to execute now, or tell me what to change.`;
        decision.needsInput = true;
      }
    }

    decision.suggestions = uniq([...(decision.suggestions || []), ...this.proactiveSuggestionsFromContext()]);
    this.context.addMessage('agent', decision.message);
    return decision;
  }

  proactiveSuggestionsFromContext() {
    const suggestions = [];
    const summary = this.context.getSummary();
    const facts = summary?.facts || {};
    const recentTools = summary?.recentTools || [];
    const channels = Array.isArray(facts.channels) ? facts.channels : [];

    if (facts.launchDateHint && (channels.includes('facebook') || channels.includes('instagram'))) {
      if (!recentTools.includes('schedule_post')) {
        suggestions.push(`Want me to schedule all launch posts for ${facts.launchDateHint} at 10:00 AM?`);
      }
    }

    if (channels.includes('whatsapp') && !recentTools.includes('post_whatsapp')) {
      suggestions.push('Need me to prepare a WhatsApp broadcast version too?');
    }

    if (recentTools.includes('post_facebook') || recentTools.includes('post_instagram')) {
      suggestions.push('Want me to set a reminder to check engagement in 1 hour?');
    }

    if (recentTools.includes('query_insights') || recentTools.includes('get_analytics')) {
      suggestions.push('I can break analytics down by campaign status or date if helpful.');
    }

    return uniq(suggestions).slice(0, 3);
  }

  async tryLlmDecision() {
    try {
      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const model = process.env.META_CHAT_MODEL || process.env.META_AI_MODEL || 'gpt-4o-mini';
      const key = process.env.OPENAI_API_KEY || process.env.META_AI_KEY;

      const userPrompt = buildUserPrompt({
        summary: this.context.getSummary(),
        history: this.context.getHistory(16),
        latest: this.context.getLatestUserMessage()
      });

      const res = await axios.post(`${base}/chat/completions`, {
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${systemPrompt()}\n\nTOOLS:\n${JSON.stringify(this.tools, null, 2)}` },
          { role: 'user', content: userPrompt }
        ]
      }, {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 4000
      });

      const text = res?.data?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonPayload(text);
      if (!parsed || typeof parsed !== 'object') return null;

      return {
        message: String(parsed.message || '').trim() || 'I drafted a plan for you.',
        actions: normalizeActions(parsed.actions),
        needsInput: Boolean(parsed.needsInput),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : []
      };
    } catch {
      return null;
    }
  }

  async heuristicDecision(userInput) {
    const intent = await aiParseIntent(userInput, { debug: Boolean(this.options.debug) });
    const validation = await validateIntent(intent, this.config);

    if (!validation.valid) {
      const question = validation.suggestions[0] || 'I need a bit more detail before I can execute that.';
      return {
        message: question,
        actions: [],
        needsInput: true,
        suggestions: validation.suggestions.slice(1, 3)
      };
    }

    const action = {
      tool: intent.action,
      params: intent,
      description: defaultMessageForIntent(intent)
    };

    return {
      message: defaultMessageForIntent(intent),
      actions: [action],
      needsInput: true,
      suggestions: [deriveSuggestionForAction(intent.action)]
    };
  }

  async execute(action) {
    const params = action?.params && typeof action.params === 'object' ? action.params : {};
    const result = await executeIntent(params, this.config);
    if (!result.success) {
      throw new Error(result.error || 'Action failed.');
    }
    return {
      success: true,
      summary: this.summaryFromResult(action, result),
      raw: result,
      suggestions: this.postExecutionSuggestions(action, result)
    };
  }

  postExecutionSuggestions(action, result) {
    const suggestions = [];
    const tool = action?.tool;
    if (tool === 'post_facebook' || tool === 'post_instagram') {
      suggestions.push('Want me to generate a channel-specific follow-up post?');
      suggestions.push('I can check engagement stats later today.');
    }
    if (tool === 'post_whatsapp') {
      suggestions.push('Need me to draft a follow-up WhatsApp message for non-responders?');
    }
    if (tool === 'check_limits') {
      const usage = result?.data?.usage || {};
      const hot = Number(usage.call_count) > 70 || Number(usage.total_time) > 70 || Number(usage.total_cputime) > 70;
      if (hot) {
        suggestions.push('Rate usage looks high. Want me to switch to lower-frequency querying?');
      } else {
        suggestions.push('Rate usage is healthy. Want me to continue with analytics pulls?');
      }
    }
    if (tool === 'query_insights' || tool === 'get_analytics') {
      suggestions.push('I can export this report or fetch campaign-level details next.');
    }
    if (tool === 'list_campaigns') {
      suggestions.push('Need me to filter these by ACTIVE status only?');
    }
    return uniq(suggestions).slice(0, 3);
  }

  summaryFromResult(action, result) {
    const tool = action.tool;
    if (tool === 'post_facebook') return 'Posted to Facebook successfully.';
    if (tool === 'post_instagram') return 'Published to Instagram successfully.';
    if (tool === 'post_whatsapp') return 'Sent WhatsApp message successfully.';
    if (tool === 'query_pages') return `Fetched ${(result.data?.data || []).length} Facebook pages.`;
    if (tool === 'query_me') return 'Fetched profile information.';
    if (tool === 'query_insights' || tool === 'get_analytics') return `Fetched ${(result.data?.rows || []).length} analytics rows.`;
    if (tool === 'list_campaigns') return `Fetched ${(result.data || []).length} campaigns.`;
    if (tool === 'check_limits') return 'Fetched current rate-limit headers.';
    if (tool === 'schedule_post') return 'Scheduled post successfully.';
    if (tool === 'create_campaign') return 'Campaign created successfully.';
    return `${tool} completed.`;
  }
}

module.exports = {
  AutonomousAgent
};

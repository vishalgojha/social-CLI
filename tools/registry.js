const MetaAPIClient = require('../lib/api-client');
const { MetaApiClient } = require('../lib/api');
const marketing = require('../lib/marketing');

function safeInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function getTokenFromConfigOrThrow(config, api) {
  const token = config.getToken(api);
  if (!token) throw new Error(`No ${api} token configured. Run: meta auth login -a ${api}`);
  return token;
}

function getAppAccessTokenOrThrow(config) {
  const { appId, appSecret } = config.getAppCredentials();
  if (!appId || !appSecret) throw new Error('Missing app credentials. Run: meta auth app');
  // App access token format for debug_token and some app endpoints.
  return `${appId}|${appSecret}`;
}

function validatePlanSteps(steps, toolsByName) {
  const valid = [];
  const invalid = [];
  (steps || []).forEach((s) => {
    if (toolsByName[s.tool]) valid.push(s);
    else invalid.push(s);
  });
  return { valid, invalid };
}

function getToolRegistry() {
  return [
    {
      name: 'auth.status',
      description: 'Show which tokens/defaults/app credentials are configured (no API calls).',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config }) => {
        const app = config.getAppCredentials();
        return {
          apiVersion: config.getApiVersion(),
          defaultApi: config.getDefaultApi(),
          tokens: {
            facebook: Boolean(config.getToken('facebook')),
            instagram: Boolean(config.getToken('instagram')),
            whatsapp: Boolean(config.getToken('whatsapp'))
          },
          app: {
            id: app.appId ? String(app.appId) : '',
            secretConfigured: Boolean(app.appSecret)
          },
          defaults: {
            facebookPageId: config.getDefaultFacebookPageId(),
            igUserId: config.getDefaultIgUserId(),
            whatsappPhoneNumberId: config.getDefaultWhatsAppPhoneNumberId()
          }
        };
      }
    },
    {
      name: 'auth.debugToken',
      description: 'Debug a token via /debug_token (requires app id/secret). Args: { token: "<TOKEN>" }',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const inputToken = String(args?.token || '').trim();
        if (!inputToken) throw new Error('Missing args.token');
        const appAccessToken = getAppAccessTokenOrThrow(config);

        const client = new MetaAPIClient(appAccessToken, 'facebook', { apiVersion: config.getApiVersion(), config });
        const data = await client.get('/debug_token', { input_token: inputToken }, { verbose: Boolean(options.verbose) });

        // Return only safe fields.
        const d = data?.data || {};
        return sanitizeForLog({
          app_id: d.app_id,
          type: d.type,
          application: d.application,
          expires_at: d.expires_at,
          is_valid: d.is_valid,
          scopes: d.scopes,
          user_id: d.user_id
        });
      }
    },
    {
      name: 'query.me',
      description: 'Fetch /me. Args: { api: "facebook|instagram|whatsapp", fields: "id,name" }',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const api = String(args?.api || config.getDefaultApi() || 'facebook');
        const fields = String(args?.fields || 'id,name');
        const token = getTokenFromConfigOrThrow(config, api);
        const client = new MetaAPIClient(token, api, { apiVersion: config.getApiVersion(), config });
        const me = await client.getMe(fields, { verbose: Boolean(options.verbose) });
        return sanitizeForLog(me);
      }
    },
    {
      name: 'query.pages',
      description: 'List /me/accounts (safe fields only). Args: { limit: 25 }',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config, options }, args) => {
        const token = getTokenFromConfigOrThrow(config, 'facebook');
        const limit = safeInt(args?.limit, 25);
        const client = new MetaAPIClient(token, 'facebook', { apiVersion: config.getApiVersion(), config });
        // Avoid returning page access tokens here.
        const result = await client.get('/me/accounts', {
          fields: 'id,name,category,fan_count,instagram_business_account',
          limit
        }, { verbose: Boolean(options.verbose) });
        return (result?.data || []).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          fan_count: p.fan_count,
          instagram_business_account: p.instagram_business_account
        }));
      }
    },
    {
      name: 'utils.limits.check',
      description: 'Check rate limit headers by requesting /me.',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config }) => {
        const api = config.getDefaultApi() || 'facebook';
        const token = getTokenFromConfigOrThrow(config, api);
        const apiVersion = config.getApiVersion();
        const baseUrl = `https://graph.facebook.com/${apiVersion}`;
        const client = new MetaApiClient({ token, apiVersion, baseUrl });

        // We need headers; MetaApiClient currently returns data only, so do a direct axios request via its http instance.
        const res = await client.http.get('/me', { params: { fields: 'id', access_token: token } });
        const appUsage = res.headers['x-app-usage'] || '';
        const pageUsage = res.headers['x-page-usage'] || '';
        const adUsage = res.headers['x-ad-account-usage'] || '';
        return {
          x_app_usage: appUsage,
          x_page_usage: pageUsage,
          x_ad_account_usage: adUsage
        };
      }
    },
    {
      name: 'webhooks.list',
      description: 'List app subscriptions (/{app-id}/subscriptions). Requires app id/secret.',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config, options }) => {
        const { appId } = config.getAppCredentials();
        if (!appId) throw new Error('Missing app id. Run: meta auth app');
        const appAccessToken = getAppAccessTokenOrThrow(config);
        const client = new MetaAPIClient(appAccessToken, 'facebook', { apiVersion: config.getApiVersion(), config });
        const result = await client.get(`/${appId}/subscriptions`, {}, { verbose: Boolean(options.verbose) });
        return result;
      }
    },
    {
      name: 'whatsapp.send',
      description: 'Send WhatsApp message. Args: { from: "<PHONE_NUMBER_ID>", to: "+1555...", type: "text|image", body, url, caption }',
      risk: 'high',
      requiresConfirmation: true,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const token = getTokenFromConfigOrThrow(config, 'whatsapp');
        const from = String(args?.from || config.getDefaultWhatsAppPhoneNumberId() || '').trim();
        const to = String(args?.to || '').trim();
        const type = String(args?.type || 'text').toLowerCase();
        if (!from) throw new Error('Missing from phone number id (args.from or default).');
        if (!to) throw new Error('Missing to.');

        const payload = { messaging_product: 'whatsapp', to };
        if (type === 'text') {
          const body = String(args?.body || '').trim();
          if (!body) throw new Error('Missing body for text message.');
          payload.type = 'text';
          payload.text = { body };
        } else if (type === 'image') {
          const url = String(args?.url || '').trim();
          if (!url) throw new Error('Missing url for image message.');
          payload.type = 'image';
          payload.image = { link: url };
          if (args?.caption) payload.image.caption = String(args.caption);
        } else {
          throw new Error('Invalid type. Use text|image.');
        }

        if (options.dryRun) {
          return { dry_run: true, endpoint: `/${from}/messages`, payload: sanitizeForLog(payload) };
        }

        const client = new MetaAPIClient(token, 'whatsapp', { apiVersion: config.getApiVersion(), config });
        const result = await client.sendWhatsAppMessage(from, payload);
        return sanitizeForLog(result);
      }
    },
    {
      name: 'marketing.insights',
      description: 'Fetch Ads Insights (async-first). Args: { adAccountId, preset, level, fields, breakdowns, timeIncrement, asyncPollInterval, timeout, limit, export, exportFormat, append }',
      risk: 'low',
      requiresConfirmation: false,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const token = getTokenFromConfigOrThrow(config, 'facebook');
        const act = marketing.normalizeAct(args?.adAccountId || config.getDefaultMarketingAdAccountId());
        if (!act) throw new Error('Missing adAccountId (or default Marketing ad account id).');

        const client = new MetaAPIClient(token, 'facebook', { apiVersion: config.getApiVersion(), config });

        const preset = String(args?.preset || 'last_7d');
        const level = String(args?.level || 'campaign').toLowerCase();
        const fields = String(args?.fields || 'spend,impressions,clicks');
        const breakdowns = String(args?.breakdowns || '').trim();
        const timeIncrement = String(args?.timeIncrement || '').trim();

        const params = {
          date_preset: preset,
          level,
          fields,
          limit: parseInt(args?.limit, 10) || 500
        };
        if (breakdowns) params.breakdowns = breakdowns;
        if (timeIncrement) params.time_increment = timeIncrement;

        let rows = [];
        try {
          const reportRunId = await marketing.startAsyncInsightsJob({
            client,
            act,
            params,
            opts: { verbose: Boolean(options.verbose), maxRetries: 5 }
          });
          await marketing.pollInsightsJob({
            client,
            reportRunId,
            pollIntervalSec: parseInt(args?.asyncPollInterval, 10) || 10,
            timeoutSec: parseInt(args?.timeout, 10) || 600,
            verbose: Boolean(options.verbose)
          });
          rows = await marketing.fetchAsyncInsightsResults({
            client,
            reportRunId,
            opts: { verbose: Boolean(options.verbose), maxRetries: 5 }
          });
        } catch (e) {
          const res = await client.get(`/${act}/insights`, params, { verbose: Boolean(options.verbose), maxRetries: 5 });
          rows = res?.data || [];
        }

        if (args?.export) {
          const out = marketing.exportInsights({
            rows,
            exportPath: args.export,
            format: args.exportFormat,
            append: Boolean(args.append)
          });
          return sanitizeForLog({ exported: out, count: rows.length });
        }

        return sanitizeForLog({ count: rows.length, summary: marketing.summarizeInsights(rows), rows });
      }
    },
    {
      name: 'marketing.setStatus',
      description: 'Set status for an ads object. Args: { id, status }',
      risk: 'high',
      requiresConfirmation: true,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const token = getTokenFromConfigOrThrow(config, 'facebook');
        const id = String(args?.id || '').trim();
        const status = String(args?.status || '').toUpperCase().trim();
        if (!id) throw new Error('Missing id');
        if (status !== 'ACTIVE' && status !== 'PAUSED') throw new Error('Invalid status (ACTIVE|PAUSED)');
        if (options.dryRun) return { dry_run: true, id, status };
        const client = new MetaAPIClient(token, 'facebook', { apiVersion: config.getApiVersion(), config });
        const result = await client.post(`/${id}`, {}, { status }, { verbose: Boolean(options.verbose), maxRetries: 5 });
        return sanitizeForLog(result);
      }
    },
    {
      name: 'marketing.setBudget',
      description: 'Update budget for an ads object. Args: { id, daily_budget?, lifetime_budget? }',
      risk: 'high',
      requiresConfirmation: true,
      execute: async ({ config, options, sanitizeForLog }, args) => {
        const token = getTokenFromConfigOrThrow(config, 'facebook');
        const id = String(args?.id || '').trim();
        if (!id) throw new Error('Missing id');
        const payload = {};
        if (args?.daily_budget) payload.daily_budget = String(args.daily_budget);
        if (args?.lifetime_budget) payload.lifetime_budget = String(args.lifetime_budget);
        if (!Object.keys(payload).length) throw new Error('Provide daily_budget and/or lifetime_budget');
        if (options.dryRun) return { dry_run: true, id, payload: sanitizeForLog(payload) };
        const client = new MetaAPIClient(token, 'facebook', { apiVersion: config.getApiVersion(), config });
        const result = await client.post(`/${id}`, {}, payload, { verbose: Boolean(options.verbose), maxRetries: 5 });
        return sanitizeForLog(result);
      }
    }
  ];
}

module.exports = {
  getToolRegistry,
  validatePlanSteps
};

const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID, createHash } = require('crypto');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const packageJson = require('../../package.json');
const config = require('../config');
const MetaAPIClient = require('../api-client');
const { parseIntent, preflightFor } = require('../policy/preflight');
const { ConversationContext } = require('../chat/context');
const { AutonomousAgent } = require('../chat/agent');
const { PersistentMemory } = require('../chat/memory');
const { buildSessionTimeline } = require('../chat/timeline');
const opsStorage = require('../ops/storage');
const opsWorkflows = require('../ops/workflows');
const opsRbac = require('../ops/rbac');
const { buildReadinessReport } = require('../readiness');
const { HostedPlatform } = require('../hosted/platform');
const hostedStorage = require('../hosted/storage');
const appPaths = require('../app-paths');

const GUARD_MODES = new Set(['observe', 'approval', 'auto_safe']);
const SOURCE_CONNECTORS = new Set(
  Array.isArray(opsStorage.SOURCE_CONNECTORS)
    ? opsStorage.SOURCE_CONNECTORS
    : [...(opsStorage.SOURCE_CONNECTORS || [])]
);
const API_PUBLIC_ROUTES = new Set(['/api/health']);
const DEFAULT_CORS_HEADERS = 'Content-Type, X-Gateway-Key, X-Session-Id, X-API-Key, Authorization';
const DEFAULT_CORS_METHODS = 'GET,POST,OPTIONS';
const SDK_APPROVAL_TTL_MS = 10 * 60 * 1000;
const SDK_ACTION_RISK = {
  status: 'LOW',
  doctor: 'LOW',
  get_profile: 'LOW',
  create_post: 'MEDIUM',
  list_ads: 'LOW',
  send_whatsapp: 'MEDIUM',
  logs: 'LOW',
  replay: 'HIGH'
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

function defaultStudioAssetCandidates() {
  return [
    path.resolve(__dirname, '..', '..', 'docs', 'agentic-frontend'),
    path.resolve(__dirname, '..', '..', '..', 'docs', 'agentic-frontend'),
    path.resolve(process.cwd(), 'docs', 'agentic-frontend')
  ];
}

function studioAssetRoots() {
  const rawRoots = [
    process.env.SOCIAL_STUDIO_ASSET_DIRS || '',
    process.env.SOCIAL_STUDIO_ASSET_DIR || ''
  ].join(',');

  const allowRoots = gatewayRoots();
  const seen = new Set();
  const out = [];
  const explicitRoots = csvList(rawRoots);

  const addRoot = (item, options = {}) => {
    const enforceAllowRoot = options.enforceAllowRoot !== false;
    const resolved = path.resolve(item);
    const key = normalizeFsPathForCompare(resolved);
    if (!resolved || seen.has(key)) return;
    seen.add(key);
    if (enforceAllowRoot && !allowRoots.some((root) => isPathInsideRoot(root, resolved))) return;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
    const indexPath = path.join(resolved, 'index.html');
    if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) return;
    out.push(resolved);
  };

  if (explicitRoots.length) {
    explicitRoots.forEach((item) => addRoot(item, { enforceAllowRoot: true }));
    return out;
  }

  defaultStudioAssetCandidates().forEach((item) => addRoot(item, { enforceAllowRoot: false }));

  return out;
}

function resolveStudioAsset(routePath) {
  const requested = String(routePath || '/').trim();
  const normalized = requested === '/' ? '/index.html' : path.posix.normalize(requested);
  if (!normalized.startsWith('/')) return '';
  if (normalized.includes('\0')) return '';

  const rel = normalized.replace(/^\/+/, '');
  if (!rel) return '';
  const ext = path.posix.extname(normalized);
  const trySpaFallback = !ext;

  const roots = studioAssetRoots();
  for (const root of roots) {
    const absoluteRoot = path.resolve(root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) continue;
    const candidate = path.resolve(absoluteRoot, rel);
    if (!isPathInsideRoot(absoluteRoot, candidate)) continue;
    if (!fs.existsSync(candidate)) continue;
    if (!fs.statSync(candidate).isFile()) continue;
    return candidate;
  }

  if (trySpaFallback) {
    for (const root of roots) {
      const absoluteRoot = path.resolve(root);
      const indexPath = path.resolve(absoluteRoot, 'index.html');
      if (!isPathInsideRoot(absoluteRoot, indexPath)) continue;
      if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) continue;
      return indexPath;
    }
  }
  return '';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...(headers || {}) });
  res.end(text);
}

function sendFile(res, status, filePath, headers = {}) {
  const body = fs.readFileSync(filePath);
  res.writeHead(status, {
    'Content-Type': mimeFor(filePath),
    ...(headers || {})
  });
  res.end(body);
}

function studioUiMissingPayload() {
  return {
    ok: false,
    error: 'Studio app frontend is not installed. Add docs/agentic-frontend or set SOCIAL_STUDIO_ASSET_DIR(S) to a valid frontend build.'
  };
}

function sdkTraceId() {
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map((x) => sortedJson(x));
  if (!isPlainObject(value)) return value;
  const out = {};
  Object.keys(value).sort().forEach((key) => {
    out[key] = sortedJson(value[key]);
  });
  return out;
}

function sdkParamsHash(params) {
  const normalized = sortedJson(isPlainObject(params) ? params : {});
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function normalizeSdkAction(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return Object.prototype.hasOwnProperty.call(SDK_ACTION_RISK, raw) ? raw : '';
}

function sdkRiskForAction(action) {
  const a = normalizeSdkAction(action);
  return a ? SDK_ACTION_RISK[a] : '';
}

function sdkRequiresApproval(action) {
  const risk = sdkRiskForAction(action);
  return risk === 'MEDIUM' || risk === 'HIGH';
}

function parseActId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function parseScheduleToUnixSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return Math.floor(ts / 1000);
}

function sdkErrorPayload({ code, message, retryable = false, suggestedNextCommand = '', details = null }) {
  return {
    code: String(code || 'INTERNAL_ERROR').trim() || 'INTERNAL_ERROR',
    message: String(message || 'Unexpected error').trim() || 'Unexpected error',
    retryable: Boolean(retryable),
    suggestedNextCommand: String(suggestedNextCommand || '').trim(),
    details: details && typeof details === 'object' ? details : undefined
  };
}

function sdkMeta({
  action = '',
  risk = '',
  requiresApproval = false,
  approvalToken = '',
  approvalTokenExpiresAt = '',
  source = 'gateway-sdk'
} = {}) {
  return {
    action: String(action || '').trim(),
    risk: String(risk || '').trim(),
    requiresApproval: Boolean(requiresApproval),
    approvalToken: String(approvalToken || '').trim() || null,
    approvalTokenExpiresAt: String(approvalTokenExpiresAt || '').trim() || null,
    source: String(source || 'gateway-sdk').trim() || 'gateway-sdk'
  };
}

function sdkEnvelopeOk({
  traceId,
  data = {},
  action = '',
  risk = '',
  requiresApproval = false,
  approvalToken = '',
  approvalTokenExpiresAt = ''
} = {}) {
  return {
    ok: true,
    traceId: String(traceId || sdkTraceId()),
    data,
    error: null,
    meta: sdkMeta({ action, risk, requiresApproval, approvalToken, approvalTokenExpiresAt })
  };
}

function sdkEnvelopeError({
  traceId,
  status = 400,
  action = '',
  risk = '',
  requiresApproval = false,
  approvalToken = '',
  approvalTokenExpiresAt = '',
  code = 'BAD_REQUEST',
  message = 'Request failed',
  retryable = false,
  suggestedNextCommand = '',
  details = null
} = {}) {
  return {
    status: Number(status) || 400,
    payload: {
      ok: false,
      traceId: String(traceId || sdkTraceId()),
      data: null,
      error: sdkErrorPayload({ code, message, retryable, suggestedNextCommand, details }),
      meta: sdkMeta({ action, risk, requiresApproval, approvalToken, approvalTokenExpiresAt })
    }
  };
}

function sdkErrorFromThrown(error, fallback = {}) {
  const status = Number(error?.response?.status || 0);
  const apiError = error?.response?.data?.error || {};
  const message = String(apiError.message || error?.message || fallback.message || 'Request failed').trim();
  const code = String(apiError.code || fallback.code || 'EXECUTION_FAILED').trim() || 'EXECUTION_FAILED';
  const retryable = status === 429 || (status >= 500 && status < 600);
  return sdkEnvelopeError({
    ...fallback,
    status: status || fallback.status || 400,
    code,
    message,
    retryable
  });
}

function gatewayLogsDir() {
  return path.join(process.cwd(), 'logs');
}

function listGatewayActionLogs(limit = 20) {
  const dir = gatewayLogsDir();
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  const out = [];
  files.forEach((name) => {
    const fullPath = path.join(dir, name);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      const stat = fs.statSync(fullPath);
      const tsRaw = String(parsed.timestamp || parsed.createdAt || parsed.updatedAt || stat.mtime.toISOString());
      const ts = Date.parse(tsRaw);
      out.push({
        id: String(parsed.id || path.basename(name, '.json')),
        timestamp: Number.isFinite(ts) ? new Date(ts).toISOString() : stat.mtime.toISOString(),
        action: String(parsed.action || ''),
        params: isPlainObject(parsed.params) ? parsed.params : {},
        latency: Number(parsed.latency || 0) || 0,
        success: Boolean(parsed.success),
        error: String(parsed.error || '').trim(),
        rollback_plan: String(parsed.rollback_plan || '').trim(),
        trace_id: String(parsed.trace_id || '').trim(),
        risk: String(parsed.risk || '').trim()
      });
    } catch {
      // ignore malformed log entries
    }
  });
  out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return out.slice(0, Math.max(1, Number(limit || 20)));
}

function appendGatewayActionLog(entry = {}) {
  const dir = gatewayLogsDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = String(entry.id || randomUUID());
  const record = {
    id,
    timestamp: String(entry.timestamp || new Date().toISOString()),
    action: String(entry.action || ''),
    params: isPlainObject(entry.params) ? entry.params : {},
    latency: Number(entry.latency || 0) || 0,
    success: Boolean(entry.success),
    error: String(entry.error || '').trim() || undefined,
    rollback_plan: String(entry.rollback_plan || 'No rollback').trim() || 'No rollback',
    trace_id: String(entry.trace_id || '').trim() || undefined,
    risk: String(entry.risk || '').trim() || undefined
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

function maskToken(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length <= 10) return '***';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function configSnapshot() {
  const app = typeof config.getAppCredentials === 'function'
    ? config.getAppCredentials()
    : { appId: '', appSecret: '' };
  const agent = typeof config.getAgentConfig === 'function'
    ? config.getAgentConfig()
    : { provider: 'openai', model: '', apiKey: '' };
  const onboarding = typeof config.getOnboardingStatus === 'function'
    ? config.getOnboardingStatus()
    : { completed: false, completedAt: '', version: '' };

  return {
    activeProfile: typeof config.getActiveProfile === 'function' ? config.getActiveProfile() : 'default',
    profiles: typeof config.listProfiles === 'function' ? config.listProfiles() : [],
    apiVersion: typeof config.getApiVersion === 'function' ? config.getApiVersion() : '',
    defaultApi: typeof config.getDefaultApi === 'function' ? config.getDefaultApi() : 'facebook',
    tokens: {
      facebook: {
        configured: Boolean(config.getToken('facebook')),
        preview: maskToken(config.getToken('facebook'))
      },
      instagram: {
        configured: Boolean(config.getToken('instagram')),
        preview: maskToken(config.getToken('instagram'))
      },
      whatsapp: {
        configured: Boolean(config.getToken('whatsapp')),
        preview: maskToken(config.getToken('whatsapp'))
      }
    },
    app: {
      appId: app.appId || '',
      appSecretConfigured: Boolean(app.appSecret)
    },
    agent: {
      provider: String(agent.provider || 'openai'),
      model: String(agent.model || ''),
      modelTiers: {
        cheap: String(((agent.modelTiers || {}).cheap) || ''),
        balanced: String(((agent.modelTiers || {}).balanced) || ''),
        premium: String(((agent.modelTiers || {}).premium) || '')
      },
      apiKeyConfigured: String(agent.provider || 'openai').trim().toLowerCase() === 'ollama'
        ? true
        : Boolean(agent.apiKey)
    },
    onboarding: {
      completed: Boolean(onboarding.completed),
      completedAt: String(onboarding.completedAt || ''),
      version: String(onboarding.version || '')
    },
    defaults: {
      facebookPageId: typeof config.getDefaultFacebookPageId === 'function' ? config.getDefaultFacebookPageId() : '',
      igUserId: typeof config.getDefaultIgUserId === 'function' ? config.getDefaultIgUserId() : '',
      whatsappPhoneNumberId: typeof config.getDefaultWhatsAppPhoneNumberId === 'function' ? config.getDefaultWhatsAppPhoneNumberId() : '',
      marketingAdAccountId: typeof config.getDefaultMarketingAdAccountId === 'function' ? config.getDefaultMarketingAdAccountId() : ''
    },
    industry: typeof config.getIndustryConfig === 'function'
      ? config.getIndustryConfig({
        accountId: typeof config.getDefaultMarketingAdAccountId === 'function'
          ? config.getDefaultMarketingAdAccountId()
          : ''
      })
      : {
        mode: 'hybrid',
        selected: '',
        source: '',
        confidence: 0,
        detectorVersion: '',
        detectedAt: '',
        manualLocked: false
      },
    region: typeof config.getRegionConfig === 'function'
      ? config.getRegionConfig()
      : { country: '', timezone: '', regulatoryMode: 'standard' }
  };
}

function titleFromKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDurationShort(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || !parts.length) parts.push(`${minutes}m`);
  return parts.slice(0, 2).join(' ');
}

function selfHostedPathRows() {
  const rows = [
    { key: 'configDir', label: 'Config Directory', path: String(config.dir || '').trim() },
    { key: 'configFile', label: 'Config File', path: String(config.file || '').trim() },
    { key: 'gatewayLogsDir', label: 'Gateway Logs', path: gatewayLogsDir() },
    { key: 'hostedHome', label: 'Hosted Data Home', path: hostedStorage.hostedRoot() },
    { key: 'recipesDir', label: 'Recipes Directory', path: hostedStorage.resolveVersionedDir('recipes', 'SOCIAL_HOSTED_RECIPES_DIR') },
    { key: 'triggersDir', label: 'Triggers Directory', path: hostedStorage.resolveVersionedDir('triggers', 'SOCIAL_HOSTED_TRIGGERS_DIR') },
    { key: 'webchatDir', label: 'Webchat Directory', path: hostedStorage.resolveVersionedDir('webchat', 'SOCIAL_WEBCHAT_DIR') },
    { key: 'baileysDir', label: 'Baileys Directory', path: hostedStorage.resolveVersionedDir('baileys', 'SOCIAL_BAILEYS_DIR') },
    { key: 'opsDir', label: 'Ops Workspace Data', path: typeof opsStorage.opsRoot === 'function' ? opsStorage.opsRoot() : '' }
  ];

  return rows.map((row) => ({
    ...row,
    exists: Boolean(row.path) && fs.existsSync(row.path)
  }));
}

function buildSelfHostedAdminSnapshot(server) {
  const cfg = configSnapshot();
  const pathRows = selfHostedPathRows();
  const pathMap = Object.fromEntries(pathRows.map((row) => [row.key, row.path]));
  const baseUrl = typeof server?.url === 'function' ? server.url() : '';
  const corsOrigins = Array.from(server?.corsOrigins || []).filter(Boolean);
  const setup = {
    studioFrontendInstalled: studioAssetRoots().length > 0,
    onboardingCompleted: Boolean(cfg?.onboarding?.completed),
    defaultApi: String(cfg?.defaultApi || 'facebook'),
    defaultTokenConfigured: Boolean(cfg?.tokens?.[cfg?.defaultApi || 'facebook']?.configured),
    anyTokenConfigured: Object.values(cfg?.tokens || {}).some((row) => Boolean(row?.configured)),
    appCredentialsConfigured: Boolean(cfg?.app?.appId) && Boolean(cfg?.app?.appSecretConfigured),
    agentApiConfigured: Boolean(cfg?.agent?.apiKeyConfigured)
  };
  const security = {
    apiKeyConfigured: Boolean(server?.apiKey),
    apiKeyRequired: Boolean(server?.requireApiKey),
    corsRestricted: corsOrigins.length > 0 || !server?.isLocalBind?.(),
    corsOrigins,
    rateLimitMax: Number(server?.rateLimitMax || 0) || 0,
    rateLimitWindowMs: Number(server?.rateLimitWindowMs || 0) || 0,
    hostedMasterKeyConfigured: Boolean(process.env.SOCIAL_HOSTED_MASTER_KEY),
    hostedBootstrapApiKeyConfigured: Boolean(process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY),
    hostedBootstrapUserConfigured: Boolean(process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID)
  };

  const checks = [
    {
      key: 'gateway_access',
      ok: security.apiKeyConfigured && security.apiKeyRequired,
      severity: 'required',
      detail: security.apiKeyConfigured && security.apiKeyRequired
        ? 'Gateway API key is configured and enforced for non-public routes.'
        : 'Gateway API key is missing or not enforced yet.',
      fix: 'Set SOCIAL_GATEWAY_API_KEY and SOCIAL_GATEWAY_REQUIRE_API_KEY=true.'
    },
    {
      key: 'cors_policy',
      ok: security.corsRestricted || server?.isLocalBind?.(),
      severity: 'recommended',
      detail: security.corsRestricted
        ? `Cross-origin access is scoped to ${corsOrigins.length || 0} origin(s).`
        : 'Gateway is using open local-development CORS defaults.',
      fix: server?.isLocalBind?.()
        ? 'Add SOCIAL_GATEWAY_CORS_ORIGINS before exposing Studio remotely.'
        : 'Set SOCIAL_GATEWAY_CORS_ORIGINS to your Studio domain.'
    },
    {
      key: 'hosted_secrets',
      ok: security.hostedMasterKeyConfigured && security.hostedBootstrapApiKeyConfigured && security.hostedBootstrapUserConfigured,
      severity: 'required',
      detail: security.hostedMasterKeyConfigured && security.hostedBootstrapApiKeyConfigured && security.hostedBootstrapUserConfigured
        ? 'Hosted vault/bootstrap secrets are configured.'
        : 'One or more hosted encryption/bootstrap env vars are missing.',
      fix: 'Set SOCIAL_HOSTED_MASTER_KEY, SOCIAL_HOSTED_BOOTSTRAP_API_KEY, and SOCIAL_HOSTED_BOOTSTRAP_USER_ID.'
    },
    {
      key: 'studio_frontend',
      ok: setup.studioFrontendInstalled,
      severity: 'required',
      detail: setup.studioFrontendInstalled
        ? 'Studio frontend assets are available to the gateway.'
        : 'Studio frontend assets are missing from the configured asset roots.',
      fix: 'Install docs/agentic-frontend or point SOCIAL_STUDIO_ASSET_DIR(S) at a valid build.'
    },
    {
      key: 'operator_onboarding',
      ok: setup.onboardingCompleted && setup.defaultTokenConfigured && setup.agentApiConfigured,
      severity: 'recommended',
      detail: setup.onboardingCompleted && setup.defaultTokenConfigured && setup.agentApiConfigured
        ? 'Core setup is complete for daily operator use.'
        : 'Onboarding, default token, or agent API key setup is still incomplete.',
      fix: 'Open Studio Setup Concierge, complete credentials, and finish onboarding.'
    }
  ];

  const nextActions = [];
  for (const row of checks) {
    if (!row.ok && row.fix) nextActions.push(row.fix);
  }

  return {
    service: 'social-api-gateway',
    version: packageJson.version,
    workspace: String(cfg?.activeProfile || 'default'),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      startedAt: String(server?.startedAt || ''),
      uptime: formatDurationShort(
        server?.startedAt
          ? (Date.now() - Date.parse(server.startedAt)) / 1000
          : process.uptime()
      )
    },
    network: {
      host: String(server?.host || '127.0.0.1'),
      port: Number(server?.port || 1310) || 1310,
      baseUrl,
      localOnly: Boolean(server?.isLocalBind?.())
    },
    security,
    setup,
    paths: pathRows,
    distribution: server?.hosted?.distributionModel ? server.hosted.distributionModel() : {},
    architecture: server?.hosted?.defaultHostedSummary ? server.hosted.defaultHostedSummary() : {},
    urls: {
      health: baseUrl ? `${baseUrl}/api/health` : '/api/health',
      status: baseUrl ? `${baseUrl}/api/status` : '/api/status',
      studio: baseUrl ? `${baseUrl}/studio/app/` : '/studio/app/'
    },
    commands: {
      doctor: 'social doctor',
      status: 'social status',
      start: 'social start',
      studio: `social studio --url ${baseUrl || 'http://127.0.0.1:1310'}`,
      upgrade: 'npm install -g @vishalgojha/social-flow@latest',
      backup: `Back up ${pathMap.configDir || '<config-dir>'} and ${pathMap.hostedHome || '<hosted-home>'}.`
    },
    checks,
    nextActions
  };
}

function resolveRequestActor() {
  const operator = typeof config.getOperator === 'function'
    ? config.getOperator()
    : { id: '', name: '' };
  const actorId = String(operator.id || '').trim() || opsRbac.currentUser();
  return {
    id: actorId,
    name: String(operator.name || '').trim()
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function toIsoOrFallback(value, fallbackIso) {
  const raw = String(value || '').trim();
  if (!raw) return fallbackIso;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return fallbackIso;
  return new Date(ts).toISOString();
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function teamActivityToCsv(rows) {
  const header = [
    'createdAt',
    'workspace',
    'actor',
    'action',
    'status',
    'summary',
    'meta'
  ];
  const out = [header.join(',')];
  for (const row of rows) {
    out.push([
      csvCell(row.createdAt || ''),
      csvCell(row.workspace || ''),
      csvCell(row.actor || ''),
      csvCell(row.action || ''),
      csvCell(row.status || ''),
      csvCell(row.summary || ''),
      csvCell(JSON.stringify(row.meta || {}))
    ].join(','));
  }
  return out.join('\n');
}

function normalizeHandoffTemplate(value) {
  const template = String(value || 'agency').trim().toLowerCase();
  return ['simple', 'agency', 'enterprise'].includes(template) ? template : '';
}

function buildHandoffDoc({
  template,
  workspace,
  studioUrl,
  gatewayApiKey,
  operatorId,
  runAtIso,
  generatedAt
}) {
  const ws = workspace || 'default';
  const operator = operatorId || '<operator_id>';
  const keyText = gatewayApiKey ? '<provided_separately>' : '<set_gateway_api_key>';
  const templateName = normalizeHandoffTemplate(template) || 'agency';
  const common = [
    `# Social Flow Agency Handoff - ${ws}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '## What This Workspace Does',
    '- Run daily agency checks (tokens, approvals, follow-ups).',
    '- Track who approved/rejected risky actions.',
    '- Operate via CLI or your external Social Studio UI.',
    '',
    '## Quick Access',
    `- Workspace: \`${ws}\``,
    `- Studio URL: \`${studioUrl}\``,
    `- Gateway API key: \`${keyText}\``,
    '',
    '## First-Time Setup (Team Member)',
    '1. Install and verify:',
    '   - `npm install -g @vishalgojha/social-flow`',
    '   - `social --help`',
    '2. Set workspace and operator:',
    `   - \`social accounts switch ${ws}\``,
    `   - \`social ops user set ${operator} --name "<your_name>"\``,
    '3. Verify role and access:',
    `   - \`social ops roles show --workspace ${ws}\``,
    `   - \`social ops user show --workspace ${ws}\``,
    '',
    '## Daily Operations Runbook',
    `- \`social ops morning-run --workspace ${ws} --spend 0\``,
    `- \`social ops alerts list --workspace ${ws} --open\``,
    `- \`social ops approvals list --workspace ${ws} --open\``,
    `- \`social ops activity list --workspace ${ws} --limit 30\``
  ];
  if (templateName === 'simple') {
    return [
      ...common,
      '',
      '## Studio',
      `- URL: \`${studioUrl}\``,
      `- API key: \`${keyText}\``,
      ''
    ].join('\n');
  }
  if (templateName === 'enterprise') {
    return [
      ...common,
      '',
      '## Approval Matrix',
      '- Viewer: read-only',
      '- Admin: analysis + notes',
      '- Operator: approve + execute',
      '- Owner: admin + role control',
      '',
      '## Audit Cadence',
      '- Daily: alerts + approvals review',
      '- Weekly: export activity logs',
      '- Monthly: role/policy review',
      ''
    ].join('\n');
  }
  return [...common, ''].join('\n');
}

function buildRunbookDoc({ workspace, generatedAt }) {
  const ws = workspace || 'default';
  return [
    `# Daily Runbook - ${ws}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    `1. \`social ops morning-run --workspace ${ws} --spend 0\``,
    `2. \`social ops alerts list --workspace ${ws} --open\``,
    `3. \`social ops approvals list --workspace ${ws} --open\``,
    `4. \`social ops activity list --workspace ${ws} --limit 50\``,
    ''
  ].join('\n');
}

function buildAccessMatrixCsv({ workspace }) {
  const ws = workspace || 'default';
  return [
    'workspace,user,role,owner_approved,notes',
    `${ws},<user1>,viewer,yes,read-only`,
    `${ws},<user2>,admin,yes,analysis`,
    `${ws},<user3>,operator,yes,approval+execution`,
    `${ws},<user4>,owner,yes,admin`
  ].join('\n');
}

function buildIncidentPlaybookDoc({ workspace, generatedAt }) {
  const ws = workspace || 'default';
  return [
    `# Incident Playbook - ${ws}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '1. Classify severity.',
    `2. Capture state: \`social ops alerts list --workspace ${ws} --json\``,
    '3. Pause risky automation (guard mode approval).',
    '4. Assign owner + operator and track closure.',
    ''
  ].join('\n');
}

async function resolveWabaId(client, businessId) {
  if (!businessId) return '';
  try {
    const rows = await client.get(`/${businessId}/owned_whatsapp_business_accounts`, {
      fields: 'id,name',
      limit: 10
    });
    const first = asArray(rows?.data)[0];
    return String(first?.id || '');
  } catch {
    return '';
  }
}

async function resolvePhoneNumberId(client, wabaId) {
  if (!wabaId) return '';
  try {
    const out = await client.listWhatsAppPhoneNumbers(wabaId);
    const first = asArray(out?.data)[0];
    return String(first?.id || '');
  } catch {
    return '';
  }
}

async function wabaDoctorReport({ token, businessId, wabaId, phoneNumberId, callbackUrl, verifyToken, testTo }) {
  const checks = [];
  const client = new MetaAPIClient(token, 'whatsapp');

  try {
    const me = await client.getMe('id,name');
    checks.push({ key: 'token_valid', ok: true, detail: me.name || me.id || 'ok' });
  } catch (error) {
    checks.push({ key: 'token_valid', ok: false, detail: String(error?.message || error || '') });
    return { ok: false, checks };
  }

  const app = typeof config.getAppCredentials === 'function'
    ? config.getAppCredentials()
    : { appId: '', appSecret: '' };
  if (app.appId && app.appSecret) {
    try {
      const fb = new MetaAPIClient(`${app.appId}|${app.appSecret}`, 'facebook');
      const debug = await fb.debugToken(token);
      const scopes = asArray(debug?.data?.scopes);
      const required = ['whatsapp_business_messaging', 'whatsapp_business_management'];
      const missing = required.filter((s) => !scopes.includes(s));
      checks.push({ key: 'required_scopes', ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.join(', ')}` : 'ok' });
    } catch (error) {
      checks.push({ key: 'required_scopes', ok: false, detail: String(error?.message || error || '') });
    }
  } else {
    checks.push({ key: 'required_scopes', ok: null, detail: 'Skipped (app id/secret not configured)' });
  }

  checks.push({ key: 'business_id', ok: Boolean(businessId), detail: businessId || 'not set' });
  checks.push({ key: 'waba_id', ok: Boolean(wabaId), detail: wabaId || 'not set' });

  if (wabaId) {
    try {
      const nums = await client.listWhatsAppPhoneNumbers(wabaId);
      const count = asArray(nums?.data).length;
      checks.push({ key: 'phone_access', ok: count > 0, detail: count > 0 ? `${count} phone number(s)` : 'No phone numbers found' });
    } catch (error) {
      checks.push({ key: 'phone_access', ok: false, detail: String(error?.message || error || '') });
    }
  } else {
    checks.push({ key: 'phone_access', ok: false, detail: 'Missing waba id' });
  }

  if (phoneNumberId && testTo) {
    try {
      await client.sendWhatsAppMessage(phoneNumberId, {
        messaging_product: 'whatsapp',
        to: testTo,
        type: 'text',
        text: { body: 'Social Studio integration test message' }
      });
      checks.push({ key: 'test_send', ok: true, detail: `sent to ${testTo}` });
    } catch (error) {
      checks.push({ key: 'test_send', ok: false, detail: String(error?.message || error || '') });
    }
  } else {
    checks.push({ key: 'test_send', ok: null, detail: 'Skipped (set test destination)' });
  }

  checks.push({
    key: 'webhook_config',
    ok: Boolean(callbackUrl && verifyToken),
    detail: callbackUrl && verifyToken ? 'configured' : 'Missing callback URL/verify token'
  });

  const hardFails = checks.filter((c) => c.ok === false && ['token_valid', 'required_scopes', 'phone_access'].includes(c.key));
  return { ok: hardFails.length === 0, checks };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      const size = chunks.reduce((n, b) => n + b.length, 0);
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large.'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
  });
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function csvList(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeIp(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

function isLoopbackIp(v) {
  const ip = normalizeIp(v);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isLoopbackHost(v) {
  const host = String(v || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function normalizeFsPathForCompare(v) {
  const resolved = path.resolve(String(v || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(root, target) {
  const base = normalizeFsPathForCompare(root);
  const candidate = normalizeFsPathForCompare(target);
  if (!base || !candidate) return false;
  if (base === candidate) return true;
  const rel = path.relative(base, candidate);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function gatewayRoots() {
  const roots = appPaths.uniquePaths([
    path.resolve(process.cwd()),
    appPaths.resolveAppHome(process.env),
    process.env.SOCIAL_FLOW_HOME ? path.resolve(process.env.SOCIAL_FLOW_HOME) : '',
    process.env.SOCIAL_CLI_HOME ? path.resolve(process.env.SOCIAL_CLI_HOME) : '',
    process.env.META_CLI_HOME ? path.resolve(process.env.META_CLI_HOME) : ''
  ].filter(Boolean));
  return [...new Set(roots.map((x) => normalizeFsPathForCompare(x)))];
}

function resolveSafeOutDir(rawPath, fallbackRelative) {
  const fallback = String(fallbackRelative || 'reports').trim() || 'reports';
  const input = String(rawPath || '').trim();
  const candidate = input
    ? (path.isAbsolute(input) ? path.resolve(input) : path.resolve(process.cwd(), input))
    : path.resolve(process.cwd(), fallback);
  const allowed = gatewayRoots().some((root) => isPathInsideRoot(root, candidate));
  if (!allowed) {
    throw new Error('Output path must be inside allowed gateway roots.');
  }
  return candidate;
}

function normalizeGuardMode(v) {
  const mode = String(v || '').trim().toLowerCase();
  if (GUARD_MODES.has(mode)) return mode;
  return '';
}

function normalizeConnector(v) {
  const connector = String(v || '').trim().toLowerCase();
  if (!connector) return '';
  if (SOURCE_CONNECTORS.size && SOURCE_CONNECTORS.has(connector)) return connector;
  return 'custom';
}

function guardPolicyPatchFromBody(body) {
  if (!isPlainObject(body)) return {};
  const patch = {};
  if (body.enabled !== undefined) patch.enabled = toBool(body.enabled, true);
  if (body.mode !== undefined) {
    const mode = normalizeGuardMode(body.mode);
    if (!mode) throw new Error('Invalid guard mode. Use observe, approval, or auto_safe.');
    patch.mode = mode;
  }
  if (body.cooldownMinutes !== undefined) patch.cooldownMinutes = toNumber(body.cooldownMinutes, 60);

  if (isPlainObject(body.thresholds)) {
    patch.thresholds = {};
    if (body.thresholds.spendSpikePct !== undefined) patch.thresholds.spendSpikePct = toNumber(body.thresholds.spendSpikePct, 35);
    if (body.thresholds.cpaSpikePct !== undefined) patch.thresholds.cpaSpikePct = toNumber(body.thresholds.cpaSpikePct, 30);
    if (body.thresholds.roasDropPct !== undefined) patch.thresholds.roasDropPct = toNumber(body.thresholds.roasDropPct, 20);
  }

  if (isPlainObject(body.limits)) {
    patch.limits = {};
    if (body.limits.maxBudgetAdjustmentPct !== undefined) patch.limits.maxBudgetAdjustmentPct = toNumber(body.limits.maxBudgetAdjustmentPct, 20);
    if (body.limits.maxCampaignsPerRun !== undefined) patch.limits.maxCampaignsPerRun = toNumber(body.limits.maxCampaignsPerRun, 5);
    if (body.limits.maxDailyAutoActions !== undefined) patch.limits.maxDailyAutoActions = toNumber(body.limits.maxDailyAutoActions, 10);
    if (body.limits.requireApprovalForPause !== undefined) patch.limits.requireApprovalForPause = toBool(body.limits.requireApprovalForPause, true);
  }

  return patch;
}

function sourcePatchFromBody(body) {
  if (!isPlainObject(body)) return {};
  const patch = {};
  if (body.id !== undefined) patch.id = String(body.id || '').trim();
  if (body.name !== undefined) patch.name = String(body.name || '').trim();
  if (body.connector !== undefined) patch.connector = normalizeConnector(body.connector);
  if (body.syncMode !== undefined) patch.syncMode = String(body.syncMode || '').trim().toLowerCase();
  if (body.enabled !== undefined) patch.enabled = toBool(body.enabled, true);
  if (isPlainObject(body.config)) patch.config = body.config;
  return patch;
}

function opsSummary(workspace) {
  const ws = opsStorage.ensureWorkspace(workspace || config.getActiveProfile() || 'default');
  const alerts = opsStorage.listAlerts(ws);
  const approvals = opsStorage.listApprovals(ws);
  const leads = opsStorage.listLeads(ws);
  const schedules = opsStorage.listSchedules(ws);
  const sources = opsStorage.listSources(ws);
  const outcomes = opsStorage.listOutcomes(ws);
  const state = opsStorage.getState(ws);
  const policy = opsStorage.getPolicy(ws);
  const guardPolicy = opsStorage.getGuardPolicy(ws);
  const role = opsRbac.roleFor({ workspace: ws });

  const openAlerts = alerts.filter((a) => a.status === 'open');
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const leadsDue = leads.filter((l) => l.status === 'no_reply_3d' || l.status === 'followup_due');
  const dueSchedules = opsStorage.listDueSchedules(ws);
  const enabledSources = sources.filter((x) => x.enabled !== false);
  const readySources = enabledSources.filter((x) => x.status === 'ready');

  return {
    workspace: ws,
    summary: {
      role,
      alertsOpen: openAlerts.length,
      approvalsPending: pendingApprovals.length,
      leadsDue: leadsDue.length,
      schedulesDue: dueSchedules.length,
      sourcesConfigured: enabledSources.length,
      sourcesReady: readySources.length,
      lastMorningRunDate: state.lastMorningRunDate || '',
      policy,
      guardPolicy
    },
    alerts: openAlerts.slice(0, 20),
    approvals: pendingApprovals.slice(0, 20),
    schedules: schedules.slice(0, 20),
    sources: sources.slice(0, 40),
    outcomes: outcomes.slice(-20).reverse(),
    leadsDue: leadsDue.slice(0, 20)
  };
}

function readinessReport({ workspace, gatewayApiKeyConfigured }) {
  const ws = opsStorage.ensureWorkspace(workspace || config.getActiveProfile() || 'default');
  const operator = typeof config.getOperator === 'function' ? config.getOperator() : { id: '', name: '' };
  const rolesDoc = opsStorage.getRoles();
  const usersMap = rolesDoc && rolesDoc.users && typeof rolesDoc.users === 'object' ? rolesDoc.users : {};
  const roleUsers = Object.entries(usersMap).filter(([, entry]) => {
    const workspaceRole = String((entry && entry.workspaces && entry.workspaces[ws]) || '').trim();
    return Boolean(workspaceRole);
  });
  const invites = opsStorage.listInvites({ workspace: ws, includeExpired: true });
  const acceptedInvites = invites.filter((x) => x.status === 'accepted').length;
  const schedules = opsStorage.listSchedules(ws);
  const hasMorningSchedule = schedules.some((x) => x.workflow === 'morning_ops' && x.enabled !== false);
  const state = opsStorage.getState(ws);
  const checks = [
    { key: 'operator_set', ok: Boolean(String(operator.id || '').trim()), detail: operator.id || 'Set active operator in Team Management.' },
    { key: 'roles_configured', ok: roleUsers.length > 0, detail: `${roleUsers.length} workspace role assignment(s).` },
    { key: 'invites_sent', ok: invites.length > 0, detail: `${invites.length} invite(s) created.` },
    { key: 'invite_accepted', ok: acceptedInvites > 0, detail: `${acceptedInvites} invite(s) accepted.` },
    { key: 'morning_schedule', ok: hasMorningSchedule, detail: hasMorningSchedule ? 'Daily morning_ops schedule exists.' : 'Create daily morning_ops schedule.' },
    { key: 'gateway_key', ok: Boolean(gatewayApiKeyConfigured), detail: gatewayApiKeyConfigured ? 'Gateway API key configured.' : 'Set gateway API key for shared team access.' },
    { key: 'onboarding_marked', ok: Boolean(String(state.onboardingCompletedAt || '').trim()), detail: state.onboardingCompletedAt || 'Mark onboarding complete when ready.' }
  ];
  const passed = checks.filter((x) => x.ok).length;
  const total = checks.length;
  return {
    workspace: ws,
    score: { passed, total, ratio: total ? Number((passed / total).toFixed(2)) : 0 },
    status: passed === total ? 'ready' : passed >= Math.ceil(total * 0.6) ? 'in_progress' : 'needs_setup',
    checks,
    onboardingCompletedAt: String(state.onboardingCompletedAt || '')
  };
}

function buildWeeklyOpsReport({ workspace, days = 7 }) {
  const ws = opsStorage.ensureWorkspace(workspace || config.getActiveProfile() || 'default');
  const dayCount = Math.max(1, Math.min(30, Number(days) || 7));
  const cutoff = Date.now() - dayCount * 24 * 60 * 60 * 1000;
  const toTs = (v) => {
    const ts = Date.parse(String(v || ''));
    return Number.isFinite(ts) ? ts : 0;
  };
  const inWindow = (v) => toTs(v) >= cutoff;

  const readiness = readinessReport({ workspace: ws, gatewayApiKeyConfigured: true });
  const inviteStats = opsStorage.inviteStats({ workspace: ws, days: dayCount });
  const approvals = opsStorage.listApprovals(ws);
  const alerts = opsStorage.listAlerts(ws);
  const outcomes = opsStorage.listOutcomes(ws);
  const actions = opsStorage.listActionLog(ws);

  const approvalsApproved = approvals.filter((x) => x.status === 'approved' && inWindow(x.decidedAt)).length;
  const approvalsRejected = approvals.filter((x) => x.status === 'rejected' && inWindow(x.decidedAt)).length;
  const approvalsPending = approvals.filter((x) => x.status === 'pending').length;
  const alertsOpened = alerts.filter((x) => x.status === 'open' && inWindow(x.createdAt)).length;
  const alertsAcked = alerts.filter((x) => x.status === 'acked' && inWindow(x.ackAt)).length;
  const outcomesRecent = outcomes.filter((x) => inWindow(x.createdAt));
  const inviteAcceptActions = actions.filter((x) => x.action === 'invite.accept' && inWindow(x.createdAt));

  const lines = [
    `# Weekly Ops Report - ${ws}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Window: last ${dayCount} day(s)`,
    '',
    '## Readiness',
    `- Status: ${readiness.status}`,
    `- Score: ${readiness.score.passed}/${readiness.score.total}`,
    '',
    '## Invites',
    `- Active: ${inviteStats.active}`,
    `- Accepted: ${inviteStats.accepted}`,
    `- Expired (window): ${inviteStats.expiredRecent}`,
    `- Avg time-to-accept (min): ${Math.round((inviteStats.avgAcceptMs || 0) / 60000)}`,
    `- Accepted via action log (window): ${inviteAcceptActions.length}`,
    '',
    '## Approvals',
    `- Approved (window): ${approvalsApproved}`,
    `- Rejected (window): ${approvalsRejected}`,
    `- Pending now: ${approvalsPending}`,
    '',
    '## Alerts',
    `- Opened (window): ${alertsOpened}`,
    `- Acked (window): ${alertsAcked}`,
    '',
    '## Outcomes',
    `- Outcomes logged (window): ${outcomesRecent.length}`,
    '',
    '## Recent Outcome Summaries',
    ...(
      outcomesRecent.slice(-8).reverse().map((x) => `- ${x.createdAt}: ${x.summary || x.kind || 'outcome'}`)
    )
  ];
  return lines.join('\n');
}

class ChatRuntime {
  constructor(sessionId, options = {}) {
    this.options = options;
    this.memory = new PersistentMemory(sessionId);
    this.context = new ConversationContext();
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options: {
        debug: Boolean(options.debug),
        requireExplicitApproval: true
      }
    });
    this.resumed = false;
  }

  async load() {
    if (!this.memory.exists()) return;
    const saved = this.memory.load();
    if (!saved?.context) return;
    this.context = new ConversationContext(saved.context);
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options: {
        debug: Boolean(this.options.debug),
        requireExplicitApproval: true
      }
    });
    this.resumed = true;
  }

  async save() {
    this.memory.save({ context: this.context.toJSON() });
  }

  async executeActions(actions) {
    const executed = [];
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.agent.execute(action);
        this.context.addResult(action, result.raw);
        executed.push({
          tool: action.tool,
          success: true,
          summary: result.summary,
          suggestions: result.suggestions || []
        });
      } catch (error) {
        this.context.addError(action, error);
        const fail = this.agent.failureAdvice(action, error);
        executed.push({
          tool: action.tool,
          success: false,
          error: fail.message || String(error?.message || error || ''),
          suggestions: fail.suggestions || []
        });
      }
    }
    return executed;
  }

  async processMessage(message) {
    const response = await this.agent.process(message);
    let executed = [];
    if (response.actions?.length && !response.needsInput) {
      executed = await this.executeActions(response.actions);
    }
    await this.save();
    return {
      sessionId: this.memory.id,
      resumed: this.resumed,
      response,
      executed,
      pendingActions: this.context.pendingActions || [],
      summary: this.context.getSummary(),
      history: this.context.getHistory(40),
      timeline: this.context.getTimeline(120)
    };
  }
}

class GatewayServer {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    const requestedPort = options.port !== undefined ? Number(options.port) : 1310;
    this.port = Number.isFinite(requestedPort) ? requestedPort : 1310;
    this.startedAt = '';
    this.debug = Boolean(options.debug);
    this.apiKey = String(
      options.apiKey !== undefined
        ? options.apiKey
        : (process.env.SOCIAL_GATEWAY_API_KEY || process.env.META_GATEWAY_API_KEY || '')
    ).trim();
    this.requireApiKey = toBool(
      options.requireApiKey !== undefined
        ? options.requireApiKey
        : process.env.SOCIAL_GATEWAY_REQUIRE_API_KEY,
      false
    );
    const rawCors = options.corsOrigins !== undefined
      ? options.corsOrigins
      : (process.env.SOCIAL_GATEWAY_CORS_ORIGINS || process.env.META_GATEWAY_CORS_ORIGINS || '');
    const corsList = Array.isArray(rawCors) ? rawCors : csvList(rawCors);
    this.corsOrigins = new Set(corsList.map((x) => String(x || '').trim()).filter(Boolean));
    this.rateLimitWindowMs = Math.max(1000, toNumber(
      options.rateLimitWindowMs !== undefined
        ? options.rateLimitWindowMs
        : process.env.SOCIAL_GATEWAY_RATE_WINDOW_MS,
      60 * 1000
    ));
    this.rateLimitMax = Math.max(1, toNumber(
      options.rateLimitMax !== undefined
        ? options.rateLimitMax
        : process.env.SOCIAL_GATEWAY_RATE_MAX,
      180
    ));
    this.rateBuckets = new Map();
    this.inviteAcceptBuckets = new Map();
    this.server = null;
    this.wsServer = null;
    this.wsClients = new Set();
    this.runtimes = new Map();
    this.sdkApprovalTokens = new Map();
    this.hosted = new HostedPlatform({
      executeSdkAction: (action, params = {}) => this.executeSdkAction(action, params)
    });
  }

  routeIsPublicApi(route) {
    if (API_PUBLIC_ROUTES.has(route)) return true;
    if (String(route || '').startsWith('/api/triggers/webhook/')) return true;
    return String(route || '').startsWith('/api/webchat/public/');
  }

  isApiRoute(route) {
    return String(route || '').startsWith('/api/');
  }

  clientIp(req) {
    return normalizeIp(req?.socket?.remoteAddress || '');
  }

  isLocalClient(req) {
    return isLoopbackIp(this.clientIp(req));
  }

  isLocalBind() {
    return isLoopbackHost(this.host);
  }

  defaultCorsOrigins() {
    return new Set([
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`
    ]);
  }

  isAllowedOrigin(origin) {
    const candidate = String(origin || '').trim();
    if (!candidate) return true;
    const allowed = this.corsOrigins.size > 0
      ? this.corsOrigins
      : (this.isLocalBind() ? this.defaultCorsOrigins() : new Set());
    return allowed.has(candidate);
  }

  applyCors(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    if (!this.isApiRoute(route)) return true;

    const origin = String(req.headers.origin || '').trim();
    if (origin) {
      if (!this.isAllowedOrigin(origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
        return false;
      }
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', DEFAULT_CORS_HEADERS);
      res.setHeader('Access-Control-Allow-Methods', DEFAULT_CORS_METHODS);
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return false;
    }
    return true;
  }

  hasConfiguredRoles() {
    const rolesDoc = opsStorage.getRoles();
    const users = rolesDoc && rolesDoc.users && typeof rolesDoc.users === 'object'
      ? rolesDoc.users
      : {};
    return Object.keys(users).length > 0;
  }

  canBootstrapRoles(req) {
    if (!this.isLocalBind() || !this.isLocalClient(req)) return false;
    return !this.hasConfiguredRoles();
  }

  providedGatewayKey(req, parsedUrl = null) {
    const keyHeader = String(req.headers['x-gateway-key'] || '').trim();
    if (keyHeader) return keyHeader;
    const auth = String(req.headers.authorization || '').trim();
    if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
    if (parsedUrl && parsedUrl.searchParams) {
      const byQuery = String(
        parsedUrl.searchParams.get('gatewayKey') ||
        parsedUrl.searchParams.get('apiKey') ||
        ''
      ).trim();
      if (byQuery) return byQuery;
    }
    return '';
  }

  gatewayAccessDecision(req, provided) {
    const isLocalRequest = this.isLocalClient(req);
    if (!this.apiKey) {
      if (!this.requireApiKey && this.isLocalBind() && isLocalRequest) {
        return { ok: true };
      }
      if (!isLocalRequest || !this.isLocalBind()) {
        return {
          ok: false,
          status: 503,
          error: 'Gateway API key is required for non-local access. Set SOCIAL_GATEWAY_API_KEY.'
        };
      }
      return {
        ok: false,
        status: 503,
        error: 'Gateway API key required. Set SOCIAL_GATEWAY_API_KEY.'
      };
    }

    if (provided && provided !== this.apiKey) {
      return { ok: false, status: 401, error: 'Unauthorized. Invalid x-gateway-key.' };
    }

    if (this.requireApiKey || !isLocalRequest || !this.isLocalBind()) {
      if (provided !== this.apiKey) {
        return { ok: false, status: 401, error: 'Unauthorized. Provide x-gateway-key.' };
      }
    }

    return { ok: true };
  }

  authorizeApi(req, res, route, parsedUrl = null) {
    if (!this.isApiRoute(route) || this.routeIsPublicApi(route)) return true;

    const provided = this.providedGatewayKey(req, parsedUrl);
    const decision = this.gatewayAccessDecision(req, provided);
    if (!decision.ok) {
      sendJson(res, decision.status || 401, { ok: false, error: decision.error || 'Unauthorized.' });
      return false;
    }
    return true;
  }

  providedSessionId(req, parsedUrl = null) {
    const byHeader = String(req.headers['x-session-id'] || '').trim();
    if (byHeader) return byHeader;
    if (parsedUrl && parsedUrl.searchParams) {
      const byQuery = String(parsedUrl.searchParams.get('sessionId') || '').trim();
      if (byQuery) return byQuery;
    }
    return '';
  }

  authorizeWsUpgrade(req, parsedUrl) {
    const origin = String(req.headers.origin || '').trim();
    if (origin && !this.isAllowedOrigin(origin)) {
      return { ok: false, status: 403, error: 'Origin not allowed.' };
    }

    const provided = this.providedGatewayKey(req, parsedUrl);
    const access = this.gatewayAccessDecision(req, provided);
    if (!access.ok) return access;

    const sessionId = this.providedSessionId(req, parsedUrl);
    if (!sessionId) {
      return { ok: false, status: 400, error: 'Missing sessionId for websocket connection.' };
    }

    return { ok: true, sessionId };
  }

  shouldRateLimit(req, route) {
    if (!this.isApiRoute(route)) return false;
    if (this.routeIsPublicApi(route)) return false;
    if (req.method === 'OPTIONS') return false;
    return true;
  }

  rateLimitKey(req, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    const sessionHint = String(
      req.headers['x-session-id'] ||
      parsedUrl.searchParams.get('sessionId') ||
      ''
    ).trim();
    return `${this.clientIp(req) || 'unknown'}|${sessionHint || '-'}|${route}`;
  }

  cleanupRateBuckets(now) {
    if (this.rateBuckets.size < 5000) return;
    for (const [k, b] of this.rateBuckets.entries()) {
      if (!b || b.resetAt <= now) this.rateBuckets.delete(k);
    }
  }

  cleanupInviteAcceptBuckets(now) {
    if (this.inviteAcceptBuckets.size < 5000) return;
    for (const [k, b] of this.inviteAcceptBuckets.entries()) {
      if (!b || b.resetAt <= now) this.inviteAcceptBuckets.delete(k);
    }
  }

  enforceInviteAcceptRateLimit(req, res) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const max = 10;
    this.cleanupInviteAcceptBuckets(now);
    const sessionHint = String(req.headers['x-session-id'] || '').trim() || '-';
    const key = `${this.clientIp(req) || 'unknown'}|${sessionHint}|invite_accept`;
    const existing = this.inviteAcceptBuckets.get(key);
    const bucket = (!existing || existing.resetAt <= now)
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    if (bucket.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      sendJson(res, 429, { ok: false, error: 'Invite accept rate limit exceeded. Retry shortly.' });
      return false;
    }
    bucket.count += 1;
    this.inviteAcceptBuckets.set(key, bucket);
    return true;
  }

  enforceRateLimit(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    if (!this.shouldRateLimit(req, route)) return true;

    const now = Date.now();
    this.cleanupRateBuckets(now);
    const key = this.rateLimitKey(req, parsedUrl);
    const existing = this.rateBuckets.get(key);
    const bucket = (!existing || existing.resetAt <= now)
      ? { count: 0, resetAt: now + this.rateLimitWindowMs }
      : existing;

    if (bucket.count >= this.rateLimitMax) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(this.rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', '0');
      sendJson(res, 429, { ok: false, error: 'Rate limit exceeded. Slow down and retry shortly.' });
      return false;
    }

    bucket.count += 1;
    this.rateBuckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(this.rateLimitMax));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, this.rateLimitMax - bucket.count)));
    return true;
  }

  runtime(sessionId) {
    const key = String(sessionId || '').trim();
    if (!key) return null;
    return this.runtimes.get(key) || null;
  }

  async getOrCreateRuntime(sessionId) {
    const existing = this.runtime(sessionId);
    if (existing) return existing;
    const runtime = new ChatRuntime(sessionId, { debug: this.debug });
    await runtime.load();
    this.runtimes.set(runtime.memory.id, runtime);
    return runtime;
  }

  wsPayload(type, payload = {}) {
    return JSON.stringify({
      type: String(type || 'output'),
      ts: new Date().toISOString(),
      ...payload
    });
  }

  broadcastWs(type, payload = {}) {
    if (!this.wsClients.size) return;
    const targetSessionId = String(payload.sessionId || '').trim();
    const msg = this.wsPayload(type, payload);
    for (const ws of this.wsClients) {
      if (!ws || ws.readyState !== 1) continue;
      const wsSessionId = String(ws.sessionId || '').trim();
      if (targetSessionId && wsSessionId !== targetSessionId) continue;
      try {
        ws.send(msg);
      } catch {
        // ignore transient ws send errors
      }
    }
  }

  emitChatEvents(result = {}) {
    const sessionId = String(result.sessionId || '');
    const response = result.response || {};
    const actions = Array.isArray(response.actions) ? response.actions : [];
    const executed = Array.isArray(result.executed) ? result.executed : [];

    if (response.message) {
      this.broadcastWs('output', { sessionId, data: String(response.message || '') });
    }
    if (actions.length && response.needsInput) {
      this.broadcastWs('plan', {
        sessionId,
        steps: actions.map((step, idx) => ({
          id: idx + 1,
          tool: String(step.tool || ''),
          description: String(step.description || step.tool || ''),
          params: step.params && typeof step.params === 'object' ? step.params : {},
          risk: String(step.risk || '').trim()
        }))
      });
    }
    if (actions.length && !response.needsInput) {
      actions.forEach((_, idx) => {
        const step = actions[idx] || {};
        this.broadcastWs('step_start', {
          sessionId,
          step: idx + 1,
          tool: String(step.tool || ''),
          summary: String(step.description || step.tool || 'Executing step')
        });
      });
    }
    executed.forEach((row, idx) => {
      this.broadcastWs('step_done', {
        sessionId,
        step: idx + 1,
        success: Boolean(row.success),
        summary: row.summary || row.error || row.tool || ''
      });
    });
  }

  cleanupSdkApprovalTokens(now = Date.now()) {
    if (this.sdkApprovalTokens.size < 5000) return;
    for (const [token, entry] of this.sdkApprovalTokens.entries()) {
      if (!entry || Number(entry.expiresAt || 0) <= now) this.sdkApprovalTokens.delete(token);
    }
  }

  issueSdkApprovalToken({ action, risk, params, actorId }) {
    const now = Date.now();
    this.cleanupSdkApprovalTokens(now);
    const token = `ap_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const expiresAt = now + SDK_APPROVAL_TTL_MS;
    this.sdkApprovalTokens.set(token, {
      action: String(action || ''),
      risk: String(risk || ''),
      paramsHash: sdkParamsHash(params || {}),
      actorId: String(actorId || '').trim() || '',
      issuedAt: now,
      expiresAt
    });
    return {
      approvalToken: token,
      approvalTokenExpiresAt: new Date(expiresAt).toISOString()
    };
  }

  consumeSdkApprovalToken({ token, action, params }) {
    const value = String(token || '').trim();
    if (!value) {
      return { ok: false, code: 'APPROVAL_REQUIRED', message: 'Approval token is required for this action.' };
    }
    const row = this.sdkApprovalTokens.get(value);
    if (!row) {
      return { ok: false, code: 'APPROVAL_INVALID', message: 'Approval token is invalid or already used.' };
    }
    if (Number(row.expiresAt || 0) <= Date.now()) {
      this.sdkApprovalTokens.delete(value);
      return { ok: false, code: 'APPROVAL_EXPIRED', message: 'Approval token expired. Request a new plan.' };
    }
    if (String(row.action || '') !== String(action || '')) {
      return { ok: false, code: 'APPROVAL_MISMATCH', message: 'Approval token does not match this action.' };
    }
    if (String(row.paramsHash || '') !== sdkParamsHash(params || {})) {
      return { ok: false, code: 'APPROVAL_MISMATCH', message: 'Approval token does not match current params.' };
    }
    this.sdkApprovalTokens.delete(value);
    return { ok: true, approval: row };
  }

  sdkDoctorSnapshot() {
    const tokens = {
      facebook: Boolean(config.getToken('facebook')),
      instagram: Boolean(config.getToken('instagram')),
      whatsapp: Boolean(config.getToken('whatsapp'))
    };
    const defaultApi = String(config.getDefaultApi ? config.getDefaultApi() : 'facebook').trim() || 'facebook';
    const blockers = [];
    const advisories = [];

    if (!tokens.facebook && !tokens.instagram && !tokens.whatsapp) {
      blockers.push('No API tokens configured. Run `social auth login`.');
    }
    if (defaultApi && !tokens[defaultApi]) {
      blockers.push(`Default API "${defaultApi}" has no token.`);
    }
    if (!config.hasAppCredentials || !config.hasAppCredentials()) {
      advisories.push('App credentials are not configured (needed for some OAuth/debug flows).');
    }
    if (!config.getDefaultMarketingAdAccountId || !config.getDefaultMarketingAdAccountId()) {
      advisories.push('Default ad account is not set.');
    }

    return {
      ok: blockers.length === 0,
      activeProfile: config.getActiveProfile ? config.getActiveProfile() : 'default',
      defaultApi,
      tokens,
      defaults: {
        facebookPageId: config.getDefaultFacebookPageId ? config.getDefaultFacebookPageId() : '',
        whatsappPhoneNumberId: config.getDefaultWhatsAppPhoneNumberId ? config.getDefaultWhatsAppPhoneNumberId() : '',
        marketingAdAccountId: config.getDefaultMarketingAdAccountId ? config.getDefaultMarketingAdAccountId() : ''
      },
      blockers,
      advisories
    };
  }

  requiredToken(apiName) {
    const api = String(apiName || '').trim();
    const token = String(config.getToken ? config.getToken(api) : '').trim();
    if (token) return token;
    if (api === 'whatsapp') {
      throw new Error('Missing WhatsApp token. Run `social auth login -a whatsapp`.');
    }
    throw new Error(`Missing ${api} token. Run \`social auth login -a ${api}\`.`);
  }

  async executeSdkAction(action, params = {}) {
    const normalizedAction = normalizeSdkAction(action);
    if (!normalizedAction) throw new Error(`Unsupported SDK action: ${action}`);

    if (normalizedAction === 'status') {
      return {
        service: 'social-api-gateway',
        version: packageJson.version,
        workspace: config.getActiveProfile() || 'default',
        now: new Date().toISOString(),
        config: configSnapshot()
      };
    }

    if (normalizedAction === 'doctor') {
      return this.sdkDoctorSnapshot();
    }

    if (normalizedAction === 'get_profile') {
      const token = this.requiredToken('facebook');
      const fields = String(params.fields || 'id,name').trim() || 'id,name';
      const client = new MetaAPIClient(token, 'facebook');
      return await client.getMe(fields);
    }

    if (normalizedAction === 'create_post') {
      const userToken = this.requiredToken('facebook');
      const message = String(params.message || '').trim();
      const link = String(params.link || '').trim();
      if (!message && !link) throw new Error('create_post requires `message` or `link`.');

      const userClient = new MetaAPIClient(userToken, 'facebook');
      const pagesResult = await userClient.getFacebookPages(50);
      const pages = asArray(pagesResult?.data);
      if (!pages.length) throw new Error('No Facebook pages available for this token.');

      const requestedPageId = String(
        params.pageId
        || params.page
        || (config.getDefaultFacebookPageId ? config.getDefaultFacebookPageId() : '')
      ).trim();
      const selected = pages.find((row) => String(row?.id || '') === requestedPageId) || pages[0];
      const pageId = String(selected?.id || '').trim();
      const pageAccessToken = String(selected?.access_token || '').trim();
      if (!pageId || !pageAccessToken) {
        throw new Error('Unable to resolve page access token for post creation.');
      }

      const payload = {};
      if (message) payload.message = message;
      if (link) payload.link = link;
      const scheduleValue = parseScheduleToUnixSeconds(params.schedule);
      if (params.schedule && !scheduleValue) {
        throw new Error('Invalid schedule value. Use unix seconds or ISO date.');
      }
      const draft = toBool(params.draft, false);
      if (scheduleValue) {
        payload.published = false;
        payload.scheduled_publish_time = scheduleValue;
      } else if (draft) {
        payload.published = false;
      }

      const pageClient = new MetaAPIClient(pageAccessToken, 'facebook');
      const result = await pageClient.postToPage(pageId, payload);
      return {
        pageId,
        postId: String(result?.id || ''),
        result
      };
    }

    if (normalizedAction === 'list_ads') {
      const token = this.requiredToken('facebook');
      const adAccountId = parseActId(
        params.adAccountId
        || params.accountId
        || (config.getDefaultMarketingAdAccountId ? config.getDefaultMarketingAdAccountId() : '')
      );
      if (!adAccountId) throw new Error('Missing ad account id. Set default or pass `adAccountId`.');
      const limit = Math.max(1, Math.min(200, Number(params.limit || 25) || 25));
      const fields = String(params.fields || 'id,name,objective,status,daily_budget').trim() || 'id,name,objective,status,daily_budget';
      const client = new MetaAPIClient(token, 'facebook');
      const result = await client.get(`/${adAccountId}/campaigns`, { fields, limit });
      return {
        adAccountId,
        count: asArray(result?.data).length,
        result
      };
    }

    if (normalizedAction === 'send_whatsapp') {
      const token = this.requiredToken('whatsapp');
      const from = String(
        params.from
        || params.phoneNumberId
        || (config.getDefaultWhatsAppPhoneNumberId ? config.getDefaultWhatsAppPhoneNumberId() : '')
      ).trim();
      const to = String(params.to || '').trim();
      const body = String(params.body || '').trim();
      if (!from) throw new Error('Missing WhatsApp phone number id (`from`).');
      if (!to) throw new Error('Missing destination number (`to`).');
      if (!body) throw new Error('Missing message body (`body`).');
      const client = new MetaAPIClient(token, 'whatsapp');
      const result = await client.sendWhatsAppMessage(from, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      });
      return {
        from,
        to,
        messageId: String(result?.messages?.[0]?.id || ''),
        result
      };
    }

    if (normalizedAction === 'logs') {
      const limit = Math.max(1, Math.min(100, Number(params.limit || 20) || 20));
      const items = listGatewayActionLogs(limit);
      return {
        count: items.length,
        items
      };
    }

    if (normalizedAction === 'replay') {
      const requestedId = String(params.id || '').trim().toLowerCase();
      const logs = listGatewayActionLogs(200);
      if (!logs.length) throw new Error('No logs available for replay.');
      const target = (requestedId === 'latest' || requestedId === 'last' || !requestedId)
        ? logs[0]
        : logs.find((row) => String(row.id || '').toLowerCase() === requestedId);
      if (!target) throw new Error(`Replay log not found: ${requestedId}`);
      const sourceAction = String(target.action || '').trim();
      const mappedAction = sourceAction.startsWith('sdk:')
        ? normalizeSdkAction(sourceAction.slice(4))
        : (sourceAction === 'get:profile'
          ? 'get_profile'
          : sourceAction === 'create:post'
            ? 'create_post'
            : sourceAction === 'list:ads'
              ? 'list_ads'
              : '');
      if (!mappedAction || mappedAction === 'replay') {
        throw new Error(`Replay unsupported for action ${sourceAction || '<empty>'}`);
      }
      const replayData = await this.executeSdkAction(mappedAction, isPlainObject(target.params) ? target.params : {});
      return {
        replayedLogId: target.id,
        originalAction: sourceAction,
        mappedAction,
        data: replayData
      };
    }

    throw new Error(`No executor for action ${normalizedAction}`);
  }

  async handleApi(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    const requireHostedUser = () => {
      if (!this.hosted || typeof this.hosted.userFromRequest !== 'function') {
        sendJson(res, 500, { ok: false, error: 'Hosted platform is unavailable.' });
        return null;
      }
      const auth = this.hosted.userFromRequest(req);
      if (!auth || !auth.ok) {
        sendJson(res, Number(auth?.status || 401) || 401, { ok: false, error: String(auth?.error || 'Unauthorized') });
        return null;
      }
      return auth.user;
    };

    if (req.method === 'GET' && route === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'social-api-gateway',
        version: packageJson.version,
        now: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/status') {
      sendJson(res, 200, {
        ok: true,
        service: 'social-api-gateway',
        version: packageJson.version,
        workspace: config.getActiveProfile() || 'default',
        now: new Date().toISOString(),
        config: configSnapshot()
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/platform/distribution') {
      sendJson(res, 200, {
        ok: true,
        distribution: this.hosted.distributionModel(),
        architecture: this.hosted.defaultHostedSummary(),
        rest: this.hosted.restCatalog()
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/self-host/admin') {
      sendJson(res, 200, {
        ok: true,
        system: buildSelfHostedAdminSnapshot(this)
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/triggers/webhook') {
      sendJson(res, 400, { ok: false, error: 'Missing webhook token in route. Use /api/triggers/webhook/:token' });
      return;
    }

    const triggerWebhookMatch = route.match(/^\/api\/triggers\/webhook\/([^/]+)$/);
    if (req.method === 'POST' && triggerWebhookMatch) {
      try {
        const token = decodeURIComponent(String(triggerWebhookMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.fireTriggerWebhook(token, body && typeof body === 'object' ? body : {});
        sendJson(res, 200, { ok: true, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/webchat/public/session/start') {
      try {
        const body = await readBody(req);
        const out = await this.hosted.startPublicWebchatSession(body && typeof body === 'object' ? body : {});
        sendJson(res, 200, {
          ok: true,
          session: out.session,
          sessionToken: out.publicToken,
          sessionTokenMask: out.publicTokenMask
        });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/webchat/public/session/message') {
      try {
        const body = await readBody(req);
        const out = await this.hosted.appendPublicWebchatMessage(body && typeof body === 'object' ? body : {});
        sendJson(res, 200, { ok: true, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        const payload = { ok: false, error: String(error?.message || error || '') };
        if (Number(error?.retryAfterMs || 0) > 0) {
          res.setHeader('Retry-After', Math.ceil(Number(error.retryAfterMs) / 1000));
        }
        sendJson(res, status, payload);
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/channels/webchat/widget-keys') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const keys = await this.hosted.listWebchatWidgetKeys(user.id);
        sendJson(res, 200, { ok: true, user, keys });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/channels/webchat/widget-keys') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const key = await this.hosted.createWebchatWidgetKey(user.id, body || {});
        sendJson(res, 200, { ok: true, user, key });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const webchatWidgetDeleteMatch = route.match(/^\/api\/channels\/webchat\/widget-keys\/([^/]+)$/);
    if (req.method === 'DELETE' && webchatWidgetDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const keyId = decodeURIComponent(String(webchatWidgetDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteWebchatWidgetKey(user.id, keyId);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/channels/webchat/sessions') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessions = await this.hosted.listWebchatSessions(user.id, {
          status: String(parsedUrl.searchParams.get('status') || '').trim(),
          limit: Math.max(1, Math.min(500, toNumber(parsedUrl.searchParams.get('limit'), 100)))
        });
        sendJson(res, 200, { ok: true, user, sessions });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/channels/webchat/sessions') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const out = await this.hosted.createWebchatSession(user.id, body || {});
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const webchatMessagesMatch = route.match(/^\/api\/channels\/webchat\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && webchatMessagesMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(webchatMessagesMatch[1] || '').trim());
        const limit = Math.max(1, Math.min(1000, toNumber(parsedUrl.searchParams.get('limit'), 200)));
        const out = await this.hosted.getWebchatSessionMessages(user.id, sessionId, limit);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const webchatReplyMatch = route.match(/^\/api\/channels\/webchat\/sessions\/([^/]+)\/reply$/);
    if (req.method === 'POST' && webchatReplyMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(webchatReplyMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.replyWebchatSession(user.id, sessionId, body || {});
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const webchatStatusMatch = route.match(/^\/api\/channels\/webchat\/sessions\/([^/]+)\/status$/);
    if (req.method === 'POST' && webchatStatusMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(webchatStatusMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.setWebchatSessionStatus(user.id, sessionId, String(body?.status || '').trim());
        sendJson(res, 200, { ok: true, user, session: out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/channels/baileys/sessions') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessions = await this.hosted.listBaileysSessions(user.id, {
          status: String(parsedUrl.searchParams.get('status') || '').trim(),
          limit: Math.max(1, Math.min(500, toNumber(parsedUrl.searchParams.get('limit'), 100)))
        });
        sendJson(res, 200, { ok: true, user, sessions });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/channels/baileys/sessions') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const session = await this.hosted.createBaileysSession(user.id, body || {});
        sendJson(res, 200, { ok: true, user, session });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const baileysConnectMatch = route.match(/^\/api\/channels\/baileys\/sessions\/([^/]+)\/connect$/);
    if (req.method === 'POST' && baileysConnectMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(baileysConnectMatch[1] || '').trim());
        const body = await readBody(req);
        const session = await this.hosted.connectBaileysSession(user.id, sessionId, body || {});
        sendJson(res, 200, { ok: true, user, session });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const baileysDisconnectMatch = route.match(/^\/api\/channels\/baileys\/sessions\/([^/]+)\/disconnect$/);
    if (req.method === 'POST' && baileysDisconnectMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(baileysDisconnectMatch[1] || '').trim());
        const body = await readBody(req);
        const session = await this.hosted.disconnectBaileysSession(user.id, sessionId, body || {});
        sendJson(res, 200, { ok: true, user, session });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const baileysSendMatch = route.match(/^\/api\/channels\/baileys\/sessions\/([^/]+)\/send$/);
    if (req.method === 'POST' && baileysSendMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(baileysSendMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.sendBaileysText(user.id, sessionId, body || {});
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const baileysMessagesMatch = route.match(/^\/api\/channels\/baileys\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && baileysMessagesMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(baileysMessagesMatch[1] || '').trim());
        const limit = Math.max(1, Math.min(1000, toNumber(parsedUrl.searchParams.get('limit'), 200)));
        const out = await this.hosted.getBaileysMessages(user.id, sessionId, limit);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const baileysDeleteMatch = route.match(/^\/api\/channels\/baileys\/sessions\/([^/]+)$/);
    if (req.method === 'DELETE' && baileysDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const sessionId = decodeURIComponent(String(baileysDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteBaileysSession(user.id, sessionId);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/tools') {
      const user = requireHostedUser();
      if (!user) return;
      sendJson(res, 200, { ok: true, user, tools: this.hosted.listTools() });
      return;
    }

    if (req.method === 'GET' && route === '/api/agents') {
      const user = requireHostedUser();
      if (!user) return;
      sendJson(res, 200, { ok: true, user, agents: this.hosted.listAgents(user.id) });
      return;
    }

    if (req.method === 'POST' && route === '/api/agents') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const agent = await this.hosted.upsertUserAgent(user.id, body || {});
        sendJson(res, 200, { ok: true, user, agent });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const agentDeleteMatch = route.match(/^\/api\/agents\/([^/]+)$/);
    if (req.method === 'DELETE' && agentDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const slug = decodeURIComponent(String(agentDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteUserAgent(user.id, slug);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/keys') {
      const user = requireHostedUser();
      if (!user) return;
      const keys = await this.hosted.listVaultKeys(user.id);
      sendJson(res, 200, {
        ok: true,
        user,
        keys,
        services: this.hosted.servicesCatalog()
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/keys') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const saved = await this.hosted.createVaultKey({
          userId: user.id,
          service: body.service,
          key: body.key,
          label: body.label
        });
        sendJson(res, 200, { ok: true, user, key: saved });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const keysDeleteMatch = route.match(/^\/api\/keys\/([^/]+)$/);
    if (req.method === 'DELETE' && keysDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const keyId = decodeURIComponent(String(keysDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteVaultKey({ userId: user.id, keyId });
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/recipes') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const recipes = await this.hosted.listRecipes(user.id);
        sendJson(res, 200, { ok: true, user, recipes });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/recipes') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const recipe = await this.hosted.upsertRecipe(user.id, body || {});
        sendJson(res, 200, { ok: true, user, recipe });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const recipeDeleteMatch = route.match(/^\/api\/recipes\/([^/]+)$/);
    if (req.method === 'DELETE' && recipeDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const slug = decodeURIComponent(String(recipeDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteRecipe(user.id, slug);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const recipeRunMatch = route.match(/^\/api\/recipes\/([^/]+)\/run$/);
    if (req.method === 'POST' && recipeRunMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const slug = decodeURIComponent(String(recipeRunMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.runRecipe({
          userId: user.id,
          slug,
          input: body && typeof body === 'object' ? (body.input || body) : {}
        });
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/triggers') {
      const user = requireHostedUser();
      if (!user) return;
      const triggers = await this.hosted.listTriggers(user.id);
      sendJson(res, 200, { ok: true, user, triggers });
      return;
    }

    if (req.method === 'POST' && route === '/api/triggers') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const trigger = await this.hosted.createTrigger(user.id, body || {});
        sendJson(res, 200, { ok: true, user, trigger });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const triggerDeleteMatch = route.match(/^\/api\/triggers\/([^/]+)$/);
    if (req.method === 'DELETE' && triggerDeleteMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const id = decodeURIComponent(String(triggerDeleteMatch[1] || '').trim());
        const out = await this.hosted.deleteTrigger(user.id, id);
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    const triggerRunMatch = route.match(/^\/api\/triggers\/([^/]+)\/run$/);
    if (req.method === 'POST' && triggerRunMatch) {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const id = decodeURIComponent(String(triggerRunMatch[1] || '').trim());
        const body = await readBody(req);
        const out = await this.hosted.fireTriggerById(user.id, id, body && typeof body === 'object' ? body : {}, 'manual');
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/orchestrate') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const out = await this.hosted.orchestrate({
          task: body.task,
          pipeline: body.pipeline,
          input: body.input,
          mode: body.mode,
          userId: user.id
        });
        sendJson(res, 200, { ok: true, user, ...out });
      } catch (error) {
        const status = Number(error?.status || 400) || 400;
        sendJson(res, status, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/logs') {
      const user = requireHostedUser();
      if (!user) return;
      const limit = Math.max(1, Math.min(500, toNumber(parsedUrl.searchParams.get('limit'), 100)));
      const logs = this.hosted.listLogs({ userId: user.id, limit });
      sendJson(res, 200, { ok: true, user, count: logs.length, logs });
      return;
    }

    if (req.method === 'GET' && route === '/api/usage') {
      const user = requireHostedUser();
      if (!user) return;
      const usage = this.hosted.usageSummary(user.id);
      sendJson(res, 200, { ok: true, user, usage });
      return;
    }

    if (req.method === 'GET' && route === '/api/cli/commands') {
      const user = requireHostedUser();
      if (!user) return;
      sendJson(res, 200, { ok: true, user, commands: this.hosted.listCliCommandCatalog() });
      return;
    }

    if (req.method === 'POST' && route === '/api/cli/execute') {
      const user = requireHostedUser();
      if (!user) return;
      try {
        const body = await readBody(req);
        const args = Array.isArray(body.argv)
          ? body.argv
          : (typeof body.command === 'string' ? body.command : '');
        const out = await this.hosted.executeCli(args, {
          timeoutMs: toNumber(body.timeoutMs, 30_000)
        });
        sendJson(res, 200, { ok: true, user, result: out });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/sdk/status') {
      const traceId = sdkTraceId();
      const action = 'status';
      const risk = sdkRiskForAction(action);
      const data = await this.executeSdkAction(action, {});
      sendJson(res, 200, sdkEnvelopeOk({
        traceId,
        action,
        risk,
        requiresApproval: false,
        data
      }));
      return;
    }

    if (req.method === 'GET' && route === '/api/sdk/doctor') {
      const traceId = sdkTraceId();
      const action = 'doctor';
      const risk = sdkRiskForAction(action);
      const data = await this.executeSdkAction(action, {});
      sendJson(res, 200, sdkEnvelopeOk({
        traceId,
        action,
        risk,
        requiresApproval: false,
        data
      }));
      return;
    }

    if (req.method === 'GET' && route === '/api/sdk/actions') {
      const traceId = sdkTraceId();
      const actions = Object.keys(SDK_ACTION_RISK).map((action) => ({
        action,
        risk: sdkRiskForAction(action),
        requiresApproval: sdkRequiresApproval(action)
      }));
      sendJson(res, 200, sdkEnvelopeOk({
        traceId,
        action: 'actions',
        risk: 'LOW',
        requiresApproval: false,
        data: { actions }
      }));
      return;
    }

    if (req.method === 'POST' && route === '/api/sdk/actions/plan') {
      const traceId = sdkTraceId();
      try {
        const body = await readBody(req);
        const action = normalizeSdkAction(body.action);
        if (!action) {
          const invalid = sdkEnvelopeError({
            traceId,
            status: 400,
            action: String(body.action || ''),
            code: 'INVALID_ACTION',
            message: 'Unsupported action.',
            suggestedNextCommand: 'Use GET /api/sdk/actions to list supported actions.',
            details: { supportedActions: Object.keys(SDK_ACTION_RISK) }
          });
          sendJson(res, invalid.status, invalid.payload);
          return;
        }

        const params = isPlainObject(body.params) ? body.params : {};
        const risk = sdkRiskForAction(action);
        const requiresApproval = sdkRequiresApproval(action);
        let approvalToken = '';
        let approvalTokenExpiresAt = '';
        if (requiresApproval) {
          const issued = this.issueSdkApprovalToken({
            action,
            risk,
            params,
            actorId: resolveRequestActor().id
          });
          approvalToken = issued.approvalToken;
          approvalTokenExpiresAt = issued.approvalTokenExpiresAt;
        }

        sendJson(res, 200, sdkEnvelopeOk({
          traceId,
          action,
          risk,
          requiresApproval,
          approvalToken,
          approvalTokenExpiresAt,
          data: {
            planned: true,
            action,
            params,
            risk,
            requiresApproval,
            approvalToken: approvalToken || null,
            approvalTokenExpiresAt: approvalTokenExpiresAt || null
          }
        }));
      } catch (error) {
        const failed = sdkErrorFromThrown(error, {
          traceId,
          status: 400,
          action: 'plan',
          risk: 'LOW',
          code: 'PLAN_FAILED',
          message: 'Unable to create action plan.'
        });
        sendJson(res, failed.status, failed.payload);
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/sdk/actions/execute') {
      const traceId = sdkTraceId();
      const startedAt = Date.now();
      let actionForLog = '';
      let paramsForLog = {};
      try {
        const body = await readBody(req);
        const action = normalizeSdkAction(body.action);
        actionForLog = action;
        if (!action) {
          const invalid = sdkEnvelopeError({
            traceId,
            status: 400,
            action: String(body.action || ''),
            code: 'INVALID_ACTION',
            message: 'Unsupported action.',
            suggestedNextCommand: 'Use GET /api/sdk/actions to list supported actions.',
            details: { supportedActions: Object.keys(SDK_ACTION_RISK) }
          });
          sendJson(res, invalid.status, invalid.payload);
          return;
        }

        const params = isPlainObject(body.params) ? body.params : {};
        paramsForLog = params;
        const risk = sdkRiskForAction(action);
        const requiresApproval = sdkRequiresApproval(action);
        const approvalTokenIn = String(body.approvalToken || '').trim();
        const approvalReason = String(body.approvalReason || '').trim();

        if (requiresApproval) {
          const consumed = this.consumeSdkApprovalToken({
            token: approvalTokenIn,
            action,
            params
          });
          if (!consumed.ok) {
            const issued = this.issueSdkApprovalToken({
              action,
              risk,
              params,
              actorId: resolveRequestActor().id
            });
            const approvalRequired = sdkEnvelopeError({
              traceId,
              status: 428,
              action,
              risk,
              requiresApproval: true,
              approvalToken: issued.approvalToken,
              approvalTokenExpiresAt: issued.approvalTokenExpiresAt,
              code: consumed.code || 'APPROVAL_REQUIRED',
              message: consumed.message || 'Approval token required.',
              suggestedNextCommand: 'Call /api/sdk/actions/execute again with approvalToken and approvalReason.'
            });
            sendJson(res, approvalRequired.status, approvalRequired.payload);
            return;
          }
          if (risk === 'HIGH' && !approvalReason) {
            const issued = this.issueSdkApprovalToken({
              action,
              risk,
              params,
              actorId: resolveRequestActor().id
            });
            const reasonRequired = sdkEnvelopeError({
              traceId,
              status: 400,
              action,
              risk,
              requiresApproval: true,
              approvalToken: issued.approvalToken,
              approvalTokenExpiresAt: issued.approvalTokenExpiresAt,
              code: 'APPROVAL_REASON_REQUIRED',
              message: 'High-risk actions require approvalReason.',
              suggestedNextCommand: 'Retry /api/sdk/actions/execute with approvalReason.'
            });
            sendJson(res, reasonRequired.status, reasonRequired.payload);
            return;
          }
        }

        const data = await this.executeSdkAction(action, params);
        appendGatewayActionLog({
          action: `sdk:${action}`,
          params,
          latency: Date.now() - startedAt,
          success: true,
          rollback_plan: action === 'create_post'
            ? 'Delete created post if needed.'
            : action === 'send_whatsapp'
              ? 'No rollback for sent messages.'
              : 'Read-only. No rollback required.',
          trace_id: traceId,
          risk
        });
        sendJson(res, 200, sdkEnvelopeOk({
          traceId,
          action,
          risk,
          requiresApproval,
          data
        }));
      } catch (error) {
        const action = normalizeSdkAction(actionForLog) || '';
        const risk = sdkRiskForAction(action) || 'LOW';
        appendGatewayActionLog({
          action: action ? `sdk:${action}` : 'sdk:unknown',
          params: isPlainObject(paramsForLog) ? paramsForLog : {},
          latency: Date.now() - startedAt,
          success: false,
          error: String(error?.message || error || ''),
          rollback_plan: 'No rollback',
          trace_id: traceId,
          risk
        });
        const failed = sdkErrorFromThrown(error, {
          traceId,
          status: 400,
          action,
          risk,
          requiresApproval: sdkRequiresApproval(action),
          code: 'EXECUTION_FAILED',
          message: 'Action execution failed.'
        });
        sendJson(res, failed.status, failed.payload);
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/sessions') {
      sendJson(res, 200, {
        sessions: PersistentMemory.list(50)
      });
      return;
    }

    const replayMatch = route.match(/^\/api\/sessions\/([^/]+)\/replay$/);
    if (req.method === 'GET' && replayMatch) {
      const sessionId = String(replayMatch[1] || '').trim();
      const memory = new PersistentMemory(sessionId);
      if (!memory.exists()) {
        sendJson(res, 404, { ok: false, error: `Session not found: ${sessionId}` });
        return;
      }
      const saved = memory.load() || {};
      const context = saved?.context && typeof saved.context === 'object' ? saved.context : {};
      const limit = Math.max(1, Number(parsedUrl.searchParams.get('limit') || 120));
      sendJson(res, 200, {
        ok: true,
        sessionId,
        updatedAt: saved.updatedAt || '',
        timeline: buildSessionTimeline(context, { limit })
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/config') {
      sendJson(res, 200, {
        config: configSnapshot(),
        readiness: buildReadinessReport(),
        now: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/config/update') {
      try {
        const body = await readBody(req);
        const updated = [];

        const tokens = body.tokens && typeof body.tokens === 'object' ? body.tokens : {};
        ['facebook', 'instagram', 'whatsapp'].forEach((apiName) => {
          if (!Object.prototype.hasOwnProperty.call(tokens, apiName)) return;
          const token = String(tokens[apiName] || '').trim();
          if (!token) return;
          if (typeof config.setToken === 'function') {
            config.setToken(apiName, token);
            updated.push(`tokens.${apiName}`);
          }
        });

        if (Object.prototype.hasOwnProperty.call(body, 'defaultApi')) {
          const nextDefaultApi = String(body.defaultApi || '').trim().toLowerCase();
          if (nextDefaultApi) {
            if (!['facebook', 'instagram', 'whatsapp'].includes(nextDefaultApi)) {
              throw new Error('Invalid defaultApi. Use facebook, instagram, or whatsapp.');
            }
            if (typeof config.setDefaultApi === 'function') {
              config.setDefaultApi(nextDefaultApi);
              updated.push('defaultApi');
            }
          }
        }

        const appPatch = body.app && typeof body.app === 'object' ? body.app : {};
        const setAppId = Object.prototype.hasOwnProperty.call(appPatch, 'appId');
        const setAppSecret = Object.prototype.hasOwnProperty.call(appPatch, 'appSecret');
        if (setAppId || setAppSecret) {
          const currentApp = typeof config.getAppCredentials === 'function'
            ? config.getAppCredentials()
            : { appId: '', appSecret: '' };
          const appId = setAppId ? String(appPatch.appId || '').trim() : String(currentApp.appId || '');
          const appSecret = setAppSecret ? String(appPatch.appSecret || '').trim() : String(currentApp.appSecret || '');
          if (typeof config.setAppCredentials === 'function') {
            config.setAppCredentials(appId, appSecret);
            if (setAppId) updated.push('app.appId');
            if (setAppSecret) updated.push('app.appSecret');
          }
        }

        const agentPatch = body.agent && typeof body.agent === 'object' ? body.agent : {};
        if (Object.prototype.hasOwnProperty.call(agentPatch, 'provider')) {
          const provider = String(agentPatch.provider || '').trim().toLowerCase();
          if (provider && typeof config.setAgentProvider === 'function') {
            config.setAgentProvider(provider);
            updated.push('agent.provider');
          }
        }
        if (Object.prototype.hasOwnProperty.call(agentPatch, 'model')) {
          const model = String(agentPatch.model || '').trim();
          if (model && typeof config.setAgentModel === 'function') {
            config.setAgentModel(model);
            updated.push('agent.model');
          }
        }
        const modelTiers = agentPatch.modelTiers && typeof agentPatch.modelTiers === 'object' ? agentPatch.modelTiers : {};
        ['cheap', 'balanced', 'premium'].forEach((tierName) => {
          if (!Object.prototype.hasOwnProperty.call(modelTiers, tierName)) return;
          const model = String(modelTiers[tierName] || '').trim();
          if (typeof config.setAgentModelTier === 'function') {
            config.setAgentModelTier(tierName, model);
            updated.push(`agent.modelTiers.${tierName}`);
          }
        });
        if (Object.prototype.hasOwnProperty.call(agentPatch, 'apiKey')) {
          const apiKey = String(agentPatch.apiKey || '').trim();
          if (apiKey && typeof config.setAgentApiKey === 'function') {
            config.setAgentApiKey(apiKey);
            updated.push('agent.apiKey');
          }
        }

        const onboardingPatch = body.onboarding && typeof body.onboarding === 'object' ? body.onboarding : {};
        if (Object.prototype.hasOwnProperty.call(onboardingPatch, 'completed')) {
          const completed = toBool(onboardingPatch.completed, true);
          if (completed && typeof config.markOnboardingComplete === 'function') {
            config.markOnboardingComplete({ version: packageJson.version });
            updated.push('onboarding.completed');
          }
          if (!completed && typeof config.clearOnboardingComplete === 'function') {
            config.clearOnboardingComplete();
            updated.push('onboarding.completed');
          }
        }

        if (!updated.length) {
          sendJson(res, 400, { ok: false, error: 'No config changes detected.' });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          updated,
          config: configSnapshot(),
          readiness: buildReadinessReport(),
          now: new Date().toISOString()
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/status') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor();
        const operator = typeof config.getOperator === 'function'
          ? config.getOperator()
          : { id: '', name: '' };
        const actorId = actor.id;
        const role = opsStorage.getRole({ workspace, user: actorId });
        sendJson(res, 200, {
          ok: true,
          workspace,
          operator: { id: actorId, name: operator.name || '' },
          role
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/operator') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const id = String(body.id || '').trim();
        const name = String(body.name || '').trim();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing operator id.' });
          return;
        }
        const actor = resolveRequestActor().id;
        let bootstrapped = false;
        if (this.canBootstrapRoles(req)) {
          opsStorage.setRole({ workspace, user: id, role: 'owner' });
          bootstrapped = true;
        } else {
          opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        }
        const operator = typeof config.setOperator === 'function'
          ? config.setOperator({ id, name })
          : { id, name };
        const role = opsStorage.getRole({ workspace, user: operator.id });
        sendJson(res, 200, { ok: true, workspace, operator, role, bootstrapped });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/operator/clear') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        if (!this.canBootstrapRoles(req)) {
          opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        }
        if (typeof config.clearOperator === 'function') {
          config.clearOperator();
        }
        sendJson(res, 200, { ok: true, workspace });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/role') {
      try {
        const body = await readBody(req);
        const user = String(body.user || '').trim();
        const role = opsRbac.normalizeRole(body.role || '');
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        if (!user) {
          sendJson(res, 400, { ok: false, error: 'Missing user.' });
          return;
        }
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const entry = opsStorage.setRole({ workspace, user, role });
        sendJson(res, 200, { ok: true, workspace, user, role, entry });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/roles') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const rolesDoc = opsStorage.getRoles();
        const usersMap = rolesDoc && typeof rolesDoc === 'object' && rolesDoc.users && typeof rolesDoc.users === 'object'
          ? rolesDoc.users
          : {};
        const roles = Object.entries(usersMap).map(([user, entry]) => {
          const globalRole = String((entry && entry.globalRole) || 'viewer').trim().toLowerCase();
          const workspaceRole = String((entry && entry.workspaces && entry.workspaces[workspace]) || '').trim().toLowerCase();
          const role = workspaceRole || globalRole || 'viewer';
          const scope = workspaceRole ? 'workspace' : 'global';
          return {
            user,
            role,
            scope,
            workspace,
            globalRole: globalRole || 'viewer',
            workspaceRole: workspaceRole || ''
          };
        });
        roles.sort((a, b) => String(a.user || '').localeCompare(String(b.user || '')));
        sendJson(res, 200, { ok: true, workspace, roles });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/invites') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const onlyOpen = toBool(parsedUrl.searchParams.get('open'), false);
        const invites = opsStorage.listInvites({ workspace, includeExpired: !onlyOpen });
        const now = Date.now();
        const rows = onlyOpen
          ? invites.filter((x) => x.status === 'active' && (!x.expiresAt || Date.parse(x.expiresAt) > now))
          : invites;
        sendJson(res, 200, {
          ok: true,
          workspace,
          invites: rows.map((x) => opsStorage.sanitizeInvite(x, false))
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/invites/stats') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const days = Math.max(1, Math.min(365, toNumber(parsedUrl.searchParams.get('days'), 30)));
        const stats = opsStorage.inviteStats({ workspace, days });
        sendJson(res, 200, { ok: true, stats });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/invites') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const role = opsRbac.normalizeRole(body.role || 'viewer');
        const expiresInHours = toNumber(body.expiresInHours, 72);
        let invite = opsStorage.createInvite({ workspace, role, actor, expiresInHours });
        const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
        if (baseUrl) {
          const acceptUrl = `${baseUrl}/?invite=${encodeURIComponent(invite.token)}`;
          invite = opsStorage.setInviteAcceptUrl({ id: invite.id, acceptUrl });
        }
        const invites = opsStorage.listInvites({ workspace, includeExpired: true });
        sendJson(res, 200, {
          ok: true,
          workspace,
          invite: opsStorage.sanitizeInvite(invite, true),
          invites: invites.map((x) => opsStorage.sanitizeInvite(x, false))
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/invites/revoke') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const id = String(body.id || '').trim();
        const token = String(body.token || '').trim();
        if (!id && !token) {
          sendJson(res, 400, { ok: false, error: 'Provide id or token.' });
          return;
        }
        const invite = opsStorage.revokeInvite({ id, token, actor });
        const invites = opsStorage.listInvites({ workspace, includeExpired: true });
        sendJson(res, 200, {
          ok: true,
          workspace,
          invite: opsStorage.sanitizeInvite(invite, false),
          invites: invites.map((x) => opsStorage.sanitizeInvite(x, false))
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/invites/resend') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const id = String(body.id || '').trim();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing invite id.' });
          return;
        }
        const baseUrl = String(body.baseUrl || '').trim();
        const expiresInHours = toNumber(body.expiresInHours, 72);
        const invite = opsStorage.rotateInvite({ id, actor, baseUrl, expiresInHours });
        const invites = opsStorage.listInvites({ workspace, includeExpired: true });
        sendJson(res, 200, {
          ok: true,
          workspace,
          invite: opsStorage.sanitizeInvite(invite, true),
          invites: invites.map((x) => opsStorage.sanitizeInvite(x, false))
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/team/invites/accept') {
      try {
        if (!this.enforceInviteAcceptRateLimit(req, res)) return;
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const user = String(body.user || '').trim();
        const invite = opsStorage.acceptInvite({ token, user });
        sendJson(res, 200, { ok: true, invite: opsStorage.sanitizeInvite(invite, false) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/activity') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const requestActor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: requestActor });
        const actorFilter = String(parsedUrl.searchParams.get('actor') || '').trim();
        const limit = Math.max(1, Math.min(200, toNumber(parsedUrl.searchParams.get('limit'), 50)));
        const from = parseIsoDate(parsedUrl.searchParams.get('from'));
        const to = parseIsoDate(parsedUrl.searchParams.get('to'));
        let rows = opsStorage.listActionLog(workspace);
        if (actorFilter) rows = rows.filter((x) => String(x.actor || '') === actorFilter);
        if (from) rows = rows.filter((x) => Number.isFinite(Date.parse(x.createdAt || '')) && Date.parse(x.createdAt) >= Number(from));
        if (to) rows = rows.filter((x) => Number.isFinite(Date.parse(x.createdAt || '')) && Date.parse(x.createdAt) <= Number(to));
        rows = rows.slice(-limit).reverse();
        sendJson(res, 200, { ok: true, workspace, activity: rows });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/team/activity/export') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const requestActor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: requestActor });
        const actorFilter = String(parsedUrl.searchParams.get('actor') || '').trim();
        const format = String(parsedUrl.searchParams.get('format') || 'json').trim().toLowerCase();
        const limit = Math.max(1, Math.min(1000, toNumber(parsedUrl.searchParams.get('limit'), 200)));
        const from = parseIsoDate(parsedUrl.searchParams.get('from'));
        const to = parseIsoDate(parsedUrl.searchParams.get('to'));
        let rows = opsStorage.listActionLog(workspace);
        if (actorFilter) rows = rows.filter((x) => String(x.actor || '') === actorFilter);
        if (from) rows = rows.filter((x) => Number.isFinite(Date.parse(x.createdAt || '')) && Date.parse(x.createdAt) >= Number(from));
        if (to) rows = rows.filter((x) => Number.isFinite(Date.parse(x.createdAt || '')) && Date.parse(x.createdAt) <= Number(to));
        rows = rows.slice(-limit).reverse();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        if (format === 'csv') {
          const csv = teamActivityToCsv(rows);
          sendText(res, 200, csv, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="team-activity-${workspace}-${stamp}.csv"`
          });
          return;
        }
        if (format !== 'json') {
          sendJson(res, 400, { ok: false, error: 'Invalid format. Use json or csv.' });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          workspace,
          exportedAt: new Date().toISOString(),
          filters: {
            actor: actorFilter || '',
            from: from ? from.toISOString() : '',
            to: to ? to.toISOString() : '',
            limit
          },
          activity: rows
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/policy/region') {
      try {
        const body = await readBody(req);
        const patch = {};
        if (body.country !== undefined) patch.country = String(body.country || '').trim().toUpperCase();
        if (body.timezone !== undefined) patch.timezone = String(body.timezone || '').trim();
        if (body.regulatoryMode !== undefined) patch.regulatoryMode = String(body.regulatoryMode || '').trim().toLowerCase();
        if (body.useCase !== undefined) patch.useCase = String(body.useCase || '').trim().toLowerCase();
        if (body.policyProfile !== undefined) patch.policyProfile = String(body.policyProfile || '').trim().toLowerCase();
        const region = typeof config.setRegionConfig === 'function'
          ? config.setRegionConfig(patch)
          : { country: '', timezone: '', regulatoryMode: 'standard', useCase: 'general', policyProfile: 'default' };
        sendJson(res, 200, { ok: true, profile: config.getActiveProfile() || 'default', region });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/policy/preflight') {
      try {
        const body = await readBody(req);
        const action = String(body.action || parseIntent(String(body.intent || '')) || '').trim();
        const region = typeof config.getRegionConfig === 'function'
          ? config.getRegionConfig()
          : { country: '', timezone: '', regulatoryMode: 'standard', useCase: 'general', policyProfile: 'default' };
        const report = preflightFor({
          action,
          region,
          useCase: String(body.useCase || region.useCase || '').trim().toLowerCase()
        });
        sendJson(res, 200, { ok: true, report });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/integrations/waba/status') {
      const waba = typeof config.getWabaIntegration === 'function'
        ? config.getWabaIntegration()
        : {};
      const includeDoctor = toBool(parsedUrl.searchParams.get('doctor'), false);
      if (!includeDoctor) {
        sendJson(res, 200, {
          ok: true,
          profile: config.getActiveProfile() || 'default',
          integration: waba
        });
        return;
      }
      try {
        const token = String(config.getToken('whatsapp') || '').trim();
        if (!token) {
          sendJson(res, 200, {
            ok: true,
            profile: config.getActiveProfile() || 'default',
            integration: waba,
            doctor: {
              ok: false,
              checks: [{ key: 'token_valid', ok: false, detail: 'No WhatsApp token configured.' }]
            }
          });
          return;
        }
        const report = await wabaDoctorReport({
          token,
          businessId: waba.businessId,
          wabaId: waba.wabaId,
          phoneNumberId: waba.phoneNumberId,
          callbackUrl: waba.webhookCallbackUrl,
          verifyToken: waba.webhookVerifyToken,
          testTo: ''
        });
        sendJson(res, 200, {
          ok: true,
          profile: config.getActiveProfile() || 'default',
          integration: waba,
          doctor: report
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/integrations/waba/connect') {
      try {
        const body = await readBody(req);
        const token = String(body.token || config.getToken('whatsapp') || '').trim();
        if (!token) {
          sendJson(res, 400, { ok: false, error: 'Missing WhatsApp token.' });
          return;
        }
        const client = new MetaAPIClient(token, 'whatsapp');
        const businessId = String(body.businessId || '').trim();
        let wabaId = String(body.wabaId || '').trim();
        if (!wabaId) {
          wabaId = await resolveWabaId(client, businessId);
        }
        let phoneNumberId = String(body.phoneNumberId || '').trim();
        if (!phoneNumberId) {
          phoneNumberId = await resolvePhoneNumberId(client, wabaId);
        }
        const callbackUrl = String(body.webhookCallbackUrl || '').trim();
        const verifyToken = String(body.webhookVerifyToken || '').trim();
        const testTo = String(body.testTo || '').trim();

        const doctor = await wabaDoctorReport({
          token,
          businessId,
          wabaId,
          phoneNumberId,
          callbackUrl,
          verifyToken,
          testTo
        });

        config.setToken('whatsapp', token);
        if (phoneNumberId) {
          config.setDefaultWhatsAppPhoneNumberId(phoneNumberId);
        }
        const integration = typeof config.setWabaIntegration === 'function'
          ? config.setWabaIntegration({
            connected: Boolean(doctor.ok),
            businessId,
            wabaId,
            phoneNumberId,
            webhookCallbackUrl: callbackUrl,
            webhookVerifyToken: verifyToken,
            connectedAt: new Date().toISOString(),
            provider: 'meta'
          })
          : {};

        sendJson(res, 200, {
          ok: true,
          profile: config.getActiveProfile() || 'default',
          integration,
          doctor
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/integrations/waba/disconnect') {
      try {
        const body = await readBody(req);
        const clearToken = toBool(body.clearToken, false);
        const before = typeof config.getWabaIntegration === 'function'
          ? config.getWabaIntegration()
          : {};
        if (typeof config.clearWabaIntegration === 'function') {
          config.clearWabaIntegration();
        }
        if (clearToken && typeof config.removeToken === 'function') {
          config.removeToken('whatsapp');
        }
        sendJson(res, 200, {
          ok: true,
          profile: config.getActiveProfile() || 'default',
          before,
          clearToken
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/chat/start') {
      try {
        const body = await readBody(req);
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        await runtime.save();
        sendJson(res, 200, {
          sessionId: runtime.memory.id,
          resumed: runtime.resumed,
          summary: runtime.context.getSummary(),
          history: runtime.context.getHistory(30),
          timeline: runtime.context.getTimeline(120)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/chat/message') {
      let sessionId = '';
      try {
        const body = await readBody(req);
        sessionId = String(body.sessionId || '').trim();
        const msg = String(body.message || '').trim();
        if (!msg) {
          sendJson(res, 400, { ok: false, error: 'Missing message.' });
          return;
        }
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        const result = await runtime.processMessage(msg);
        this.emitChatEvents(result);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        this.broadcastWs('error', {
          sessionId,
          message: String(error?.message || error || '')
        });
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ai') {
      let sessionId = '';
      try {
        const body = await readBody(req);
        sessionId = String(body.sessionId || '').trim();
        const msg = String(body.message || '').trim();
        if (!msg) {
          sendJson(res, 400, { ok: false, error: 'Missing message.' });
          return;
        }
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        const result = await runtime.processMessage(msg);
        this.emitChatEvents(result);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        this.broadcastWs('error', {
          sessionId,
          message: String(error?.message || error || '')
        });
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/execute') {
      let sessionId = '';
      try {
        const body = await readBody(req);
        sessionId = String(body.sessionId || '').trim();
        const plan = body.plan && Array.isArray(body.plan.steps) ? body.plan.steps : [];
        if (!plan.length) {
          sendJson(res, 400, { ok: false, error: 'Missing plan.steps.' });
          return;
        }
        const runtime = await this.getOrCreateRuntime(body.sessionId);
        const actions = plan.map((step) => ({
          tool: String(step.tool || '').trim(),
          params: step.params && typeof step.params === 'object' ? step.params : {},
          description: String(step.description || step.tool || '').trim()
        })).filter((a) => a.tool);
        if (!actions.length) {
          sendJson(res, 400, { ok: false, error: 'No executable plan steps.' });
          return;
        }
        this.broadcastWs('plan', {
          sessionId: runtime.memory.id,
          steps: actions.map((a, idx) => ({ id: idx + 1, ...a }))
        });
        const executed = await runtime.executeActions(actions);
        await runtime.save();
        executed.forEach((row, idx) => {
          this.broadcastWs('step_done', {
            sessionId: runtime.memory.id,
            step: idx + 1,
            success: Boolean(row.success),
            summary: row.summary || row.error || row.tool || ''
          });
        });
        sendJson(res, 200, {
          ok: true,
          sessionId: runtime.memory.id,
          executed,
          summary: runtime.context.getSummary(),
          history: runtime.context.getHistory(40),
          timeline: runtime.context.getTimeline(120)
        });
      } catch (error) {
        this.broadcastWs('error', {
          sessionId,
          message: String(error?.message || error || '')
        });
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/cancel') {
      sendJson(res, 200, {
        ok: true,
        cancelled: false,
        message: 'No active long-running job to cancel in this gateway build.'
      });
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/summary') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || '';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace: workspace || config.getActiveProfile() || 'default', action: 'read', user: actor });
        sendJson(res, 200, {
          ok: true,
          ...opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/readiness') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const report = readinessReport({
          workspace,
          gatewayApiKeyConfigured: Boolean(this.apiKey)
        });
        sendJson(res, 200, { ok: true, report });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/onboard/workspace') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        opsStorage.ensureWorkspace(workspace);
        const existing = opsStorage.listSchedules(workspace).find((s) => s.workflow === 'morning_ops');
        const runAt = String(body.runAt || new Date().toISOString());
        const schedule = existing || opsStorage.addSchedule(workspace, {
          name: 'Daily Morning Ops',
          workflow: 'morning_ops',
          runAt,
          repeat: 'daily',
          enabled: true,
          payload: {}
        });
        sendJson(res, 200, { ok: true, workspace, schedule });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/workspace/template') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const applied = opsStorage.applyWorkspaceTemplate({
          workspace,
          template: String(body.template || 'agency_default').trim().toLowerCase(),
          actor,
          runAt: body.runAt
        });
        sendJson(res, 200, { ok: true, ...applied });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/workspace/role-preset') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const applied = opsStorage.applyRolePreset({
          workspace,
          preset: String(body.preset || 'core').trim().toLowerCase(),
          actor,
          users: body.users && typeof body.users === 'object' ? body.users : {}
        });
        sendJson(res, 200, { ok: true, ...applied });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/onboarding/complete') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'admin', user: actor });
        const completedAt = toBool(body.completed, true) ? new Date().toISOString() : '';
        const state = opsStorage.setState(workspace, { onboardingCompletedAt: completedAt });
        const report = readinessReport({
          workspace,
          gatewayApiKeyConfigured: Boolean(this.apiKey)
        });
        sendJson(res, 200, { ok: true, workspace, state, report });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/report/weekly') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const days = Math.max(1, Math.min(30, toNumber(body.days, 7)));
        const outDir = resolveSafeOutDir(body.outDir, 'reports');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outPath = path.join(outDir, `${workspace}-weekly-${stamp}.md`);
        const report = buildWeeklyOpsReport({ workspace, days });
        fs.writeFileSync(outPath, report, 'utf8');
        sendJson(res, 200, {
          ok: true,
          workspace,
          days,
          reportPath: outPath
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/handoff/pack') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        const template = normalizeHandoffTemplate(body.template || 'agency');
        if (!template) {
          sendJson(res, 400, { ok: false, error: 'Invalid template. Use simple, agency, enterprise.' });
          return;
        }
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const generatedAt = new Date().toISOString();
        const runAtIso = toIsoOrFallback(body.runAt, generatedAt);
        const outDir = resolveSafeOutDir(body.outDir, `reports/handoff-${workspace}`);
        fs.mkdirSync(outDir, { recursive: true });
        const files = {
          handoff: path.join(outDir, 'handoff.md'),
          runbook: path.join(outDir, 'runbook.md'),
          accessMatrix: path.join(outDir, 'access-matrix.csv'),
          incidentPlaybook: path.join(outDir, 'incident-playbook.md')
        };
        fs.writeFileSync(files.handoff, buildHandoffDoc({
          template,
          workspace,
          studioUrl: String(body.studioUrl || 'http://127.0.0.1:1310').trim(),
          gatewayApiKey: String(body.gatewayApiKey || '').trim(),
          operatorId: String(body.operatorId || '').trim(),
          runAtIso,
          generatedAt
        }), 'utf8');
        fs.writeFileSync(files.runbook, buildRunbookDoc({ workspace, generatedAt }), 'utf8');
        fs.writeFileSync(files.accessMatrix, buildAccessMatrixCsv({ workspace }), 'utf8');
        fs.writeFileSync(files.incidentPlaybook, buildIncidentPlaybookDoc({ workspace, generatedAt }), 'utf8');
        sendJson(res, 200, { ok: true, workspace, template, outDir, files });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/handoff/file') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const rawPath = String(parsedUrl.searchParams.get('path') || '').trim();
        if (!rawPath) {
          sendJson(res, 400, { ok: false, error: 'Missing path.' });
          return;
        }
        const resolved = path.resolve(rawPath);
        const allowRoots = gatewayRoots();
        const allowed = allowRoots.some((root) => isPathInsideRoot(root, resolved));
        if (!allowed) {
          sendJson(res, 400, { ok: false, error: 'Path not allowed.' });
          return;
        }
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          sendJson(res, 404, { ok: false, error: 'File not found.' });
          return;
        }
        const fileName = path.basename(resolved);
        const content = fs.readFileSync(resolved, 'utf8');
        sendText(res, 200, content, {
          'Content-Type': mimeFor(resolved),
          'Content-Disposition': `attachment; filename="${fileName}"`
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/alerts') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const onlyOpen = toBool(parsedUrl.searchParams.get('open'), false);
        let alerts = opsStorage.listAlerts(workspace);
        if (onlyOpen) alerts = alerts.filter((x) => x.status === 'open');
        sendJson(res, 200, { ok: true, workspace, alerts });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/approvals') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const onlyOpen = toBool(parsedUrl.searchParams.get('open'), false);
        let approvals = opsStorage.listApprovals(workspace);
        if (onlyOpen) approvals = approvals.filter((x) => x.status === 'pending');
        sendJson(res, 200, { ok: true, workspace, approvals });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/guard/policy') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const guardPolicy = opsStorage.getGuardPolicy(workspace);
        sendJson(res, 200, { ok: true, workspace, guardPolicy });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/guard/policy') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'guard_config', user: actor });
        const patch = guardPolicyPatchFromBody(body);
        const guardPolicy = opsStorage.setGuardPolicy(workspace, patch);
        sendJson(res, 200, {
          ok: true,
          workspace,
          guardPolicy,
          snapshot: opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/guard/mode') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'guard_config', user: actor });
        const mode = normalizeGuardMode(body.mode);
        if (!mode) {
          sendJson(res, 400, { ok: false, error: 'Invalid guard mode. Use observe, approval, or auto_safe.' });
          return;
        }
        const guardPolicy = opsStorage.setGuardPolicy(workspace, { mode });
        sendJson(res, 200, {
          ok: true,
          workspace,
          mode: guardPolicy.mode,
          guardPolicy,
          snapshot: opsSummary(workspace)
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/morning-run') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'execute', user: actor });
        const spend = toNumber(body.spend, 0);
        const force = toBool(body.force, false);
        const result = opsWorkflows.runMorningOps({
          workspace,
          config,
          spend,
          force,
          actor
        });
        sendJson(res, 200, { ok: true, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/schedule/run-due') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'execute', user: actor });
        const result = opsWorkflows.runDueSchedules({ workspace, config, actor });
        sendJson(res, 200, { ok: true, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/alerts/ack') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'write', user: actor });
        const id = String(body.id || '').trim();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing alert id.' });
          return;
        }
        const alert = opsStorage.ackAlert(workspace, id);
        sendJson(res, 200, { ok: true, alert, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/approvals/resolve') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const id = String(body.id || '').trim();
        const decision = String(body.decision || '').trim().toLowerCase();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing approval id.' });
          return;
        }
        if (decision !== 'approve' && decision !== 'reject') {
          sendJson(res, 400, { ok: false, error: 'Decision must be "approve" or "reject".' });
          return;
        }
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'approve', user: actor });
        const approval = opsWorkflows.resolveApproval({
          workspace,
          approvalId: id,
          decision,
          note: body.note || '',
          actor
        });
        sendJson(res, 200, { ok: true, actor, approval, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'GET' && route === '/api/ops/sources') {
      try {
        const workspace = parsedUrl.searchParams.get('workspace') || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'read', user: actor });
        const sources = opsStorage.listSources(workspace);
        sendJson(res, 200, { ok: true, workspace, sources });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/sources/upsert') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'write', user: actor });
        const patch = sourcePatchFromBody(body);
        if (!patch.name) {
          sendJson(res, 400, { ok: false, error: 'Source name is required.' });
          return;
        }
        if (!patch.connector) {
          sendJson(res, 400, { ok: false, error: 'Connector is required.' });
          return;
        }
        const source = opsStorage.upsertSource(workspace, patch);
        sendJson(res, 200, { ok: true, workspace, source, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    if (req.method === 'POST' && route === '/api/ops/sources/sync') {
      try {
        const body = await readBody(req);
        const workspace = body.workspace || config.getActiveProfile() || 'default';
        const actor = resolveRequestActor().id;
        opsRbac.assertCan({ workspace, action: 'execute', user: actor });
        let sourceIds = [];
        if (Array.isArray(body.sourceIds)) {
          sourceIds = body.sourceIds.map((x) => String(x || '').trim()).filter(Boolean);
        } else if (body.id !== undefined) {
          const one = String(body.id || '').trim();
          if (one) sourceIds = [one];
        }
        const result = opsWorkflows.syncSources({
          workspace,
          sourceIds: sourceIds.length ? sourceIds : null,
          config,
          actor
        });
        sendJson(res, 200, { ok: true, workspace, result, snapshot: opsSummary(workspace) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message || error || '') });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Route not found.' });
  }

  async handleStatic(req, res, parsedUrl) {
    const route = parsedUrl.pathname || '/';
    const isStudioHomeRoute = route === '/studio'
      || route === '/studio/';
    const isStudioAppRoute = route === '/studio/app/'
      || route.startsWith('/studio/app/');
    if (isStudioHomeRoute) {
      res.writeHead(302, {
        Location: '/studio/app/',
        'Cache-Control': 'no-store'
      });
      res.end();
      return;
    }

    if (route === '/studio/app') {
      res.writeHead(302, {
        Location: '/studio/app/',
        'Cache-Control': 'no-store'
      });
      res.end();
      return;
    }

    let assetRoute = route;
    if (route === '/studio/app/') {
      assetRoute = '/';
    } else if (route.startsWith('/studio/app/')) {
      assetRoute = route.slice('/studio/app'.length);
    }

    if (route === '/' || route === '/index.html') {
      sendJson(res, 410, {
        ok: false,
        error: 'Root route is disabled. Open /studio or /studio/app/ for Studio, or /api/status?doctor=1 for diagnostics.'
      });
      return;
    }

    if (isStudioAppRoute) {
      const staticFile = resolveStudioAsset(assetRoute);
      if (staticFile) {
        const isHtml = staticFile.toLowerCase().endsWith('.html');
        sendFile(res, 200, staticFile, {
          'Cache-Control': isHtml ? 'no-store' : 'public, max-age=300'
        });
        return;
      }
      sendJson(res, 404, studioUiMissingPayload());
      return;
    }
    sendJson(res, 404, {
      ok: false,
      error: 'Route not found. Use /api/* endpoints.'
    });
  }

  async requestHandler(req, res) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (parsedUrl.pathname.startsWith('/api/')) {
      const route = parsedUrl.pathname || '/';
      if (!this.applyCors(req, res, parsedUrl)) return;
      if (!this.authorizeApi(req, res, route, parsedUrl)) return;
      if (!this.enforceRateLimit(req, res, parsedUrl)) return;
      await this.handleApi(req, res, parsedUrl);
      return;
    }
    await this.handleStatic(req, res, parsedUrl);
  }

  async start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      this.requestHandler(req, res).catch((error) => {
        sendJson(res, 500, { ok: false, error: String(error?.message || error || '') });
      });
    });
    this.wsServer = new WebSocketServer({ noServer: true });
    this.wsServer.on('connection', (ws, req) => {
      const parsedUrl = new URL(req.url || '/', 'http://localhost');
      ws.sessionId = this.providedSessionId(req, parsedUrl);
      this.wsClients.add(ws);
      ws.send(this.wsPayload('output', {
        sessionId: ws.sessionId,
        data: 'ws connected'
      }));
      ws.on('close', () => {
        this.wsClients.delete(ws);
      });
      ws.on('error', () => {
        this.wsClients.delete(ws);
      });
    });
    this.server.on('upgrade', (req, socket, head) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        if (parsedUrl.pathname !== '/ws') {
          socket.destroy();
          return;
        }
        const auth = this.authorizeWsUpgrade(req, parsedUrl);
        if (!auth.ok) {
          socket.destroy();
          return;
        }
        req.headers['x-session-id'] = auth.sessionId;
        this.wsServer.handleUpgrade(req, socket, head, (ws) => {
          this.wsServer.emit('connection', ws, req);
        });
      } catch {
        socket.destroy();
      }
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => resolve());
    });
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    this.port = port;
    this.startedAt = new Date().toISOString();
    if (this.hosted && typeof this.hosted.start === 'function') {
      this.hosted.start();
    }
  }

  async stop() {
    if (this.hosted && typeof this.hosted.stop === 'function') {
      await this.hosted.stop();
    }
    if (this.wsServer) {
      for (const ws of this.wsClients) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      this.wsClients.clear();
      await new Promise((resolve) => this.wsServer.close(() => resolve()));
      this.wsServer = null;
    }
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
    this.startedAt = '';
  }

  url() {
    return `http://${this.host}:${this.port}`;
  }
}

function createGatewayServer(options = {}) {
  return new GatewayServer(options);
}

module.exports = {
  createGatewayServer,
  GatewayServer
};

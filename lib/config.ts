const fs = require('fs');
const os = require('os');
const path = require('path');
const chalk = require('chalk');
const appPaths = require('./app-paths');
const { renderPanel, formatBadge, kv, formatTokenPreview } = require('./ui/chrome');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sanitizeProfileName(name) {
  const raw = String(name || '').trim();
  const trimmed = raw.startsWith('@') ? raw.slice(1) : raw;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'default';
}

const INDUSTRY_IDS = [
  'real_estate_india',
  'real_estate_uae',
  'ecommerce',
  'edtech',
  'healthcare',
  'local_services'
];
const INDUSTRY_MODES = ['hybrid', 'auto', 'manual'];

function normalizeIndustryId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if ([
    'real_estate',
    'real-estate',
    'realestate',
    'property',
    'real_estate_india',
    'real-estate-india',
    'realestateindia',
    'property_india',
    'india_property',
    're_india'
  ].includes(raw)) return 'real_estate_india';
  if ([
    'real_estate_uae',
    'real-estate-uae',
    'realestateuae',
    'property_uae',
    'uae_property',
    'dubai_property',
    're_uae'
  ].includes(raw)) return 'real_estate_uae';
  if (['ecommerce', 'e-commerce', 'commerce'].includes(raw)) return 'ecommerce';
  if (['edtech', 'education', 'course', 'courses'].includes(raw)) return 'edtech';
  if (['healthcare', 'clinic', 'health'].includes(raw)) return 'healthcare';
  if (['local_services', 'local', 'services'].includes(raw)) return 'local_services';
  return INDUSTRY_IDS.includes(raw) ? raw : '';
}

function normalizeIndustryMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  return INDUSTRY_MODES.includes(raw) ? raw : 'hybrid';
}

function legacyIndustryId(value) {
  const normalized = normalizeIndustryId(value);
  if (!normalized) return '';
  if (normalized === 'real_estate_india' || normalized === 'real_estate_uae') return 'real_estate';
  return normalized;
}

function sanitizeAdAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9._:-]/g, '');
}

class ConfigManager {
  constructor() {
    // Allow overriding config location for CI/tests or portable setups.
    // SOCIAL_FLOW_HOME points to the app state directory directly.
    // SOCIAL_CLI_HOME and META_CLI_HOME remain supported as legacy home-root overrides.
    this.homeRoot = appPaths.legacyHomeRoot(process.env, os.homedir());
    this.dir = appPaths.ensureAppHome(process.env, os.homedir());
    this.file = path.join(this.dir, 'config.json');
    this.legacyFiles = appPaths
      .candidatePaths(['config.json'], process.env, os.homedir())
      .filter((candidate) => candidate !== this.file);
    this.data = null;
    this._activeProfileOverride = '';
    this._load();
  }

  _defaultsProfile() {
    return {
      apiVersion: 'v20.0',
      defaultApi: 'facebook',
      agent: {
        provider: 'openai',
        model: '',
        apiKey: '',
        modelTiers: {
          cheap: '',
          balanced: '',
          premium: ''
        }
      },
      tokens: {
        facebook: '',
        instagram: '',
        whatsapp: ''
      },
      app: {
        id: '',
        secret: ''
      },
      defaults: {
        facebookPageId: '',
        igUserId: '',
        whatsappPhoneNumberId: '',
        marketingAdAccountId: ''
      },
      region: {
        country: '',
        timezone: '',
        regulatoryMode: 'standard',
        useCase: 'general',
        policyProfile: 'default'
      },
      integrations: {
        waba: {
          connected: false,
          businessId: '',
          wabaId: '',
          phoneNumberId: '',
          webhookCallbackUrl: '',
          webhookVerifyToken: '',
          connectedAt: '',
          provider: ''
        }
      },
      onboarding: {
        completedAt: '',
        version: ''
      },
      industry: {
        mode: 'hybrid',
        selected: '',
        source: '',
        confidence: 0,
        detectorVersion: '',
        detectedAt: '',
        manualLocked: false,
        accountOverrides: {}
      }
    };
  }

  _defaults() {
    return {
      activeProfile: 'default',
      operator: {
        id: '',
        name: ''
      },
      profiles: {
        default: this._defaultsProfile()
      }
    };
  }

  _mergeProfile(existingProfile) {
    const d = this._defaultsProfile();
    const p = existingProfile || {};
    return {
      ...d,
      ...p,
      agent: {
        ...d.agent,
        ...(p.agent || {}),
        modelTiers: {
          ...(d.agent || {}).modelTiers,
          ...(((p.agent || {}).modelTiers) || {})
        }
      },
      tokens: { ...d.tokens, ...(p.tokens || {}) },
      app: { ...d.app, ...(p.app || {}) },
      defaults: { ...d.defaults, ...(p.defaults || {}) },
      region: { ...d.region, ...(p.region || {}) },
      industry: {
        ...d.industry,
        ...(p.industry || {}),
        accountOverrides: {
          ...(d.industry || {}).accountOverrides,
          ...(((p.industry || {}).accountOverrides) || {})
        }
      },
      integrations: {
        ...d.integrations,
        ...(p.integrations || {}),
        waba: {
          ...(d.integrations || {}).waba,
          ...((p.integrations || {}).waba || {})
        }
      },
      onboarding: {
        ...d.onboarding,
        ...(p.onboarding || {})
      }
    };
  }

  _load() {
    try {
      ensureDir(this.dir);
    } catch {
      // Fall back to the first writable legacy app directory only if the new path is denied.
      const fallbackDir = appPaths
        .legacyAppHomes(process.env, os.homedir())
        .find((candidate) => {
          try {
            ensureDir(candidate);
            return true;
          } catch {
            return false;
          }
        });
      if (fallbackDir) this.dir = fallbackDir;
      this.file = path.join(this.dir, 'config.json');
      this.legacyFiles = (this.legacyFiles || []).filter((candidate) => candidate !== this.file);
      ensureDir(this.dir);
    }
    let existing = readJson(this.file);
    if (!existing) {
      this.legacyFiles.some((candidate) => {
        existing = readJson(candidate);
        return Boolean(existing);
      });
      if (existing) writeJsonAtomic(this.file, existing);
    }

    if (!existing) {
      this.data = this._defaults();
      writeJsonAtomic(this.file, this.data);
      return;
    }

    // New schema: { activeProfile, profiles: { name: profileData } }
    if (existing.profiles && typeof existing.profiles === 'object') {
      const d = this._defaults();
      const profiles = {};
      Object.keys(existing.profiles).forEach((k) => {
        profiles[sanitizeProfileName(k)] = this._mergeProfile(existing.profiles[k]);
      });
      const active = sanitizeProfileName(existing.activeProfile || d.activeProfile);
      if (!profiles[active]) profiles[active] = this._defaultsProfile();

      this.data = {
        ...d,
        ...existing,
        activeProfile: active,
        profiles
      };
      return;
    }

    // Legacy schema (top-level fields): migrate into profiles.default.
    const d = this._defaults();
    const migratedProfile = this._mergeProfile({
      apiVersion: existing.apiVersion,
      defaultApi: existing.defaultApi,
      agent: existing.agent,
      tokens: existing.tokens,
      app: existing.app,
      defaults: existing.defaults
    });

    this.data = {
      ...d,
      activeProfile: 'default',
      profiles: { default: migratedProfile }
    };
  }

  _save() {
    writeJsonAtomic(this.file, this.data);
  }

  // Paths
  getConfigPath() {
    return this.file;
  }

  // Profiles
  listProfiles() {
    return Object.keys(this.data.profiles || {}).sort();
  }

  hasProfile(name) {
    const n = sanitizeProfileName(name);
    return Boolean((this.data.profiles || {})[n]);
  }

  createProfile(name) {
    const n = sanitizeProfileName(name);
    this.data.profiles = this.data.profiles || {};
    if (this.data.profiles[n]) {
      throw new Error(`Profile already exists: ${n}`);
    }
    this.data.profiles[n] = this._defaultsProfile();
    this._save();
    return n;
  }

  deleteProfile(name) {
    const n = sanitizeProfileName(name);
    const active = this.getActiveProfile();
    if (n === active) throw new Error('Cannot delete the active profile. Switch first.');
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    delete this.data.profiles[n];
    this._save();
  }

  setActiveProfile(name) {
    const n = sanitizeProfileName(name);
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    this.data.activeProfile = n;
    this._save();
  }

  getActiveProfile() {
    const rawOverride = String(this._activeProfileOverride || '').trim();
    if (rawOverride) {
      const override = sanitizeProfileName(rawOverride);
      if (this.hasProfile(override)) return override;
    }
    return sanitizeProfileName(this.data.activeProfile || 'default');
  }

  // Temporary override (does not write to disk), used by --profile flag.
  useProfile(name) {
    const n = sanitizeProfileName(name);
    if (!this.hasProfile(n)) throw new Error(`Profile not found: ${n}`);
    this._activeProfileOverride = n;
  }

  clearProfileOverride() {
    this._activeProfileOverride = '';
  }

  _profile(profileName) {
    const name = sanitizeProfileName(profileName || this.getActiveProfile());
    this.data.profiles = this.data.profiles || {};
    if (!this.data.profiles[name]) this.data.profiles[name] = this._defaultsProfile();
    return this.data.profiles[name];
  }

  // API version
  setApiVersion(apiVersion) {
    const p = this._profile();
    p.apiVersion = apiVersion;
    this._save();
  }

  getApiVersion() {
    const p = this._profile();
    return p.apiVersion || 'v20.0';
  }

  // Tokens
  setToken(api, token) {
    const p = this._profile();
    p.tokens = p.tokens || {};
    p.tokens[api] = token;
    this._save();
  }

  getToken(api) {
    const p = this._profile();
    return (p.tokens || {})[api] || '';
  }

  hasToken(api) {
    return Boolean(this.getToken(api));
  }

  removeToken(api) {
    const p = this._profile();
    p.tokens = p.tokens || {};
    delete p.tokens[api];
    this._save();
  }

  clearAllTokens() {
    const p = this._profile();
    p.tokens = {};
    this._save();
  }

  // App credentials
  setAppCredentials(appId, appSecret) {
    const p = this._profile();
    p.app = { id: appId || '', secret: appSecret || '' };
    this._save();
  }

  getAppCredentials() {
    const p = this._profile();
    return {
      appId: (p.app || {}).id || '',
      appSecret: (p.app || {}).secret || ''
    };
  }

  hasAppCredentials() {
    const { appId, appSecret } = this.getAppCredentials();
    return Boolean(appId && appSecret);
  }

  // Default API
  setDefaultApi(api) {
    const p = this._profile();
    p.defaultApi = api;
    this._save();
  }

  getDefaultApi() {
    const p = this._profile();
    return p.defaultApi || 'facebook';
  }

  // Defaults: Facebook Page / IG user / WhatsApp phone / Marketing ad account
  setDefaultFacebookPageId(pageId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.facebookPageId = pageId || '';
    this._save();
  }

  getDefaultFacebookPageId() {
    const p = this._profile();
    return (p.defaults || {}).facebookPageId || '';
  }

  setDefaultIgUserId(igUserId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.igUserId = igUserId || '';
    this._save();
  }

  getDefaultIgUserId() {
    const p = this._profile();
    return (p.defaults || {}).igUserId || '';
  }

  setDefaultWhatsAppPhoneNumberId(phoneNumberId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.whatsappPhoneNumberId = phoneNumberId || '';
    this._save();
  }

  getDefaultWhatsAppPhoneNumberId() {
    const p = this._profile();
    return (p.defaults || {}).whatsappPhoneNumberId || '';
  }

  setDefaultMarketingAdAccountId(adAccountId) {
    const p = this._profile();
    p.defaults = p.defaults || {};
    p.defaults.marketingAdAccountId = adAccountId || '';
    this._save();
  }

  getDefaultMarketingAdAccountId() {
    const p = this._profile();
    return (p.defaults || {}).marketingAdAccountId || '';
  }

  // Agent config (LLM provider/key/model). WARNING: apiKey is sensitive.
  getAgentConfig() {
    const p = this._profile();
    const agent = p.agent || {};
    return {
      ...agent,
      modelTiers: {
        cheap: String(((agent.modelTiers || {}).cheap) || '').trim(),
        balanced: String(((agent.modelTiers || {}).balanced) || '').trim(),
        premium: String(((agent.modelTiers || {}).premium) || '').trim()
      }
    };
  }

  setAgentProvider(provider) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.provider = provider || 'openai';
    this._save();
  }

  setAgentModel(model) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.model = model || '';
    this._save();
  }

  setAgentModelTier(tier, model) {
    const key = String(tier || '').trim().toLowerCase();
    if (!['cheap', 'balanced', 'premium'].includes(key)) return;
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.modelTiers = p.agent.modelTiers || {};
    p.agent.modelTiers[key] = model || '';
    this._save();
  }

  setAgentApiKey(apiKey) {
    const p = this._profile();
    p.agent = p.agent || {};
    p.agent.apiKey = apiKey || '';
    this._save();
  }

  getWabaIntegration() {
    const p = this._profile();
    const base = (((p || {}).integrations || {}).waba || {});
    return {
      connected: Boolean(base.connected),
      businessId: String(base.businessId || ''),
      wabaId: String(base.wabaId || ''),
      phoneNumberId: String(base.phoneNumberId || ''),
      webhookCallbackUrl: String(base.webhookCallbackUrl || ''),
      webhookVerifyToken: String(base.webhookVerifyToken || ''),
      connectedAt: String(base.connectedAt || ''),
      provider: String(base.provider || '')
    };
  }

  setWabaIntegration(patch = {}) {
    const p = this._profile();
    p.integrations = p.integrations || {};
    const current = this.getWabaIntegration();
    p.integrations.waba = {
      ...current,
      ...(patch || {})
    };
    this._save();
    return this.getWabaIntegration();
  }

  getRegionConfig() {
    const p = this._profile();
    const region = (p.region || {});
    const modeRaw = String(region.regulatoryMode || 'standard').trim().toLowerCase();
    const regulatoryMode = ['standard', 'strict'].includes(modeRaw) ? modeRaw : 'standard';
    const useCaseRaw = String(region.useCase || 'general').trim().toLowerCase();
    const useCase = ['acquisition', 'retention', 'support', 'commerce', 'general'].includes(useCaseRaw)
      ? useCaseRaw
      : 'general';
    const profileRaw = String(region.policyProfile || 'default').trim().toLowerCase();
    const policyProfile = profileRaw || 'default';
    return {
      country: String(region.country || '').trim().toUpperCase(),
      timezone: String(region.timezone || '').trim(),
      regulatoryMode,
      useCase,
      policyProfile
    };
  }

  _normalizeIndustryState(input = {}) {
    const selected = normalizeIndustryId(input.selected || input.industry || '');
    const sourceRaw = String(input.source || '').trim().toLowerCase();
    const source = ['manual', 'auto'].includes(sourceRaw) ? sourceRaw : '';
    const detectorVersion = String(input.detectorVersion || '').trim();
    const detectedAt = String(input.detectedAt || '').trim();
    const confidenceNum = Number(input.confidence);
    const confidence = Number.isFinite(confidenceNum)
      ? Math.max(0, Math.min(1, Number(confidenceNum.toFixed(3))))
      : 0;
    return {
      selected,
      source,
      confidence,
      detectorVersion,
      detectedAt,
      manualLocked: Boolean(input.manualLocked)
    };
  }

  _rawIndustryProfile() {
    const p = this._profile();
    const next = {
      ...(p.industry || {}),
      mode: normalizeIndustryMode((p.industry || {}).mode || 'hybrid'),
      accountOverrides: { ...(((p.industry || {}).accountOverrides) || {}) }
    };
    p.industry = next;
    return next;
  }

  getIndustryConfig(options = {}) {
    const profileIndustry = this._rawIndustryProfile();
    const base = this._normalizeIndustryState(profileIndustry);
    const mode = normalizeIndustryMode(profileIndustry.mode || 'hybrid');
    const accountOverrides = profileIndustry.accountOverrides || {};
    const accountId = sanitizeAdAccountId(options.accountId || '');
    const override = accountId ? this._normalizeIndustryState(accountOverrides[accountId] || {}) : null;
    const effective = override && (override.selected || override.manualLocked || override.source)
      ? override
      : base;
    return {
      mode,
      selected: effective.selected || '',
      legacySelected: legacyIndustryId(effective.selected || ''),
      source: effective.source || '',
      confidence: effective.confidence || 0,
      detectorVersion: effective.detectorVersion || '',
      detectedAt: effective.detectedAt || '',
      manualLocked: Boolean(effective.manualLocked),
      accountId,
      hasOverride: Boolean(accountId && override && (override.selected || override.manualLocked || override.source)),
      accountOverridesCount: Object.keys(accountOverrides).length
    };
  }

  setIndustryMode(mode) {
    const profileIndustry = this._rawIndustryProfile();
    profileIndustry.mode = normalizeIndustryMode(mode);
    this._save();
    return this.getIndustryConfig();
  }

  setIndustryDetection(input = {}, options = {}) {
    const profileIndustry = this._rawIndustryProfile();
    const accountId = sanitizeAdAccountId(options.accountId || '');
    const next = this._normalizeIndustryState({
      selected: input.selected || input.industry || '',
      source: 'auto',
      confidence: input.confidence,
      detectorVersion: input.detectorVersion,
      detectedAt: input.detectedAt || new Date().toISOString(),
      manualLocked: Boolean(input.manualLocked)
    });
    if (accountId) {
      profileIndustry.accountOverrides = profileIndustry.accountOverrides || {};
      profileIndustry.accountOverrides[accountId] = next;
    } else {
      profileIndustry.selected = next.selected;
      profileIndustry.source = next.source;
      profileIndustry.confidence = next.confidence;
      profileIndustry.detectorVersion = next.detectorVersion;
      profileIndustry.detectedAt = next.detectedAt;
      profileIndustry.manualLocked = next.manualLocked;
    }
    this._save();
    return this.getIndustryConfig({ accountId });
  }

  setIndustryManual(industry, options = {}) {
    const profileIndustry = this._rawIndustryProfile();
    const accountId = sanitizeAdAccountId(options.accountId || '');
    const next = this._normalizeIndustryState({
      selected: industry,
      source: 'manual',
      confidence: 1,
      detectorVersion: 'manual',
      detectedAt: new Date().toISOString(),
      manualLocked: true
    });
    if (!next.selected) throw new Error(`Unsupported industry: ${String(industry || '').trim()}`);
    if (accountId) {
      profileIndustry.accountOverrides = profileIndustry.accountOverrides || {};
      profileIndustry.accountOverrides[accountId] = next;
    } else {
      profileIndustry.selected = next.selected;
      profileIndustry.source = next.source;
      profileIndustry.confidence = next.confidence;
      profileIndustry.detectorVersion = next.detectorVersion;
      profileIndustry.detectedAt = next.detectedAt;
      profileIndustry.manualLocked = true;
    }
    this._save();
    return this.getIndustryConfig({ accountId });
  }

  unlockIndustry(options = {}) {
    const profileIndustry = this._rawIndustryProfile();
    const accountId = sanitizeAdAccountId(options.accountId || '');
    if (accountId) {
      profileIndustry.accountOverrides = profileIndustry.accountOverrides || {};
      const current = this._normalizeIndustryState(profileIndustry.accountOverrides[accountId] || {});
      profileIndustry.accountOverrides[accountId] = {
        ...current,
        manualLocked: false
      };
    } else {
      profileIndustry.manualLocked = false;
    }
    this._save();
    return this.getIndustryConfig({ accountId });
  }

  setRegionConfig(patch = {}) {
    const p = this._profile();
    const next = { ...this.getRegionConfig(), ...(patch || {}) };
    if (next.country) next.country = String(next.country).trim().toUpperCase();
    if (next.timezone) next.timezone = String(next.timezone).trim();
    const modeRaw = String(next.regulatoryMode || 'standard').trim().toLowerCase();
    next.regulatoryMode = ['standard', 'strict'].includes(modeRaw) ? modeRaw : 'standard';
    const useCaseRaw = String(next.useCase || 'general').trim().toLowerCase();
    next.useCase = ['acquisition', 'retention', 'support', 'commerce', 'general'].includes(useCaseRaw)
      ? useCaseRaw
      : 'general';
    next.policyProfile = String(next.policyProfile || 'default').trim().toLowerCase() || 'default';
    p.region = next;
    this._save();
    return this.getRegionConfig();
  }

  clearWabaIntegration() {
    return this.setWabaIntegration({
      connected: false,
      businessId: '',
      wabaId: '',
      phoneNumberId: '',
      webhookCallbackUrl: '',
      webhookVerifyToken: '',
      connectedAt: '',
      provider: ''
    });
  }

  // Onboarding completion state (per profile)
  markOnboardingComplete(input = {}) {
    const p = this._profile();
    const completedAt = String(input.completedAt || new Date().toISOString()).trim();
    const version = String(input.version || '').trim();
    p.onboarding = {
      completedAt,
      version
    };
    this._save();
    return this.getOnboardingStatus();
  }

  clearOnboardingComplete() {
    const p = this._profile();
    p.onboarding = { completedAt: '', version: '' };
    this._save();
    return this.getOnboardingStatus();
  }

  getOnboardingStatus() {
    const p = this._profile();
    const onboarding = p.onboarding || {};
    const completedAt = String(onboarding.completedAt || '').trim();
    const version = String(onboarding.version || '').trim();
    return {
      completed: Boolean(completedAt),
      completedAt,
      version
    };
  }

  hasCompletedOnboarding() {
    return this.getOnboardingStatus().completed;
  }

  // Team/operator identity for audit trails and RBAC defaults.
  setOperator(input = {}) {
    const id = String(input.id || '').trim();
    const name = String(input.name || '').trim();
    this.data.operator = { id, name };
    this._save();
    return this.getOperator();
  }

  getOperator() {
    const raw = this.data.operator && typeof this.data.operator === 'object'
      ? this.data.operator
      : {};
    return {
      id: String(raw.id || '').trim(),
      name: String(raw.name || '').trim()
    };
  }

  clearOperator() {
    this.data.operator = { id: '', name: '' };
    this._save();
  }

  // Display (sanitized)
  display({ profile } = {}) {
    const active = this.getActiveProfile();
    const selected = sanitizeProfileName(profile || active);
    const p = this._profile(selected);
    const tokens = p.tokens || {};
    const app = { appId: (p.app || {}).id || '', appSecret: (p.app || {}).secret || '' };
    const operator = this.getOperator();
    const region = this.getRegionConfig();
    const industry = this.getIndustryConfig();

    const summaryRows = [
      kv('Config file', chalk.gray(this.getConfigPath()), { labelWidth: 15 }),
      kv('Active profile', chalk.cyan(active), { labelWidth: 15 }),
      kv('Viewing profile', chalk.cyan(selected), { labelWidth: 15 }),
      kv('Profiles', chalk.cyan(this.listProfiles().join(', ')), { labelWidth: 15 }),
      kv('Operator', operator.id ? chalk.cyan(operator.id) : '', { labelWidth: 15 }),
      kv(
        'Onboarding',
        p.onboarding && p.onboarding.completedAt
          ? `${formatBadge('COMPLETE', { tone: 'success' })} ${chalk.gray(p.onboarding.completedAt)}`
          : formatBadge('PENDING', { tone: 'warn' }),
        { labelWidth: 15 }
      )
    ];

    const tokenRows = ['facebook', 'instagram', 'whatsapp'].map((api) => {
      const token = String(tokens[api] || '').trim();
      const state = token ? formatBadge('READY', { tone: 'success' }) : formatBadge('MISSING', { tone: 'warn' });
      const preview = token ? chalk.green(formatTokenPreview(token)) : chalk.gray('not set');
      return `${chalk.cyan(api.padEnd(10, ' '))} ${state} ${preview}`;
    });

    const settingsRows = [
      kv('App ID', app.appId ? chalk.green(app.appId) : '', { labelWidth: 16 }),
      kv('App Secret', app.appSecret ? formatBadge('CONFIGURED', { tone: 'success' }) : '', { labelWidth: 16 }),
      kv('API Version', chalk.cyan(p.apiVersion || 'v20.0'), { labelWidth: 16 }),
      kv('Default API', chalk.cyan(p.defaultApi || 'facebook'), { labelWidth: 16 }),
      kv('Agent Provider', chalk.cyan((p.agent || {}).provider || 'openai'), { labelWidth: 16 }),
      kv('Agent Model', chalk.cyan((p.agent || {}).model || '(default)'), { labelWidth: 16 }),
      kv('Agent API Key', (p.agent || {}).apiKey ? formatBadge('CONFIGURED', { tone: 'success' }) : '', { labelWidth: 16 })
    ];

    const defaultsRows = [
      kv('Facebook Page', (p.defaults || {}).facebookPageId ? chalk.cyan((p.defaults || {}).facebookPageId) : '', { labelWidth: 16 }),
      kv('Instagram User', (p.defaults || {}).igUserId ? chalk.cyan((p.defaults || {}).igUserId) : '', { labelWidth: 16 }),
      kv('WhatsApp Phone', (p.defaults || {}).whatsappPhoneNumberId ? chalk.cyan((p.defaults || {}).whatsappPhoneNumberId) : '', { labelWidth: 16 }),
      kv('Ad Account', (p.defaults || {}).marketingAdAccountId ? chalk.cyan((p.defaults || {}).marketingAdAccountId) : '', { labelWidth: 16 })
    ];

    const regionRows = [
      kv('Country', region.country ? chalk.cyan(region.country) : '', { labelWidth: 16 }),
      kv('Timezone', region.timezone ? chalk.cyan(region.timezone) : '', { labelWidth: 16 }),
      kv('Regulatory', chalk.cyan(region.regulatoryMode), { labelWidth: 16 }),
      kv('Use Case', chalk.cyan(region.useCase), { labelWidth: 16 }),
      kv('Policy Profile', chalk.cyan(region.policyProfile), { labelWidth: 16 })
    ];

    const industryRows = [
      kv('Mode', chalk.cyan(industry.mode), { labelWidth: 16 }),
      kv('Selected', industry.selected ? chalk.cyan(industry.selected) : '', { labelWidth: 16 }),
      kv('Source', industry.source ? chalk.cyan(industry.source) : '', { labelWidth: 16 }),
      kv('Confidence', industry.confidence ? chalk.cyan(String(industry.confidence)) : '', { labelWidth: 16 }),
      kv('Manual Lock', industry.manualLocked ? formatBadge('ON', { tone: 'warn' }) : formatBadge('OFF', { tone: 'success' }), { labelWidth: 16 })
    ];

    console.log('');
    console.log(renderPanel({
      title: ' Configuration Snapshot ',
      rows: summaryRows,
      minWidth: 78,
      borderColor: (value) => chalk.cyan(value)
    }));
    console.log('');

    console.log(renderPanel({
      title: ' Tokens ',
      rows: tokenRows,
      minWidth: 78,
      borderColor: (value) => chalk.blue(value)
    }));
    console.log('');

    console.log(renderPanel({
      title: ' App + Agent ',
      rows: settingsRows,
      minWidth: 78,
      borderColor: (value) => chalk.magenta(value)
    }));
    console.log('');

    console.log(renderPanel({
      title: ' Defaults ',
      rows: defaultsRows,
      minWidth: 78,
      borderColor: (value) => chalk.green(value)
    }));
    console.log('');

    console.log(renderPanel({
      title: ' Region ',
      rows: regionRows,
      minWidth: 78,
      borderColor: (value) => chalk.yellow(value)
    }));
    console.log('');

    console.log(renderPanel({
      title: ' Industry ',
      rows: industryRows,
      minWidth: 78,
      borderColor: (value) => chalk.hex('#66FFCC')(value)
    }));
    console.log('');
  }
}

const singleton = new ConfigManager();
singleton.ConfigManager = ConfigManager;
singleton.sanitizeProfileName = sanitizeProfileName;

module.exports = singleton;

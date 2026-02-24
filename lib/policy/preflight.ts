const { packForCountry, normalizePolicyProfile, profileFor } = require('./region-packs');

function classifyAction(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!a) return { kind: 'unknown', risk: 'low' };
  if (a.includes('whatsapp') && (a.includes('send') || a.includes('bulk') || a.includes('broadcast'))) {
    return { kind: 'whatsapp_marketing', risk: 'high' };
  }
  if (a.includes('create') || a.includes('pause') || a.includes('resume') || a.includes('set-budget') || a.includes('campaign')) {
    return { kind: 'marketing_write', risk: 'high' };
  }
  if (a.includes('delete')) return { kind: 'destructive', risk: 'high' };
  return { kind: 'read_or_general', risk: 'low' };
}

function parseIntent(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw.includes('whatsapp')) return 'whatsapp.send';
  if (raw.includes('campaign') || raw.includes('budget') || raw.includes('pause') || raw.includes('resume')) {
    return 'marketing.create_campaign';
  }
  if (raw.includes('post')) return 'post.create';
  if (raw.includes('query') || raw.includes('status')) return 'query.me';
  return raw.split(/\s+/).slice(0, 2).join('.');
}

function normalizeUseCase(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['acquisition', 'retention', 'support', 'commerce', 'general'].includes(raw)) return raw;
  return 'general';
}

function preflightFor({ action, region, useCase }) {
  const actionInfo = classifyAction(action);
  const country = String(region?.country || '').trim().toUpperCase();
  const mode = String(region?.regulatoryMode || 'standard').trim().toLowerCase();
  const timezone = String(region?.timezone || '').trim();
  const normalizedUseCase = normalizeUseCase(useCase || region?.useCase || 'general');
  const pack = packForCountry(country);
  const policyProfile = normalizePolicyProfile(pack, region?.policyProfile || '');
  const profile = profileFor(pack, policyProfile);
  const checks = [];

  if (!country) {
    checks.push({
      id: 'country_missing',
      severity: mode === 'strict' ? 'warn' : 'info',
      ok: false,
      message: 'Country not set for workspace. Configure region for policy-aware checks.'
    });
  } else {
    checks.push({
      id: 'country_set',
      severity: 'info',
      ok: true,
      message: `Country set: ${country}`
    });
  }

  if (!timezone) {
    checks.push({
      id: 'timezone_missing',
      severity: 'warn',
      ok: false,
      message: 'Timezone not set. Scheduling operations may run at unexpected local times.'
    });
  }

  const allRules = [...(pack.rules || []), ...((profile && profile.rules) || [])];
  allRules.forEach((rule) => {
    const shouldApply = rule.when === actionInfo.kind || (rule.when === 'high_risk' && actionInfo.risk === 'high');
    if (!shouldApply) return;
    let severity = rule.severity;
    if (mode === 'strict' && severity === 'warn' && actionInfo.risk === 'high') severity = 'block';
    checks.push({
      id: rule.id,
      severity,
      ok: severity === 'info',
      message: rule.message
    });
  });

  if (normalizedUseCase === 'support' && actionInfo.kind === 'marketing_write') {
    checks.push({
      id: 'use_case_support_marketing_guard',
      severity: actionInfo.risk === 'high' && mode === 'strict' ? 'block' : 'warn',
      ok: false,
      message: 'Support use-case selected. Confirm this marketing write is intended for support operations.'
    });
  }

  const blockers = checks.filter((c) => c.severity === 'block' && c.ok === false);
  const warns = checks.filter((c) => c.severity === 'warn' && c.ok === false);

  return {
    ok: blockers.length === 0,
    action,
    actionKind: actionInfo.kind,
    risk: actionInfo.risk,
    mode: mode === 'strict' ? 'strict' : 'standard',
    country,
    timezone,
    pack: pack.name,
    policyProfile,
    useCase: normalizedUseCase,
    checks,
    summary: {
      blockers: blockers.length,
      warnings: warns.length
    }
  };
}

module.exports = {
  classifyAction,
  parseIntent,
  normalizeUseCase,
  preflightFor
};

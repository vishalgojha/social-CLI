const GLOBAL_PROFILES = {
  default: {
    id: 'default',
    notes: 'Balanced default checks.',
    rules: []
  },
  commerce: {
    id: 'commerce',
    notes: 'Commerce-heavy workspaces with marketing and messaging writes.',
    rules: [
      {
        id: 'commerce_approval_window',
        when: 'high_risk',
        severity: 'warn',
        message: 'Prefer approval-gated rollout windows for high-risk spend or messaging changes.'
      }
    ]
  },
  support: {
    id: 'support',
    notes: 'Support-oriented workflows with user communication focus.',
    rules: [
      {
        id: 'support_opt_in_scope',
        when: 'whatsapp_marketing',
        severity: 'warn',
        message: 'Validate support-thread scope and explicit opt-in before outbound templated sends.'
      }
    ]
  }
};

const PACKS = {
  global: {
    name: 'global',
    notes: 'Baseline global policy checks.',
    profiles: GLOBAL_PROFILES,
    rules: []
  },
  IN: {
    name: 'india',
    notes: 'India-focused messaging and campaign hygiene checks.',
    profiles: GLOBAL_PROFILES,
    rules: [
      {
        id: 'in_whatsapp_marketing_template',
        when: 'whatsapp_marketing',
        severity: 'warn',
        message: 'For marketing sends, use approved templates and explicit consent list.'
      }
    ]
  },
  US: {
    name: 'united_states',
    notes: 'US-focused disclosure and consent checks.',
    profiles: GLOBAL_PROFILES,
    rules: [
      {
        id: 'us_marketing_disclosure',
        when: 'marketing_write',
        severity: 'warn',
        message: 'Ensure promotional disclosures and audience exclusions are configured for ad writes.'
      }
    ]
  },
  BR: {
    name: 'brazil',
    notes: 'Brazil LGPD-sensitive messaging checks.',
    profiles: GLOBAL_PROFILES,
    rules: [
      {
        id: 'br_lgpd_data_minimization',
        when: 'high_risk',
        severity: 'warn',
        message: 'Review LGPD data-minimization and purpose-limitation before high-risk actions.'
      }
    ]
  },
  EU: {
    name: 'eu',
    notes: 'EU privacy-sensitive checks.',
    profiles: GLOBAL_PROFILES,
    rules: [
      {
        id: 'eu_personal_data_guard',
        when: 'high_risk',
        severity: 'warn',
        message: 'Confirm lawful basis and privacy notice before high-risk actions involving personal data.'
      }
    ]
  }
};

const EU_CODES = ['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'IE', 'PL', 'PT', 'BE', 'AT', 'DK', 'FI', 'GR', 'CZ', 'RO', 'HU', 'SK', 'SI', 'HR', 'LT', 'LV', 'EE', 'LU', 'CY', 'MT', 'BG'];

function packForCountry(countryCode) {
  const cc = String(countryCode || '').trim().toUpperCase();
  if (!cc) return PACKS.global;
  if (cc === 'IN') return PACKS.IN;
  if (cc === 'US') return PACKS.US;
  if (cc === 'BR') return PACKS.BR;
  if (EU_CODES.includes(cc)) return PACKS.EU;
  return PACKS.global;
}

function normalizePolicyProfile(pack, profile) {
  const p = pack && typeof pack === 'object' ? pack : PACKS.global;
  const raw = String(profile || '').trim().toLowerCase();
  if (!raw) return 'default';
  if ((p.profiles || {})[raw]) return raw;
  return 'default';
}

function profileFor(pack, profile) {
  const p = pack && typeof pack === 'object' ? pack : PACKS.global;
  const id = normalizePolicyProfile(p, profile);
  return (p.profiles || {})[id] || GLOBAL_PROFILES.default;
}

function listProfilesForCountry(countryCode) {
  const pack = packForCountry(countryCode);
  return Object.values(pack.profiles || GLOBAL_PROFILES)
    .map((x) => ({ id: String(x.id || ''), notes: String(x.notes || '') }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = {
  PACKS,
  packForCountry,
  normalizePolicyProfile,
  profileFor,
  listProfilesForCountry
};

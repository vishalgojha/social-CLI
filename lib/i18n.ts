const SUPPORTED_LANGS = new Set(['en', 'hi', 'es', 'pt', 'fr']);

const STRINGS = {
  en: {
    doctor_next_steps: 'Next Steps:',
    doctor_no_tokens: 'No tokens are configured. Start with: social auth login -a facebook',
    doctor_missing_facebook: 'Missing Facebook token: social auth login -a facebook',
    doctor_missing_instagram: 'Missing Instagram token: social auth login -a instagram',
    doctor_missing_whatsapp: 'Missing WhatsApp token: social auth login -a whatsapp',
    doctor_missing_app_creds: 'App credentials not set (needed for OAuth and token debugging): social auth app',
    doctor_missing_ad_account: 'No default ad account set (Marketing API): social marketing set-default-account act_<AD_ACCOUNT_ID>',
    doctor_default_api_missing_token: 'Default API is "{api}" but its token is not set. Set a token or change default API.'
  },
  hi: {
    doctor_next_steps: 'Agle Steps:',
    doctor_no_tokens: 'Koi token configured nahi hai. Shuru karein: social auth login -a facebook',
    doctor_missing_facebook: 'Facebook token missing hai: social auth login -a facebook',
    doctor_missing_instagram: 'Instagram token missing hai: social auth login -a instagram',
    doctor_missing_whatsapp: 'WhatsApp token missing hai: social auth login -a whatsapp',
    doctor_missing_app_creds: 'App credentials set nahi hain (OAuth/token debug ke liye): social auth app',
    doctor_missing_ad_account: 'Default ad account set nahi hai (Marketing API): social marketing set-default-account act_<AD_ACCOUNT_ID>',
    doctor_default_api_missing_token: 'Default API "{api}" hai, lekin uska token set nahi hai. Token set karein ya default API badlein.'
  },
  es: {
    doctor_next_steps: 'Siguientes pasos:',
    doctor_no_tokens: 'No hay tokens configurados. Empieza con: social auth login -a facebook',
    doctor_missing_facebook: 'Falta token de Facebook: social auth login -a facebook',
    doctor_missing_instagram: 'Falta token de Instagram: social auth login -a instagram',
    doctor_missing_whatsapp: 'Falta token de WhatsApp: social auth login -a whatsapp',
    doctor_missing_app_creds: 'Credenciales de app no configuradas (OAuth/debug): social auth app',
    doctor_missing_ad_account: 'No hay cuenta publicitaria por defecto (Marketing API): social marketing set-default-account act_<AD_ACCOUNT_ID>',
    doctor_default_api_missing_token: 'La API predeterminada es "{api}" pero su token no esta configurado.'
  },
  pt: {
    doctor_next_steps: 'Proximos passos:',
    doctor_no_tokens: 'Nenhum token configurado. Comece com: social auth login -a facebook',
    doctor_missing_facebook: 'Token do Facebook ausente: social auth login -a facebook',
    doctor_missing_instagram: 'Token do Instagram ausente: social auth login -a instagram',
    doctor_missing_whatsapp: 'Token do WhatsApp ausente: social auth login -a whatsapp',
    doctor_missing_app_creds: 'Credenciais do app nao configuradas (OAuth/debug): social auth app',
    doctor_missing_ad_account: 'Sem conta de anuncios padrao (Marketing API): social marketing set-default-account act_<AD_ACCOUNT_ID>',
    doctor_default_api_missing_token: 'A API padrao e "{api}", mas o token nao esta configurado.'
  },
  fr: {
    doctor_next_steps: 'Etapes suivantes:',
    doctor_no_tokens: 'Aucun token configure. Commencez avec: social auth login -a facebook',
    doctor_missing_facebook: 'Token Facebook manquant: social auth login -a facebook',
    doctor_missing_instagram: 'Token Instagram manquant: social auth login -a instagram',
    doctor_missing_whatsapp: 'Token WhatsApp manquant: social auth login -a whatsapp',
    doctor_missing_app_creds: 'Identifiants app non configures (OAuth/debug): social auth app',
    doctor_missing_ad_account: 'Aucun compte pub par defaut (Marketing API): social marketing set-default-account act_<AD_ACCOUNT_ID>',
    doctor_default_api_missing_token: 'L API par defaut est "{api}" mais son token nest pas configure.'
  }
};

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'en';
  if (SUPPORTED_LANGS.has(raw)) return raw;
  if (raw.startsWith('hi')) return 'hi';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('fr')) return 'fr';
  return 'en';
}

function getLanguage() {
  return normalizeLang(process.env.SOCIAL_LANG || 'en');
}

function setLanguage(lang) {
  process.env.SOCIAL_LANG = normalizeLang(lang);
  return process.env.SOCIAL_LANG;
}

function t(key, vars = {}, langOverride = '') {
  const lang = normalizeLang(langOverride || getLanguage());
  const table = STRINGS[lang] || STRINGS.en;
  let out = String(table[key] || STRINGS.en[key] || key);
  Object.entries(vars || {}).forEach(([k, v]) => {
    out = out.replaceAll(`{${k}}`, String(v));
  });
  return out;
}

function qualityCheck(text, langOverride = '') {
  const lang = normalizeLang(langOverride || getLanguage());
  const raw = String(text || '');
  const issues = [];
  if (!raw.trim()) issues.push('empty_response');
  if (raw.length > 0 && raw.length < 3) issues.push('too_short');
  if (lang !== 'en' && /^[\x00-\x7F\s.,!?'"():;-]+$/.test(raw) && raw.toLowerCase().includes('token')) {
    issues.push('likely_unlocalized_copy');
  }
  return {
    ok: issues.length === 0,
    lang,
    issues
  };
}

module.exports = {
  SUPPORTED_LANGS,
  normalizeLang,
  getLanguage,
  setLanguage,
  t,
  qualityCheck
};

const SUPPORTED_LANGS = new Set(['en', 'hi']);

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
  }
};

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'en';
  if (SUPPORTED_LANGS.has(raw)) return raw;
  if (raw.startsWith('hi')) return 'hi';
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

module.exports = {
  SUPPORTED_LANGS,
  normalizeLang,
  getLanguage,
  setLanguage,
  t
};

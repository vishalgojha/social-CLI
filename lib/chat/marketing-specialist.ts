const { buildMarketingTemplate } = require('./marketing-templates');

function normalizeText(value) {
  return String(value || '').trim();
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildCacheKey(intent, language, contextHash) {
  return `${intent}_${language}_${contextHash}`;
}

const templateCache = new Map();

function cloneDecision(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function fromCache(key, build) {
  if (templateCache.has(key)) return cloneDecision(templateCache.get(key));
  const value = build();
  templateCache.set(key, cloneDecision(value));
  return value;
}

function detectObjective(text) {
  const lower = normalizeText(text).toLowerCase();
  const pairs = [
    ['lead generation', 'leads'],
    ['generate leads', 'leads'],
    ['leads', 'leads'],
    ['sales', 'sales'],
    ['traffic', 'traffic'],
    ['awareness', 'awareness'],
    ['engagement', 'engagement'],
    ['messages', 'messages'],
    ['dm', 'messages'],
    ['conversions', 'conversions']
  ];
  const found = pairs.find(([needle]) => lower.includes(needle));
  return found ? found[1] : '';
}

function detectIndustry(text) {
  const lower = normalizeText(text).toLowerCase();
  const pairs = [
    ['real estate', 'real_estate'],
    ['realtor', 'real_estate'],
    ['property', 'real_estate'],
    ['ecommerce', 'ecommerce'],
    ['e-commerce', 'ecommerce'],
    ['education', 'education'],
    ['healthcare', 'healthcare'],
    ['fitness', 'fitness'],
    ['saas', 'saas'],
    ['finance', 'finance'],
    ['retail', 'retail'],
    ['hospitality', 'hospitality']
  ];
  const found = pairs.find(([needle]) => lower.includes(needle));
  return found ? found[1] : '';
}

function detectBudget(text) {
  const raw = normalizeText(text);
  const match = raw.match(/(?:₹|rs\.?|inr|rupees?)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:₹|rs\.?|inr|rupees?)/i);
  if (!match) return { amount: null, currency: '', period: '' };
  const amountText = match[1] || match[2] || '';
  const amount = Number(String(amountText).replace(/,/g, ''));
  const lower = raw.toLowerCase();
  const period = lower.includes('daily') || /\bper day\b/.test(lower) || /\/day\b/.test(lower)
    ? 'daily'
    : (lower.includes('weekly') || /\bper week\b/.test(lower) || /\/week\b/.test(lower)
      ? 'weekly'
      : (lower.includes('monthly') || /\bper month\b/.test(lower) || /\/month\b/.test(lower)
        ? 'monthly'
        : ''));
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: 'INR',
    period
  };
}

function cleanLocation(value) {
  return String(value || '')
    .trim()
    .replace(/\b(targeting|audience|campaign|ads?)\b/gi, '')
    .replace(/[,.!?]+$/g, '')
    .trim();
}

function detectLocation(text) {
  const raw = normalizeText(text);
  const patterns = [
    /\b([A-Za-z][A-Za-z .'-]{2,60})\s+targeting\b/i,
    /\btarget(?:ing)?\s+([A-Za-z][A-Za-z .'-]{2,60})\b/i,
    /\bin\s+([A-Za-z][A-Za-z .'-]{2,60})\b/i,
    /\baround\s+([A-Za-z][A-Za-z .'-]{2,60})\b/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const cleaned = cleanLocation(match?.[1] || '');
    if (cleaned) return cleaned;
  }
  return '';
}

function detectAudience(text) {
  const raw = normalizeText(text);
  const match = raw.match(/\b(?:audience|for|towards)\s+([A-Za-z0-9][A-Za-z0-9 ,.'&/-]{2,80})/i);
  return match ? String(match[1]).trim().replace(/[,.!?]+$/g, '') : '';
}

function detectCreativeType(text) {
  const lower = normalizeText(text).toLowerCase();
  if (lower.includes('video')) return 'video';
  if (lower.includes('carousel')) return 'carousel';
  if (lower.includes('image')) return 'image';
  if (lower.includes('reel')) return 'reel';
  return '';
}

function extractMarketingFields(text) {
  const budget = detectBudget(text);
  return {
    objective: detectObjective(text),
    budget: budget.amount,
    budgetPeriod: budget.period,
    currency: budget.currency,
    industry: detectIndustry(text),
    location: detectLocation(text),
    audience: detectAudience(text),
    creativeType: detectCreativeType(text)
  };
}

function missingFields(fields) {
  const missing = [];
  if (!fields.objective) missing.push('objective');
  if (!fields.budget) missing.push('budget');
  if (!fields.industry) missing.push('industry');
  if (!fields.location) missing.push('location');
  return missing;
}

function formatBudget(fields) {
  if (!fields.budget) return '';
  const amount = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(fields.budget);
  return `${fields.currency || 'INR'} ${amount}${fields.budgetPeriod ? ` ${fields.budgetPeriod}` : ''}`;
}

function filledFieldCount(fields) {
  return [
    fields.objective,
    fields.budget,
    fields.industry,
    fields.location,
    fields.audience,
    fields.creativeType
  ].filter(Boolean).length;
}

function isMarketingTemplateRequest(text) {
  const lower = normalizeText(text).toLowerCase();
  if (!lower) return false;
  return /\b(ad|ads|campaign|creative|copy|caption|promote|promotion|targeting|meta ads|facebook ads|instagram ads)\b/.test(lower);
}

function isRequirementsPrompt(text) {
  const lower = normalizeText(text).toLowerCase();
  return /\b(what do you need|requirements|what information do you need|what details do you need|what do you need from me)\b/.test(lower);
}

function isAdHelpPrompt(text) {
  const lower = normalizeText(text).toLowerCase();
  return /\b(help\b.*\b(ad|campaign)|create\b.*\b(ad|campaign)|run\b.*\b(ad|campaign)|launch\b.*\bcampaign|promote)\b/.test(lower);
}

function buildExtractionMessage(fields) {
  const lines = ['I extracted this marketing brief without using a full AI generation pass:'];
  if (fields.objective) lines.push(`- objective: ${fields.objective}`);
  if (fields.budget) lines.push(`- budget: ${formatBudget(fields)}`);
  if (fields.industry) lines.push(`- industry: ${fields.industry}`);
  if (fields.location) lines.push(`- location: ${fields.location}`);
  if (fields.audience) lines.push(`- audience: ${fields.audience}`);
  if (fields.creativeType) lines.push(`- creative type: ${fields.creativeType}`);
  return lines.join('\n');
}

function buildMarketingTemplateDecision(text, facts = {}) {
  const raw = normalizeText(text);
  const lower = raw.toLowerCase();
  if (!raw) return null;

  if (isRequirementsPrompt(raw)) {
    const key = buildCacheKey('requirements_checklist', 'en', simpleHash('default'));
    return fromCache(key, () => buildMarketingTemplate('requirements_checklist'));
  }

  if (isAdHelpPrompt(raw)) {
    const key = buildCacheKey('help_create_ad', 'en', simpleHash('default'));
    return fromCache(key, () => buildMarketingTemplate('help_create_ad'));
  }

  const extracted = {
    ...extractMarketingFields(raw),
    objective: detectObjective(raw) || facts?.marketingBrief?.objective || '',
    industry: detectIndustry(raw) || facts?.marketingBrief?.industry || '',
    location: detectLocation(raw) || facts?.marketingBrief?.location || '',
    audience: detectAudience(raw) || facts?.marketingBrief?.audience || '',
    creativeType: detectCreativeType(raw) || facts?.marketingBrief?.creativeType || ''
  };
  if (!extracted.budget && facts?.marketingBrief?.budget) {
    extracted.budget = facts.marketingBrief.budget;
    extracted.budgetPeriod = extracted.budgetPeriod || facts.marketingBrief.budgetPeriod || '';
    extracted.currency = extracted.currency || facts.marketingBrief.currency || 'INR';
  }

  const extractedCount = filledFieldCount(extracted);
  const missing = missingFields(extracted);
  const budgetOnly = Boolean(extracted.budget) && extractedCount === 1 && /\b(budget|daily|weekly|monthly|₹|rs\.?|inr|rupees?)\b/.test(lower);
  const locationOnly = Boolean(extracted.location) && extractedCount === 1 && /\b(location|target|targeting|area|city|in )\b/.test(`${lower} `);
  const looksLikeBrief = extractedCount >= 2 || /\btargeting\b/.test(lower);

  if (budgetOnly) {
    const key = buildCacheKey('budget_confirmation', 'en', simpleHash(formatBudget(extracted)));
    return fromCache(key, () => buildMarketingTemplate('budget_confirmation', {
      budgetText: formatBudget(extracted),
      marketingBrief: extracted
    }));
  }

  if (locationOnly) {
    const key = buildCacheKey('location_confirmation', 'en', simpleHash(extracted.location));
    return fromCache(key, () => buildMarketingTemplate('location_confirmation', {
      location: extracted.location,
      marketingBrief: extracted
    }));
  }

  if (looksLikeBrief && isMarketingTemplateRequest(raw)) {
    const message = buildExtractionMessage(extracted);
    return {
      message: missing.length
        ? `${message}\n\nMissing required fields: ${missing.join(', ')}.\nReply with only those missing fields in one line.`
        : `${message}\n\nRequired fields look complete. If this is correct, ask me for draft ad copy or a campaign angle.`,
      actions: [],
      needsInput: true,
      suggestions: missing.length
        ? [`objective: leads`, `industry: real estate`, `location: Bandra East`].filter((item) => missing.some((field) => item.startsWith(field)))
        : ['Draft ad copy', 'Give me 3 campaign angles', 'Suggest an audience'],
      specialist: 'marketing',
      specialistName: 'Marketing Agent',
      marketingBrief: extracted,
      mode: 'extract'
    };
  }

  return null;
}

module.exports = {
  buildCacheKey,
  buildMarketingTemplateDecision,
  extractMarketingFields
};

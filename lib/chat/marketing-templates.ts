function normalizeText(value) {
  return String(value || '').trim();
}

function buildRequirementsChecklistText() {
  return [
    'Send the full brief in one line so I can avoid multiple AI turns:',
    '`budget`, `objective`, `industry`, `location`, optional `audience`, optional `creative type`',
    'Example: `300 INR daily, leads, fitness studio, Mumbai, working professionals, short video ad`'
  ].join('\n');
}

const MARKETING_TEMPLATE_REGISTRY = {
  requirements_checklist: () => ({
    message: buildRequirementsChecklistText(),
    actions: [],
    needsInput: true,
    suggestions: [
      '300 INR daily, leads, fitness studio, Mumbai',
      '500 INR daily, traffic, ecommerce, Pune'
    ],
    specialist: 'marketing',
    specialistName: 'Marketing Agent',
    mode: 'template'
  }),
  help_create_ad: () => ({
    message: [
      'I can help create the ad without wasting tokens.',
      buildRequirementsChecklistText()
    ].join('\n\n'),
    actions: [],
    needsInput: true,
    suggestions: [
      '300 INR daily, leads, fitness studio, Mumbai',
      'What do you need for a lead gen campaign?',
      'Draft ad copy after I send the brief'
    ],
    specialist: 'marketing',
    specialistName: 'Marketing Agent',
    mode: 'template'
  }),
  budget_confirmation: (data = {}) => ({
    message: `Budget captured: ${normalizeText(data.budgetText)}.\nNow send the missing fields in one line: objective, industry, and location.`,
    actions: [],
    needsInput: true,
    suggestions: [
      'leads, fitness studio, Mumbai',
      'traffic, ecommerce, Pune'
    ],
    specialist: 'marketing',
    specialistName: 'Marketing Agent',
    marketingBrief: data.marketingBrief || null,
    mode: 'template'
  }),
  location_confirmation: (data = {}) => ({
    message: `Location captured: ${normalizeText(data.location)}.\nNow send the missing fields in one line: budget, objective, and industry.`,
    actions: [],
    needsInput: true,
    suggestions: [
      '300 INR daily, leads, fitness studio',
      '500 INR daily, traffic, ecommerce'
    ],
    specialist: 'marketing',
    specialistName: 'Marketing Agent',
    marketingBrief: data.marketingBrief || null,
    mode: 'template'
  })
};

function buildMarketingTemplate(templateId, data = {}) {
  const builder = MARKETING_TEMPLATE_REGISTRY[String(templateId || '').trim()];
  if (!builder) return null;
  return builder(data);
}

module.exports = {
  MARKETING_TEMPLATE_REGISTRY,
  buildMarketingTemplate,
  buildRequirementsChecklistText
};

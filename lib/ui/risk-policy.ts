function normalizeRisk(risk) {
  const raw = String(risk || '').trim().toLowerCase();
  if (raw === 'high') return 'high';
  if (raw === 'medium') return 'medium';
  return 'low';
}

function highestRisk(risks = []) {
  const normalized = (Array.isArray(risks) ? risks : []).map((x) => normalizeRisk(x));
  if (normalized.includes('high')) return 'high';
  if (normalized.includes('medium')) return 'medium';
  return 'low';
}

function confirmationPromptForRisk(risk, options = {}) {
  const level = normalizeRisk(risk);
  const surface = String(options.surface || 'chat').trim().toLowerCase();

  if (surface === 'cli') {
    if (level === 'high') return 'HIGH risk action. Explicit approval is required before execution.';
    if (level === 'medium') return 'MEDIUM risk action. Confirm before execution.';
    return 'LOW risk action. Confirm before execution unless --yes is provided.';
  }

  if (level === 'high') {
    return 'HIGH risk plan queued. Explicit approval required. Reply "yes" to execute, or "no" to cancel.';
  }
  if (level === 'medium') {
    return 'MEDIUM risk plan queued. Review and reply "yes" to execute, or "no" to cancel.';
  }
  return 'LOW risk plan queued. Reply "yes" to execute, or "no" to cancel.';
}

module.exports = {
  normalizeRisk,
  highestRisk,
  confirmationPromptForRisk
};

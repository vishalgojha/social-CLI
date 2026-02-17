function toIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toISOString();
}

function resultSummary(row) {
  const action = row?.action || {};
  const tool = String(action.tool || '').trim() || 'action';
  if (row?.error) {
    return `${tool} failed: ${String(row.error || '').trim() || 'error'}`;
  }
  const result = row?.result || {};
  const data = result?.data || {};
  if (typeof data?.message === 'string' && data.message.trim()) return `${tool}: ${data.message.trim()}`;
  if (typeof data?.status === 'string' && data.status.trim()) return `${tool}: ${data.status.trim()}`;
  if (typeof action.description === 'string' && action.description.trim()) return `${tool}: ${action.description.trim()}`;
  return `${tool}: completed`;
}

function buildSessionTimeline(context = {}, options = {}) {
  const out = [];
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const results = Array.isArray(context.lastResults) ? context.lastResults : [];
  const pending = Array.isArray(context.pendingActions) ? context.pendingActions : [];
  const limit = Math.max(1, Number(options.limit || 120));

  messages.forEach((m) => {
    const at = toIso(m?.timestamp);
    if (!at) return;
    out.push({
      at,
      type: 'message',
      role: String(m?.role || ''),
      text: String(m?.content || '')
    });
  });

  results.forEach((r) => {
    const at = toIso(r?.timestamp);
    if (!at) return;
    const action = r?.action || {};
    out.push({
      at,
      type: r?.error ? 'tool_error' : 'tool_result',
      role: 'system',
      tool: String(action.tool || ''),
      success: !r?.error,
      text: resultSummary(r)
    });
  });

  if (pending.length > 0) {
    out.push({
      at: new Date().toISOString(),
      type: 'pending',
      role: 'system',
      text: `Pending actions: ${pending.map((x) => String(x.tool || '')).filter(Boolean).join(', ')}`,
      pendingActions: pending.map((x) => ({
        tool: String(x?.tool || ''),
        risk: String(x?.risk || ''),
        description: String(x?.description || '')
      }))
    });
  }

  return out
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-limit);
}

module.exports = {
  buildSessionTimeline
};

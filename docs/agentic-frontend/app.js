const STORAGE_KEY = "social_flow_agentic_frontend_v1";
const REFRESH_INTERVAL_MS = 30000;
const DEFAULT_CONFIG = {
  baseUrl: `${window.location.protocol}//${window.location.host}`,
  apiKey: "",
  workspace: "default",
  operatorId: "",
  operatorName: ""
};

const state = {
  config: loadConfig(),
  chatSessionId: "",
  pendingActions: [],
  ws: null,
  wsEvents: []
};

const $ = (id) => document.getElementById(id);
const nodes = {
  statusPill: $("status-pill"),
  workspacePill: $("workspace-pill"),
  sessionPill: $("session-pill"),
  toastStack: $("toast-stack"),

  screenLinks: Array.from(document.querySelectorAll(".screen-link")),
  screens: Array.from(document.querySelectorAll(".screen")),

  cfgBaseUrl: $("cfg-base-url"),
  cfgApiKey: $("cfg-api-key"),
  cfgWorkspace: $("cfg-workspace"),
  cfgOperatorId: $("cfg-operator-id"),
  cfgOperatorName: $("cfg-operator-name"),
  cfgSave: $("cfg-save"),
  cfgPing: $("cfg-ping"),
  refreshAllBtn: $("refresh-all"),

  metricHealth: $("metric-health"),
  metricReadiness: $("metric-readiness"),
  metricAlerts: $("metric-alerts"),
  metricApprovals: $("metric-approvals"),
  metricSources: $("metric-sources"),
  readinessList: $("readiness-list"),
  nextActionsList: $("next-actions-list"),
  sourcesView: $("sources-view"),
  commandRefreshSources: $("command-refresh-sources"),

  chatStart: $("chat-start"),
  chatSend: $("chat-send"),
  chatClear: $("chat-clear"),
  chatExecutePlan: $("chat-execute-plan"),
  chatInput: $("chat-input"),
  chatLog: $("chat-log"),
  actionPlan: $("action-plan"),
  liveEvents: $("live-events"),
  promptChips: Array.from(document.querySelectorAll(".prompt-chip")),

  reloadQueues: $("reload-queues"),
  approvalsList: $("approvals-list"),
  alertsList: $("alerts-list"),

  diagnoseForm: $("diagnose-form"),
  diagAccount: $("diag-account"),
  diagPreset: $("diag-preset"),
  diagTop: $("diag-top"),
  diagCpc: $("diag-cpc"),
  diagCpm: $("diag-cpm"),
  diagCtr: $("diag-ctr"),
  diagExtra: $("diag-extra"),
  diagCommand: $("diag-command"),
  diagCopy: $("diag-copy"),
  diagnoseOutput: $("diagnose-output"),

  operatorId: $("operator-id"),
  operatorName: $("operator-name"),
  saveOperator: $("save-operator"),
  morningSpend: $("morning-spend"),
  runMorning: $("run-morning"),
  markOnboarding: $("mark-onboarding"),
  guardMode: $("guard-mode"),
  applyGuard: $("apply-guard"),
  handoffTemplate: $("handoff-template"),
  handoffOutdir: $("handoff-outdir"),
  generateHandoff: $("generate-handoff"),
  launchpadReadiness: $("launchpad-readiness"),
  launchpadOutput: $("launchpad-output")
};

function normalizeBaseUrl(raw) {
  const fallback = DEFAULT_CONFIG.baseUrl;
  const value = String(raw || "").trim();
  if (!value) return fallback;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    try {
      return new URL(`http://${value}`).toString().replace(/\/$/, "");
    } catch {
      return fallback;
    }
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_CONFIG, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  } catch {
    // Ignore strict browser mode.
  }
}

function pullConfigFromInputs() {
  state.config.baseUrl = normalizeBaseUrl(nodes.cfgBaseUrl.value);
  state.config.apiKey = String(nodes.cfgApiKey.value || "").trim();
  state.config.workspace = String(nodes.cfgWorkspace.value || "default").trim() || "default";
  state.config.operatorId = String(nodes.cfgOperatorId.value || "").trim();
  state.config.operatorName = String(nodes.cfgOperatorName.value || "").trim();
}

function pushConfigToInputs() {
  nodes.cfgBaseUrl.value = state.config.baseUrl;
  nodes.cfgApiKey.value = state.config.apiKey;
  nodes.cfgWorkspace.value = state.config.workspace;
  nodes.cfgOperatorId.value = state.config.operatorId;
  nodes.cfgOperatorName.value = state.config.operatorName;
  nodes.operatorId.value = state.config.operatorId;
  nodes.operatorName.value = state.config.operatorName;
  nodes.workspacePill.textContent = `Workspace: ${state.config.workspace || "default"}`;
}

function setStatus(kind, text) {
  nodes.statusPill.textContent = text;
  nodes.statusPill.classList.remove("ok", "warn", "err");
  nodes.statusPill.classList.add(kind);
}

function setSession(sessionId) {
  const short = sessionId ? `${sessionId.slice(0, 12)}...` : "--";
  nodes.sessionPill.textContent = `Session: ${short}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\'/g, "&#039;");
}

function toast(message, level = "info") {
  const item = document.createElement("div");
  item.className = `toast ${level}`;
  item.textContent = String(message || "");
  nodes.toastStack.prepend(item);
  setTimeout(() => item.remove(), 3600);
}

function pretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function workspaceQuery() {
  return `workspace=${encodeURIComponent(state.config.workspace || "default")}`;
}

async function requestApi(pathname, { method = "GET", body = null } = {}) {
  const url = new URL(pathname, state.config.baseUrl);
  const headers = {};
  if (state.config.apiKey) headers["x-gateway-key"] = state.config.apiKey;
  if (body !== null) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = raw;
  }
  if (!res.ok) {
    const message = typeof payload === "object" ? payload.error || payload.message : String(payload || "");
    const err = new Error(message || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function errorText(error, fallback = "Request failed") {
  return String(error?.payload?.error || error?.message || fallback);
}
function renderReadiness(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  nodes.readinessList.innerHTML = "";
  if (!checks.length) {
    nodes.readinessList.innerHTML = "<li>No readiness checks available.</li>";
    return;
  }
  checks.forEach((check) => {
    const li = document.createElement("li");
    li.className = check.ok === true ? "ok" : check.ok === false ? "err" : "neutral";
    li.textContent = `${check.key}: ${check.detail}`;
    nodes.readinessList.appendChild(li);
  });
}

function renderNextActions(status, ops, readiness) {
  const summary = ops?.summary || {};
  const failed = Array.isArray(readiness?.report?.checks)
    ? readiness.report.checks.filter((x) => x.ok === false).slice(0, 2)
    : [];

  const actions = [];
  if (!status?.ok) actions.push("Start gateway and verify /api/health.");
  failed.forEach((check) => actions.push(`Resolve ${check.key}: ${check.detail}`));
  if (Number(summary.approvalsPending || 0) > 0) actions.push(`Clear ${summary.approvalsPending} pending approvals.`);
  if (Number(summary.alertsOpen || 0) > 0) actions.push(`Acknowledge ${summary.alertsOpen} open alerts.`);
  if (Number(summary.sourcesConfigured || 0) > Number(summary.sourcesReady || 0)) actions.push("Sync configured sources that are not ready.");
  if (!actions.length) actions.push("Ask Copilot for today's optimization actions and execute with guardrails.");

  nodes.nextActionsList.innerHTML = "";
  actions.slice(0, 4).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    nodes.nextActionsList.appendChild(li);
  });
}

function renderSources(ops) {
  const sources = Array.isArray(ops?.sources) ? ops.sources : [];
  if (!sources.length) {
    nodes.sourcesView.textContent = "No sources configured in this workspace.";
    return;
  }
  const table = document.createElement("table");
  table.className = "sources-table";
  table.innerHTML = "<thead><tr><th>Name</th><th>Connector</th><th>Status</th><th>Sync</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  sources.slice(0, 25).forEach((src) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(src.name || "-")}</td><td>${escapeHtml(src.connector || "-")}</td><td>${escapeHtml(src.status || "unknown")}</td><td>${escapeHtml(src.syncMode || "-")}</td>`;
    tbody.appendChild(tr);
  });
  nodes.sourcesView.innerHTML = "";
  nodes.sourcesView.appendChild(table);
}

async function refreshCommandDeck() {
  setStatus("warn", "Gateway: checking");
  const [healthRes, statusRes, opsRes, readinessRes] = await Promise.allSettled([
    requestApi("/api/health"),
    requestApi("/api/status"),
    requestApi(`/api/ops/summary?${workspaceQuery()}`),
    requestApi(`/api/ops/readiness?${workspaceQuery()}`)
  ]);

  const health = healthRes.status === "fulfilled" ? healthRes.value : null;
  const status = statusRes.status === "fulfilled" ? statusRes.value : null;
  const ops = opsRes.status === "fulfilled" ? opsRes.value : null;
  const readiness = readinessRes.status === "fulfilled" ? readinessRes.value : null;
  const summary = ops?.summary || {};
  const score = readiness?.report?.score || { passed: 0, total: 0 };

  if (health?.ok) {
    setStatus("ok", `Gateway: healthy (${health.version || "unknown"})`);
    nodes.metricHealth.textContent = "Healthy";
  } else {
    const failure = statusRes.status === "rejected" ? errorText(statusRes.reason, "offline") : "offline";
    setStatus("err", `Gateway: ${failure}`);
    nodes.metricHealth.textContent = "Offline";
  }

  nodes.metricReadiness.textContent = score.total ? `${score.passed}/${score.total}` : "--";
  nodes.metricAlerts.textContent = String(summary.alertsOpen ?? "--");
  nodes.metricApprovals.textContent = String(summary.approvalsPending ?? "--");
  nodes.metricSources.textContent = summary.sourcesConfigured !== undefined
    ? `${summary.sourcesReady || 0}/${summary.sourcesConfigured || 0}`
    : "--";

  if (status?.workspace) {
    nodes.workspacePill.textContent = `Workspace: ${status.workspace}`;
  } else {
    nodes.workspacePill.textContent = `Workspace: ${state.config.workspace}`;
  }

  renderReadiness(readiness?.report || {});
  renderNextActions(status || {}, ops || {}, readiness || {});
  renderSources(ops || {});
}

function addChatBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "user" : "assistant"}`;
  bubble.textContent = String(text || "");
  nodes.chatLog.appendChild(bubble);
  nodes.chatLog.scrollTop = nodes.chatLog.scrollHeight;
}

function renderPlan(actions) {
  nodes.actionPlan.innerHTML = "";
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) {
    nodes.actionPlan.innerHTML = "<li>No pending plan. Ask the agent for an action plan.</li>";
    return;
  }
  list.forEach((step, i) => {
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${step.tool || "step"}${step.description ? ` - ${step.description}` : ""}`;
    nodes.actionPlan.appendChild(li);
  });
}

function addWsEvent(type, summary) {
  state.wsEvents.unshift({ type, summary });
  state.wsEvents = state.wsEvents.slice(0, 40);
  nodes.liveEvents.innerHTML = "";
  if (!state.wsEvents.length) {
    nodes.liveEvents.innerHTML = "<li>No live events yet.</li>";
    return;
  }
  state.wsEvents.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.type} - ${item.summary}`;
    nodes.liveEvents.appendChild(li);
  });
}

function closeWs() {
  if (!state.ws) return;
  try {
    state.ws.close();
  } catch {
    // Ignore ws close errors.
  }
  state.ws = null;
}

function connectWs(sessionId) {
  closeWs();
  if (!sessionId) return;
  try {
    const base = new URL(state.config.baseUrl);
    const wsUrl = new URL("/ws", base);
    wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("sessionId", sessionId);
    if (state.config.apiKey) wsUrl.searchParams.set("gatewayKey", state.config.apiKey);

    const ws = new WebSocket(wsUrl.toString());
    state.ws = ws;

    ws.onopen = () => addWsEvent("ws", "connected");
    ws.onerror = () => addWsEvent("ws", "error");
    ws.onclose = () => addWsEvent("ws", "closed");

    ws.onmessage = (event) => {
      let msg = {};
      try {
        msg = JSON.parse(String(event.data || "{}"));
      } catch {
        msg = { type: "output", data: String(event.data || "") };
      }
      const type = String(msg.type || "event");
      const summary = String(msg.summary || msg.data || `step ${msg.step || ""}`).trim() || "event";
      addWsEvent(type, summary);

      if (type === "output" && msg.data) {
        addChatBubble("assistant", msg.data);
      }
      if (type === "plan" && Array.isArray(msg.steps)) {
        state.pendingActions = msg.steps.map((step) => ({
          tool: step.tool,
          params: step.params || {},
          description: step.description || step.tool || ""
        }));
        renderPlan(state.pendingActions);
      }
    };
  } catch (error) {
    addWsEvent("ws", errorText(error, "connection failed"));
  }
}

async function ensureSession(forceNew = false) {
  if (state.chatSessionId && !forceNew) return state.chatSessionId;
  const payload = await requestApi("/api/chat/start", {
    method: "POST",
    body: forceNew ? {} : { sessionId: state.chatSessionId || undefined }
  });
  state.chatSessionId = String(payload.sessionId || "");
  setSession(state.chatSessionId);
  connectWs(state.chatSessionId);
  return state.chatSessionId;
}

async function sendMessage(text, { echoUser = true } = {}) {
  const message = String(text || "").trim();
  if (!message) return null;
  const sessionId = await ensureSession();
  if (echoUser) addChatBubble("user", message);
  const response = await requestApi("/api/chat/message", {
    method: "POST",
    body: { sessionId, message }
  });

  if (response?.response?.message) addChatBubble("assistant", response.response.message);

  const actions = Array.isArray(response?.response?.actions) ? response.response.actions : [];
  state.pendingActions = actions.map((step) => ({
    tool: step.tool,
    params: step.params || {},
    description: step.description || step.tool || ""
  }));
  renderPlan(state.pendingActions);

  if (Array.isArray(response?.executed) && response.executed.length) {
    const report = response.executed
      .map((step) => `${step.success ? "OK" : "FAIL"}: ${step.summary || step.error || step.tool || "step"}`)
      .join("\n");
    addChatBubble("assistant", `Execution summary:\n${report}`);
  }

  return response;
}
async function handleSendChat() {
  const text = nodes.chatInput.value;
  nodes.chatInput.value = "";
  if (!String(text || "").trim()) return;
  try {
    await sendMessage(text, { echoUser: true });
  } catch (error) {
    toast(errorText(error, "Message failed"), "err");
    addChatBubble("assistant", `Error: ${errorText(error)}`);
  }
}

async function executePlan() {
  if (!state.pendingActions.length) {
    toast("No pending plan to execute.", "info");
    return;
  }
  try {
    const sessionId = await ensureSession();
    const out = await requestApi("/api/execute", {
      method: "POST",
      body: {
        sessionId,
        plan: {
          steps: state.pendingActions.map((step) => ({
            tool: step.tool,
            params: step.params,
            description: step.description
          }))
        }
      }
    });

    if (Array.isArray(out.executed) && out.executed.length) {
      const report = out.executed
        .map((step) => `${step.success ? "OK" : "FAIL"}: ${step.summary || step.error || step.tool || "step"}`)
        .join("\n");
      addChatBubble("assistant", `Plan executed:\n${report}`);
    }

    state.pendingActions = [];
    renderPlan(state.pendingActions);
    toast("Plan executed.", "ok");
  } catch (error) {
    toast(errorText(error, "Plan execution failed"), "err");
  }
}

function makeApprovalCard(item) {
  const card = document.createElement("div");
  card.className = "stack-card";
  const id = String(item.id || "");
  const action = String(item.action || item.type || "approval");
  const summary = String(item.summary || item.reason || "Needs decision.");
  const risk = String(item.risk || "").toUpperCase();

  card.innerHTML = `<strong>${escapeHtml(action)}</strong><div class="stack-meta">id: ${escapeHtml(id)}${risk ? ` | risk: ${escapeHtml(risk)}` : ""}</div><p>${escapeHtml(summary)}</p>`;

  const note = document.createElement("textarea");
  note.className = "stack-note";
  note.placeholder = "Decision note";
  card.appendChild(note);

  const row = document.createElement("div");
  row.className = "row";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.textContent = "Approve";
  approveBtn.addEventListener("click", () => resolveApproval(id, "approve", note.value));

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "secondary";
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", () => resolveApproval(id, "reject", note.value));

  row.appendChild(approveBtn);
  row.appendChild(rejectBtn);
  card.appendChild(row);
  return card;
}

function makeAlertCard(item) {
  const card = document.createElement("div");
  card.className = "stack-card";
  const id = String(item.id || "");
  const title = String(item.title || item.type || "alert");
  const detail = String(item.detail || item.message || "");

  card.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="stack-meta">id: ${escapeHtml(id)}</div><p>${escapeHtml(detail)}</p>`;

  const row = document.createElement("div");
  row.className = "row";
  const ackBtn = document.createElement("button");
  ackBtn.type = "button";
  ackBtn.className = "secondary";
  ackBtn.textContent = "Acknowledge";
  ackBtn.addEventListener("click", () => acknowledgeAlert(id));
  row.appendChild(ackBtn);
  card.appendChild(row);
  return card;
}

async function loadQueues() {
  try {
    const approvals = await requestApi(`/api/ops/approvals?${workspaceQuery()}&open=1`);
    const alerts = await requestApi(`/api/ops/alerts?${workspaceQuery()}&open=1`);

    const approvalRows = Array.isArray(approvals?.approvals) ? approvals.approvals : [];
    const alertRows = Array.isArray(alerts?.alerts) ? alerts.alerts : [];

    nodes.approvalsList.innerHTML = "";
    nodes.alertsList.innerHTML = "";

    if (!approvalRows.length) {
      nodes.approvalsList.textContent = "No pending approvals.";
    } else {
      approvalRows.forEach((row) => nodes.approvalsList.appendChild(makeApprovalCard(row)));
    }

    if (!alertRows.length) {
      nodes.alertsList.textContent = "No open alerts.";
    } else {
      alertRows.forEach((row) => nodes.alertsList.appendChild(makeAlertCard(row)));
    }
  } catch (error) {
    nodes.approvalsList.textContent = `Unable to load approvals: ${errorText(error)}`;
    nodes.alertsList.textContent = `Unable to load alerts: ${errorText(error)}`;
  }
}

async function resolveApproval(id, decision, note) {
  try {
    await requestApi("/api/ops/approvals/resolve", {
      method: "POST",
      body: {
        workspace: state.config.workspace,
        id,
        decision,
        note: String(note || "").trim()
      }
    });
    toast(`Approval ${decision}d.`, "ok");
    await Promise.all([loadQueues(), refreshCommandDeck()]);
  } catch (error) {
    toast(errorText(error, "Approval update failed"), "err");
  }
}

async function acknowledgeAlert(id) {
  try {
    await requestApi("/api/ops/alerts/ack", {
      method: "POST",
      body: {
        workspace: state.config.workspace,
        id
      }
    });
    toast("Alert acknowledged.", "ok");
    await Promise.all([loadQueues(), refreshCommandDeck()]);
  } catch (error) {
    toast(errorText(error, "Alert acknowledge failed"), "err");
  }
}

function buildDiagnosisCommand() {
  const account = String(nodes.diagAccount.value || "").trim();
  const preset = String(nodes.diagPreset.value || "last_7d").trim();
  const top = Math.max(1, Number(nodes.diagTop.value || 12) || 12);
  const cpc = Math.max(1, Number(nodes.diagCpc.value || 1.25) || 1.25);
  const cpm = Math.max(1, Number(nodes.diagCpm.value || 1.25) || 1.25);
  const ctr = Math.max(0.1, Number(nodes.diagCtr.value || 0.85) || 0.85);
  const extra = String(nodes.diagExtra.value || "").trim();
  const parts = ["social marketing diagnose-poor-ads"];
  if (account) parts.push(account);
  parts.push(`--preset ${preset}`);
  parts.push(`--top ${top}`);
  parts.push(`--cpc-multiplier ${cpc}`);
  parts.push(`--cpm-multiplier ${cpm}`);
  parts.push(`--ctr-ratio ${ctr}`);
  if (extra) parts.push(extra);
  return parts.join(" ");
}

function updateDiagnosisPreview() {
  nodes.diagCommand.textContent = buildDiagnosisCommand();
}

async function runDiagnosis(event) {
  if (event) event.preventDefault();
  const command = buildDiagnosisCommand();
  nodes.diagnoseOutput.textContent = `Running...\n\n${command}`;
  try {
    const out = await sendMessage(command, { echoUser: false });
    nodes.diagnoseOutput.textContent = out?.response?.message || pretty(out);
    toast("Diagnosis completed.", "ok");
  } catch (error) {
    nodes.diagnoseOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Diagnosis failed"), "err");
  }
}

function writeLaunchpad(title, payload) {
  nodes.launchpadOutput.textContent = `${title}\n\n${pretty(payload)}`;
}

async function refreshLaunchpadReadiness() {
  try {
    const out = await requestApi(`/api/ops/readiness?${workspaceQuery()}`);
    const checks = Array.isArray(out?.report?.checks) ? out.report.checks : [];
    nodes.launchpadReadiness.innerHTML = "";
    if (!checks.length) {
      nodes.launchpadReadiness.textContent = "No readiness checks available.";
      return;
    }
    checks.forEach((check) => {
      const status = check.ok === true ? "OK" : check.ok === false ? "TODO" : "N/A";
      const card = document.createElement("div");
      card.className = "stack-card";
      card.innerHTML = `<strong>${escapeHtml(check.key)}</strong><div class="stack-meta">${status}</div><p>${escapeHtml(check.detail || "")}</p>`;
      nodes.launchpadReadiness.appendChild(card);
    });
  } catch (error) {
    nodes.launchpadReadiness.textContent = `Unable to load readiness: ${errorText(error)}`;
  }
}

async function saveOperator() {
  const id = String(nodes.operatorId.value || "").trim();
  const name = String(nodes.operatorName.value || "").trim();
  if (!id) {
    toast("Operator ID is required.", "err");
    return;
  }
  try {
    const out = await requestApi("/api/team/operator", {
      method: "POST",
      body: { workspace: state.config.workspace, id, name }
    });
    state.config.operatorId = id;
    state.config.operatorName = name;
    nodes.cfgOperatorId.value = id;
    nodes.cfgOperatorName.value = name;
    saveConfig();
    writeLaunchpad("Operator saved", out);
    toast("Operator saved.", "ok");
    await refreshLaunchpadReadiness();
  } catch (error) {
    toast(errorText(error, "Failed to save operator"), "err");
  }
}
async function runMorningOps() {
  try {
    const spend = Number(nodes.morningSpend.value || 0) || 0;
    const out = await requestApi("/api/ops/morning-run", {
      method: "POST",
      body: { workspace: state.config.workspace, spend, force: false }
    });
    writeLaunchpad("Morning run completed", out);
    toast("Morning run completed.", "ok");
    await refreshAll();
  } catch (error) {
    toast(errorText(error, "Morning run failed"), "err");
  }
}

async function markOnboardingComplete() {
  try {
    const out = await requestApi("/api/ops/onboarding/complete", {
      method: "POST",
      body: { workspace: state.config.workspace, completed: true }
    });
    writeLaunchpad("Onboarding marked complete", out);
    toast("Onboarding marked complete.", "ok");
    await refreshLaunchpadReadiness();
  } catch (error) {
    toast(errorText(error, "Failed to mark onboarding"), "err");
  }
}

async function applyGuardMode() {
  try {
    const mode = String(nodes.guardMode.value || "approval").trim();
    const out = await requestApi("/api/ops/guard/mode", {
      method: "POST",
      body: { workspace: state.config.workspace, mode }
    });
    writeLaunchpad(`Guard mode applied (${mode})`, out);
    toast("Guard mode updated.", "ok");
    await refreshAll();
  } catch (error) {
    toast(errorText(error, "Failed to apply guard mode"), "err");
  }
}

async function generateHandoffPack() {
  try {
    const template = String(nodes.handoffTemplate.value || "agency").trim();
    const outDir = String(nodes.handoffOutdir.value || "").trim();
    const payload = {
      workspace: state.config.workspace,
      template,
      studioUrl: state.config.baseUrl,
      gatewayApiKey: state.config.apiKey,
      operatorId: state.config.operatorId
    };
    if (outDir) payload.outDir = outDir;

    const out = await requestApi("/api/ops/handoff/pack", {
      method: "POST",
      body: payload
    });
    writeLaunchpad("Handoff pack generated", out);
    toast("Handoff pack generated.", "ok");
  } catch (error) {
    toast(errorText(error, "Failed to generate handoff"), "err");
  }
}

async function refreshAll() {
  await Promise.all([
    refreshCommandDeck().catch((error) => toast(errorText(error, "Failed to refresh command deck"), "err")),
    loadQueues().catch(() => {}),
    refreshLaunchpadReadiness().catch(() => {})
  ]);
}

function activateScreen(target) {
  nodes.screenLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.screenTarget === target);
  });
  nodes.screens.forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === target);
  });
}

function bindEvents() {
  nodes.screenLinks.forEach((button) => {
    button.addEventListener("click", () => activateScreen(button.dataset.screenTarget || "command"));
  });

  nodes.cfgSave.addEventListener("click", async () => {
    pullConfigFromInputs();
    saveConfig();
    closeWs();
    state.chatSessionId = "";
    setSession("");
    toast("Connection settings saved.", "ok");
    await refreshAll();
  });

  nodes.cfgPing.addEventListener("click", async () => {
    pullConfigFromInputs();
    saveConfig();
    try {
      const health = await requestApi("/api/health");
      setStatus("ok", `Gateway: healthy (${health.version || "unknown"})`);
      toast("Gateway reachable.", "ok");
    } catch (error) {
      setStatus("err", `Gateway: ${errorText(error)}`);
      toast(errorText(error, "Gateway unreachable"), "err");
    }
  });

  nodes.refreshAllBtn.addEventListener("click", () => refreshAll());
  nodes.commandRefreshSources.addEventListener("click", () => refreshCommandDeck());

  nodes.chatStart.addEventListener("click", async () => {
    try {
      await ensureSession(true);
      toast("New chat session ready.", "ok");
    } catch (error) {
      toast(errorText(error, "Unable to start session"), "err");
    }
  });

  nodes.chatSend.addEventListener("click", () => handleSendChat());
  nodes.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSendChat();
    }
  });

  nodes.chatClear.addEventListener("click", () => {
    nodes.chatLog.innerHTML = "";
    addChatBubble("assistant", "Chat cleared. Start a session or send a message.");
    state.pendingActions = [];
    renderPlan(state.pendingActions);
  });

  nodes.chatExecutePlan.addEventListener("click", () => executePlan());

  nodes.promptChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = String(chip.dataset.prompt || "").trim();
      if (!prompt) return;
      nodes.chatInput.value = prompt;
      handleSendChat();
    });
  });

  nodes.reloadQueues.addEventListener("click", () => loadQueues());

  [nodes.diagAccount, nodes.diagPreset, nodes.diagTop, nodes.diagCpc, nodes.diagCpm, nodes.diagCtr, nodes.diagExtra].forEach((input) => {
    input.addEventListener("input", updateDiagnosisPreview);
  });

  nodes.diagnoseForm.addEventListener("submit", (event) => runDiagnosis(event));
  nodes.diagCopy.addEventListener("click", async () => {
    const command = buildDiagnosisCommand();
    try {
      await navigator.clipboard.writeText(command);
      toast("Diagnosis command copied.", "ok");
    } catch {
      toast("Copy failed. Select and copy manually.", "err");
    }
  });

  nodes.saveOperator.addEventListener("click", () => saveOperator());
  nodes.runMorning.addEventListener("click", () => runMorningOps());
  nodes.markOnboarding.addEventListener("click", () => markOnboardingComplete());
  nodes.applyGuard.addEventListener("click", () => applyGuardMode());
  nodes.generateHandoff.addEventListener("click", () => generateHandoffPack());
}

function startAutoRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    refreshAll();
  }, REFRESH_INTERVAL_MS);
}

async function init() {
  pushConfigToInputs();
  bindEvents();
  updateDiagnosisPreview();
  setSession("");
  await refreshAll();
  startAutoRefresh();
}

init().catch((error) => {
  toast(errorText(error, "Frontend initialization failed"), "err");
});


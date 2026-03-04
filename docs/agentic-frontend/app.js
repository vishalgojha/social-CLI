const STORAGE_KEY = "social_flow_agentic_frontend_v1";
const REFRESH_INTERVAL_MS = 30000;
const DEFAULT_CONFIG = {
  baseUrl: `${window.location.protocol}//${window.location.host}`,
  apiKey: "",
  userApiKey: "",
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
  cfgUserApiKey: $("cfg-user-api-key"),
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
  launchpadOutput: $("launchpad-output"),

  keyService: $("key-service"),
  keyLabel: $("key-label"),
  keySecret: $("key-secret"),
  keySave: $("key-save"),
  keyReload: $("key-reload"),
  keysList: $("keys-list"),

  agentSlug: $("agent-slug"),
  agentName: $("agent-name"),
  agentDesc: $("agent-desc"),
  agentToolsInput: $("agent-tools-input"),
  agentSave: $("agent-save"),
  agentReload: $("agent-reload"),
  agentsList: $("agents-list"),

  toolsReload: $("tools-reload"),
  toolsList: $("tools-list"),

  recipeSlug: $("recipe-slug"),
  recipeFormat: $("recipe-format"),
  recipeContent: $("recipe-content"),
  recipeSave: $("recipe-save"),
  recipeReload: $("recipe-reload"),
  recipeRunSlug: $("recipe-run-slug"),
  recipeRun: $("recipe-run"),
  recipesList: $("recipes-list"),
  recipesOutput: $("recipes-output"),

  triggerName: $("trigger-name"),
  triggerType: $("trigger-type"),
  triggerRecipe: $("trigger-recipe"),
  triggerSchedule: $("trigger-schedule"),
  triggerEvent: $("trigger-event"),
  triggerSave: $("trigger-save"),
  triggerReload: $("trigger-reload"),
  triggersList: $("triggers-list"),

  webchatWidgetLabel: $("webchat-widget-label"),
  webchatWidgetCreate: $("webchat-widget-create"),
  webchatWidgetReload: $("webchat-widget-reload"),
  webchatWidgetList: $("webchat-widget-list"),
  webchatPublicWidgetKey: $("webchat-public-widget-key"),
  webchatPublicVisitor: $("webchat-public-visitor"),
  webchatPublicStart: $("webchat-public-start"),
  webchatPublicToken: $("webchat-public-token"),
  webchatPublicMessage: $("webchat-public-message"),
  webchatPublicSend: $("webchat-public-send"),
  webchatPublicOutput: $("webchat-public-output"),
  webchatSessionsReload: $("webchat-sessions-reload"),
  webchatSessionsList: $("webchat-sessions-list"),
  webchatSessionId: $("webchat-session-id"),
  webchatSessionMessage: $("webchat-session-message"),
  webchatSessionReply: $("webchat-session-reply"),
  webchatSessionOpen: $("webchat-session-open"),
  webchatSessionClose: $("webchat-session-close"),
  webchatSessionMessagesReload: $("webchat-session-messages-reload"),
  webchatSessionMessages: $("webchat-session-messages"),

  baileysLabel: $("baileys-label"),
  baileysPhone: $("baileys-phone"),
  baileysCreate: $("baileys-create"),
  baileysReload: $("baileys-reload"),
  baileysSessionsList: $("baileys-sessions-list"),
  baileysSessionId: $("baileys-session-id"),
  baileysConnect: $("baileys-connect"),
  baileysDisconnect: $("baileys-disconnect"),
  baileysDelete: $("baileys-delete"),
  baileysTo: $("baileys-to"),
  baileysMessage: $("baileys-message"),
  baileysSend: $("baileys-send"),
  baileysMessagesReload: $("baileys-messages-reload"),
  baileysOutput: $("baileys-output"),

  logsLimit: $("logs-limit"),
  logsReload: $("logs-reload"),
  logsOutput: $("logs-output")
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
  state.config.userApiKey = String(nodes.cfgUserApiKey.value || "").trim();
  state.config.workspace = String(nodes.cfgWorkspace.value || "default").trim() || "default";
  state.config.operatorId = String(nodes.cfgOperatorId.value || "").trim();
  state.config.operatorName = String(nodes.cfgOperatorName.value || "").trim();
}

function pushConfigToInputs() {
  nodes.cfgBaseUrl.value = state.config.baseUrl;
  nodes.cfgApiKey.value = state.config.apiKey;
  nodes.cfgUserApiKey.value = state.config.userApiKey || "";
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
  if (state.config.userApiKey) headers["x-api-key"] = state.config.userApiKey;
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

function renderStackList(container, items, emptyMessage, renderItem) {
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    container.textContent = emptyMessage;
    return;
  }
  items.forEach((item) => container.appendChild(renderItem(item)));
}

function makeHostedCard({ title, meta = "", body = "" }) {
  const card = document.createElement("div");
  card.className = "stack-card";
  card.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="stack-meta">${escapeHtml(meta)}</div><p>${escapeHtml(body)}</p>`;
  return card;
}

async function loadHostedKeys() {
  try {
    const out = await requestApi("/api/keys");
    const keys = Array.isArray(out?.keys) ? out.keys : [];
    renderStackList(nodes.keysList, keys, "No keys saved for this user.", (row) => {
      const card = makeHostedCard({
        title: `${row.service || "service"} (${row.keyMask || ""})`,
        meta: `id: ${row.id || "-"}${row.label ? ` | ${row.label}` : ""}`,
        body: `updated: ${row.updatedAt || "unknown"}`
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "secondary";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteHostedKey(row.id));
      actionRow.appendChild(del);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.keysList.textContent = `Unable to load keys: ${errorText(error)}`;
  }
}

async function saveHostedKey() {
  const service = String(nodes.keyService.value || "").trim();
  const label = String(nodes.keyLabel.value || "").trim();
  const key = String(nodes.keySecret.value || "").trim();
  if (!service || !key) {
    toast("Service and key are required.", "err");
    return;
  }
  try {
    await requestApi("/api/keys", {
      method: "POST",
      body: { service, label, key }
    });
    nodes.keySecret.value = "";
    toast("Key saved.", "ok");
    await loadHostedKeys();
  } catch (error) {
    toast(errorText(error, "Failed to save key"), "err");
  }
}

async function deleteHostedKey(id) {
  try {
    await requestApi(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Key deleted.", "ok");
    await loadHostedKeys();
  } catch (error) {
    toast(errorText(error, "Failed to delete key"), "err");
  }
}

async function loadHostedAgents() {
  try {
    const out = await requestApi("/api/agents");
    const agents = Array.isArray(out?.agents) ? out.agents : [];
    renderStackList(nodes.agentsList, agents, "No agents available.", (row) => {
      const tools = Array.isArray(row.tools) ? row.tools.join(", ") : "";
      const card = makeHostedCard({
        title: `${row.slug || "-"}${row.source ? ` [${row.source}]` : ""}`,
        meta: row.name || "",
        body: tools || "No tools"
      });
      if (row.source === "user") {
        const actionRow = document.createElement("div");
        actionRow.className = "row";
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteHostedAgent(row.slug));
        actionRow.appendChild(del);
        card.appendChild(actionRow);
      }
      return card;
    });
  } catch (error) {
    nodes.agentsList.textContent = `Unable to load agents: ${errorText(error)}`;
  }
}

async function saveHostedAgent() {
  const slug = String(nodes.agentSlug.value || "").trim();
  const name = String(nodes.agentName.value || "").trim();
  const description = String(nodes.agentDesc.value || "").trim();
  const tools = String(nodes.agentToolsInput.value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!slug || !tools.length) {
    toast("Agent slug and at least one tool are required.", "err");
    return;
  }
  try {
    await requestApi("/api/agents", {
      method: "POST",
      body: { slug, name, description, tools }
    });
    toast("Agent saved.", "ok");
    await loadHostedAgents();
  } catch (error) {
    toast(errorText(error, "Failed to save agent"), "err");
  }
}

async function deleteHostedAgent(slug) {
  try {
    await requestApi(`/api/agents/${encodeURIComponent(slug)}`, { method: "DELETE" });
    toast("Agent deleted.", "ok");
    await loadHostedAgents();
  } catch (error) {
    toast(errorText(error, "Failed to delete agent"), "err");
  }
}

async function loadHostedTools() {
  try {
    const out = await requestApi("/api/tools");
    const tools = Array.isArray(out?.tools) ? out.tools : [];
    renderStackList(nodes.toolsList, tools, "No tools found.", (row) => makeHostedCard({
      title: row.key || "-",
      meta: row.service || "",
      body: row.description || ""
    }));
  } catch (error) {
    nodes.toolsList.textContent = `Unable to load tools: ${errorText(error)}`;
  }
}

async function loadHostedRecipes() {
  try {
    const out = await requestApi("/api/recipes");
    const recipes = Array.isArray(out?.recipes) ? out.recipes : [];
    renderStackList(nodes.recipesList, recipes, "No recipes stored.", (row) => {
      const card = makeHostedCard({
        title: row.slug || "-",
        meta: `${row.mode || "sequential"} | ${row.format || "json"}`,
        body: row.description || `${Array.isArray(row.steps) ? row.steps.length : 0} step(s)`
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const run = document.createElement("button");
      run.type = "button";
      run.textContent = "Run";
      run.addEventListener("click", () => {
        nodes.recipeRunSlug.value = row.slug || "";
        runHostedRecipe();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "secondary";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteHostedRecipe(row.slug));
      actionRow.appendChild(run);
      actionRow.appendChild(del);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.recipesList.textContent = `Unable to load recipes: ${errorText(error)}`;
  }
}

async function saveHostedRecipe() {
  const slug = String(nodes.recipeSlug.value || "").trim();
  const format = String(nodes.recipeFormat.value || "json").trim();
  const content = String(nodes.recipeContent.value || "").trim();
  if (!slug || !content) {
    toast("Recipe slug and content are required.", "err");
    return;
  }
  try {
    await requestApi("/api/recipes", {
      method: "POST",
      body: { slug, format, content }
    });
    toast("Recipe saved.", "ok");
    await loadHostedRecipes();
  } catch (error) {
    toast(errorText(error, "Failed to save recipe"), "err");
  }
}

async function runHostedRecipe() {
  const slug = String(nodes.recipeRunSlug.value || "").trim();
  if (!slug) {
    toast("Recipe slug is required to run.", "err");
    return;
  }
  nodes.recipesOutput.textContent = `Running recipe ${slug}...`;
  try {
    const out = await requestApi(`/api/recipes/${encodeURIComponent(slug)}/run`, {
      method: "POST",
      body: { input: {} }
    });
    nodes.recipesOutput.textContent = pretty(out);
    toast("Recipe executed.", "ok");
    await Promise.all([loadHostedRecipes(), loadHostedLogs()]);
  } catch (error) {
    nodes.recipesOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Recipe run failed"), "err");
  }
}

async function deleteHostedRecipe(slug) {
  try {
    await requestApi(`/api/recipes/${encodeURIComponent(slug)}`, { method: "DELETE" });
    toast("Recipe deleted.", "ok");
    await loadHostedRecipes();
  } catch (error) {
    toast(errorText(error, "Failed to delete recipe"), "err");
  }
}

async function loadHostedTriggers() {
  try {
    const out = await requestApi("/api/triggers");
    const triggers = Array.isArray(out?.triggers) ? out.triggers : [];
    renderStackList(nodes.triggersList, triggers, "No triggers created.", (row) => {
      const descriptor = row.type === "cron"
        ? row.schedule || ""
        : row.type === "event"
          ? row.event_name || ""
          : (row.webhook_path || "");
      const card = makeHostedCard({
        title: row.name || row.id || "-",
        meta: `${row.type || "trigger"} -> ${row.recipe_slug || ""}`,
        body: descriptor
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const run = document.createElement("button");
      run.type = "button";
      run.textContent = "Run";
      run.addEventListener("click", () => runHostedTrigger(row.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "secondary";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteHostedTrigger(row.id));
      actionRow.appendChild(run);
      actionRow.appendChild(del);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.triggersList.textContent = `Unable to load triggers: ${errorText(error)}`;
  }
}

async function saveHostedTrigger() {
  const name = String(nodes.triggerName.value || "").trim();
  const type = String(nodes.triggerType.value || "cron").trim();
  const recipe_slug = String(nodes.triggerRecipe.value || "").trim();
  const schedule = String(nodes.triggerSchedule.value || "").trim();
  const event_name = String(nodes.triggerEvent.value || "").trim();

  if (!recipe_slug) {
    toast("Recipe slug is required for triggers.", "err");
    return;
  }

  const body = { name, type, recipe_slug };
  if (type === "cron" && schedule) body.schedule = schedule;
  if (type === "event" && event_name) body.event_name = event_name;

  try {
    await requestApi("/api/triggers", { method: "POST", body });
    toast("Trigger created.", "ok");
    await loadHostedTriggers();
  } catch (error) {
    toast(errorText(error, "Failed to create trigger"), "err");
  }
}

async function runHostedTrigger(id) {
  try {
    const out = await requestApi(`/api/triggers/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: {}
    });
    nodes.recipesOutput.textContent = pretty(out);
    toast("Trigger fired.", "ok");
    await Promise.all([loadHostedTriggers(), loadHostedLogs()]);
  } catch (error) {
    toast(errorText(error, "Trigger run failed"), "err");
  }
}

async function deleteHostedTrigger(id) {
  try {
    await requestApi(`/api/triggers/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Trigger deleted.", "ok");
    await loadHostedTriggers();
  } catch (error) {
    toast(errorText(error, "Failed to delete trigger"), "err");
  }
}

async function loadHostedLogs() {
  try {
    const limit = Math.max(1, Number(nodes.logsLimit.value || 120) || 120);
    const out = await requestApi(`/api/logs?limit=${encodeURIComponent(limit)}`);
    nodes.logsOutput.textContent = pretty(out.logs || []);
  } catch (error) {
    nodes.logsOutput.textContent = `Unable to load logs: ${errorText(error)}`;
  }
}

async function loadWebchatWidgetKeys() {
  try {
    const out = await requestApi("/api/channels/webchat/widget-keys");
    const keys = Array.isArray(out?.keys) ? out.keys : [];
    renderStackList(nodes.webchatWidgetList, keys, "No widget keys yet.", (row) => {
      const card = makeHostedCard({
        title: row.label || row.id || "widget-key",
        meta: `${row.keyMask || ""} | ${row.status || "active"}`,
        body: `id: ${row.id || "-"}`
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "secondary";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteWebchatWidgetKey(row.id));
      actionRow.appendChild(delBtn);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.webchatWidgetList.textContent = `Unable to load widget keys: ${errorText(error)}`;
  }
}

async function createWebchatWidgetKey() {
  const label = String(nodes.webchatWidgetLabel.value || "").trim();
  try {
    const out = await requestApi("/api/channels/webchat/widget-keys", {
      method: "POST",
      body: { label }
    });
    const secret = String(out?.key?.key || "");
    if (secret) {
      nodes.webchatPublicWidgetKey.value = secret;
      nodes.webchatPublicOutput.textContent = `New widget key (save now): ${secret}`;
    }
    nodes.webchatWidgetLabel.value = "";
    toast("Widget key created.", "ok");
    await loadWebchatWidgetKeys();
  } catch (error) {
    toast(errorText(error, "Failed to create widget key"), "err");
  }
}

async function deleteWebchatWidgetKey(id) {
  try {
    await requestApi(`/api/channels/webchat/widget-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Widget key deleted.", "ok");
    await loadWebchatWidgetKeys();
  } catch (error) {
    toast(errorText(error, "Failed to delete widget key"), "err");
  }
}

async function startPublicWebchatSession() {
  const widgetKey = String(nodes.webchatPublicWidgetKey.value || "").trim();
  const visitorId = String(nodes.webchatPublicVisitor.value || "").trim();
  if (!widgetKey) {
    toast("Widget key is required.", "err");
    return;
  }
  nodes.webchatPublicOutput.textContent = "Starting public session...";
  try {
    const out = await requestApi("/api/webchat/public/session/start", {
      method: "POST",
      body: { widgetKey, visitorId, metadata: { source: "agentic-ui" } }
    });
    nodes.webchatPublicToken.value = String(out.sessionToken || "");
    nodes.webchatSessionId.value = String(out?.session?.id || "");
    nodes.webchatPublicOutput.textContent = pretty(out);
    toast("Public webchat session started.", "ok");
    await loadWebchatSessions();
  } catch (error) {
    nodes.webchatPublicOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to start public session"), "err");
  }
}

async function sendPublicWebchatMessage() {
  const sessionToken = String(nodes.webchatPublicToken.value || "").trim();
  const text = String(nodes.webchatPublicMessage.value || "").trim();
  if (!sessionToken || !text) {
    toast("Session token and message are required.", "err");
    return;
  }
  try {
    const out = await requestApi("/api/webchat/public/session/message", {
      method: "POST",
      body: {
        sessionToken,
        text,
        metadata: { source: "agentic-ui-public" }
      }
    });
    nodes.webchatPublicOutput.textContent = pretty(out);
    nodes.webchatPublicMessage.value = "";
    if (out?.session?.id) nodes.webchatSessionId.value = String(out.session.id);
    toast("Public message sent.", "ok");
    await Promise.all([loadWebchatSessions(), loadWebchatSessionMessages()]);
  } catch (error) {
    nodes.webchatPublicOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to send public message"), "err");
  }
}

async function loadWebchatSessions() {
  try {
    const out = await requestApi("/api/channels/webchat/sessions?limit=120");
    const sessions = Array.isArray(out?.sessions) ? out.sessions : [];
    renderStackList(nodes.webchatSessionsList, sessions, "No webchat sessions yet.", (row) => {
      const card = makeHostedCard({
        title: row.id || "session",
        meta: `${row.status || "open"} | ${row.messageCount || 0} messages`,
        body: row.lastMessagePreview || "No messages"
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.textContent = "Open";
      selectBtn.addEventListener("click", () => {
        nodes.webchatSessionId.value = String(row.id || "");
        loadWebchatSessionMessages();
      });
      actionRow.appendChild(selectBtn);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.webchatSessionsList.textContent = `Unable to load webchat sessions: ${errorText(error)}`;
  }
}

async function loadWebchatSessionMessages() {
  const sessionId = String(nodes.webchatSessionId.value || "").trim();
  if (!sessionId) {
    nodes.webchatSessionMessages.textContent = "Select a webchat session to load messages.";
    return;
  }
  nodes.webchatSessionMessages.textContent = "Loading messages...";
  try {
    const out = await requestApi(`/api/channels/webchat/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`);
    nodes.webchatSessionMessages.textContent = pretty(out.messages || []);
  } catch (error) {
    nodes.webchatSessionMessages.textContent = `Error: ${errorText(error)}`;
  }
}

async function replyWebchatSession() {
  const sessionId = String(nodes.webchatSessionId.value || "").trim();
  const text = String(nodes.webchatSessionMessage.value || "").trim();
  if (!sessionId || !text) {
    toast("Session ID and reply text are required.", "err");
    return;
  }
  try {
    await requestApi(`/api/channels/webchat/sessions/${encodeURIComponent(sessionId)}/reply`, {
      method: "POST",
      body: { text, metadata: { source: "agentic-ui-operator" } }
    });
    nodes.webchatSessionMessage.value = "";
    toast("Reply sent.", "ok");
    await Promise.all([loadWebchatSessions(), loadWebchatSessionMessages(), loadHostedLogs()]);
  } catch (error) {
    toast(errorText(error, "Reply failed"), "err");
  }
}

async function setWebchatSessionStatus(status) {
  const sessionId = String(nodes.webchatSessionId.value || "").trim();
  if (!sessionId) {
    toast("Session ID is required.", "err");
    return;
  }
  try {
    await requestApi(`/api/channels/webchat/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: "POST",
      body: { status }
    });
    toast(`Session marked ${status}.`, "ok");
    await Promise.all([loadWebchatSessions(), loadWebchatSessionMessages()]);
  } catch (error) {
    toast(errorText(error, "Failed to update session status"), "err");
  }
}

async function loadBaileysSessions() {
  try {
    const out = await requestApi("/api/channels/baileys/sessions?limit=120");
    const sessions = Array.isArray(out?.sessions) ? out.sessions : [];
    renderStackList(nodes.baileysSessionsList, sessions, "No Baileys sessions yet.", (row) => {
      const card = makeHostedCard({
        title: row.label || row.id || "baileys-session",
        meta: `${row.status || "idle"}${row.phone ? ` | ${row.phone}` : ""}`,
        body: row.lastError || row.lastMessagePreview || "Ready"
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.textContent = "Select";
      selectBtn.addEventListener("click", () => {
        nodes.baileysSessionId.value = String(row.id || "");
        loadBaileysMessages();
      });
      actionRow.appendChild(selectBtn);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.baileysSessionsList.textContent = `Unable to load Baileys sessions: ${errorText(error)}`;
  }
}

async function createBaileysSession() {
  const label = String(nodes.baileysLabel.value || "").trim();
  const phone = String(nodes.baileysPhone.value || "").trim();
  try {
    const out = await requestApi("/api/channels/baileys/sessions", {
      method: "POST",
      body: { label, phone, metadata: { source: "agentic-ui" } }
    });
    nodes.baileysSessionId.value = String(out?.session?.id || "");
    nodes.baileysOutput.textContent = pretty(out);
    nodes.baileysLabel.value = "";
    toast("Baileys session created.", "ok");
    await loadBaileysSessions();
  } catch (error) {
    toast(errorText(error, "Failed to create Baileys session"), "err");
  }
}

async function connectBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Baileys session ID is required.", "err");
    return;
  }
  nodes.baileysOutput.textContent = "Connecting session...";
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/connect`, {
      method: "POST",
      body: {}
    });
    nodes.baileysOutput.textContent = pretty(out);
    toast("Baileys connect started.", "ok");
  } catch (error) {
    nodes.baileysOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Baileys connect failed"), "err");
  } finally {
    await loadBaileysSessions();
  }
}

async function disconnectBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Baileys session ID is required.", "err");
    return;
  }
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
      method: "POST",
      body: {}
    });
    nodes.baileysOutput.textContent = pretty(out);
    toast("Baileys session disconnected.", "ok");
    await loadBaileysSessions();
  } catch (error) {
    toast(errorText(error, "Baileys disconnect failed"), "err");
  }
}

async function deleteBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Baileys session ID is required.", "err");
    return;
  }
  try {
    await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
    nodes.baileysSessionId.value = "";
    nodes.baileysOutput.textContent = "Session deleted.";
    toast("Baileys session deleted.", "ok");
    await loadBaileysSessions();
  } catch (error) {
    toast(errorText(error, "Failed to delete Baileys session"), "err");
  }
}

async function sendBaileysMessage() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  const to = String(nodes.baileysTo.value || "").trim();
  const text = String(nodes.baileysMessage.value || "").trim();
  if (!sessionId || !text) {
    toast("Session ID and message are required.", "err");
    return;
  }
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: "POST",
      body: { to, text, metadata: { source: "agentic-ui" } }
    });
    nodes.baileysOutput.textContent = pretty(out);
    nodes.baileysMessage.value = "";
    toast("Baileys message sent.", "ok");
    await Promise.all([loadBaileysSessions(), loadBaileysMessages(), loadHostedLogs()]);
  } catch (error) {
    nodes.baileysOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to send Baileys message"), "err");
  }
}

async function loadBaileysMessages() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    nodes.baileysOutput.textContent = "Select a Baileys session to load messages.";
    return;
  }
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`);
    nodes.baileysOutput.textContent = pretty(out.messages || []);
  } catch (error) {
    nodes.baileysOutput.textContent = `Error: ${errorText(error)}`;
  }
}

async function refreshAll() {
  await Promise.all([
    refreshCommandDeck().catch((error) => toast(errorText(error, "Failed to refresh command deck"), "err")),
    loadQueues().catch(() => {}),
    refreshLaunchpadReadiness().catch(() => {}),
    loadHostedKeys().catch(() => {}),
    loadHostedAgents().catch(() => {}),
    loadHostedTools().catch(() => {}),
    loadHostedRecipes().catch(() => {}),
    loadHostedTriggers().catch(() => {}),
    loadHostedLogs().catch(() => {}),
    loadWebchatWidgetKeys().catch(() => {}),
    loadWebchatSessions().catch(() => {}),
    loadBaileysSessions().catch(() => {})
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

  nodes.keySave.addEventListener("click", () => saveHostedKey());
  nodes.keyReload.addEventListener("click", () => loadHostedKeys());

  nodes.agentSave.addEventListener("click", () => saveHostedAgent());
  nodes.agentReload.addEventListener("click", () => loadHostedAgents());

  nodes.toolsReload.addEventListener("click", () => loadHostedTools());

  nodes.recipeSave.addEventListener("click", () => saveHostedRecipe());
  nodes.recipeReload.addEventListener("click", () => loadHostedRecipes());
  nodes.recipeRun.addEventListener("click", () => runHostedRecipe());

  nodes.triggerSave.addEventListener("click", () => saveHostedTrigger());
  nodes.triggerReload.addEventListener("click", () => loadHostedTriggers());

  nodes.webchatWidgetCreate.addEventListener("click", () => createWebchatWidgetKey());
  nodes.webchatWidgetReload.addEventListener("click", () => loadWebchatWidgetKeys());
  nodes.webchatPublicStart.addEventListener("click", () => startPublicWebchatSession());
  nodes.webchatPublicSend.addEventListener("click", () => sendPublicWebchatMessage());
  nodes.webchatSessionsReload.addEventListener("click", () => loadWebchatSessions());
  nodes.webchatSessionReply.addEventListener("click", () => replyWebchatSession());
  nodes.webchatSessionOpen.addEventListener("click", () => setWebchatSessionStatus("open"));
  nodes.webchatSessionClose.addEventListener("click", () => setWebchatSessionStatus("closed"));
  nodes.webchatSessionMessagesReload.addEventListener("click", () => loadWebchatSessionMessages());

  nodes.baileysCreate.addEventListener("click", () => createBaileysSession());
  nodes.baileysReload.addEventListener("click", () => loadBaileysSessions());
  nodes.baileysConnect.addEventListener("click", () => connectBaileysSession());
  nodes.baileysDisconnect.addEventListener("click", () => disconnectBaileysSession());
  nodes.baileysDelete.addEventListener("click", () => deleteBaileysSession());
  nodes.baileysSend.addEventListener("click", () => sendBaileysMessage());
  nodes.baileysMessagesReload.addEventListener("click", () => loadBaileysMessages());

  nodes.logsReload.addEventListener("click", () => loadHostedLogs());
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


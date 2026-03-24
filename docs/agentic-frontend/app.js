const STORAGE_KEY = "social_flow_agentic_frontend_v1";
const REFRESH_INTERVAL_MS = 30000;
const WS_RECONNECT_MIN_MS = 1000;
const WS_RECONNECT_MAX_MS = 15000;
const WS_RECONNECT_JITTER_MS = 300;

function defaultGatewayBaseUrl() {
  const injectedUrl = String(window.__SOCIAL_FLOW_GATEWAY__?.url || "").trim();
  if (injectedUrl) {
    try {
      return new URL(injectedUrl).toString().replace(/\/$/, "");
    } catch {
      // ignore malformed injected value and fall through
    }
  }

  const locationBase = `${window.location.protocol}//${window.location.host}`;
  const host = String(window.location.hostname || "").toLowerCase();
  const port = String(window.location.port || "");
  if ((host === "127.0.0.1" || host === "localhost") && port === "4173") {
    return `${window.location.protocol}//${host}:1310`;
  }

  return locationBase;
}

const DEFAULT_CONFIG = {
  baseUrl: defaultGatewayBaseUrl(),
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
  wsReconnectTimer: null,
  wsReconnectAttempts: 0,
  wsAutoReconnect: false,
  wsEvents: [],
  setupSnapshot: null,
  setupDraftInitialized: false,
  adminSnapshot: null
};

const $ = (id) => document.getElementById(id);
const nodes = {
  statusPill: $("status-pill"),
  workspacePill: $("workspace-pill"),
  sessionPill: $("session-pill"),
  toastStack: $("toast-stack"),
  sideRail: document.querySelector(".side-rail"),
  sidebarToggle: $("sidebar-toggle"),
  sidebarScrim: $("sidebar-scrim"),
  moduleTabs: Array.from(document.querySelectorAll(".module-tab")),
  navDrawers: Array.from(document.querySelectorAll(".nav-drawer")),
  navDrawerToggles: Array.from(document.querySelectorAll(".nav-drawer-toggle")),
  viewKicker: $("view-kicker"),
  viewTitle: $("view-title"),
  viewSummary: $("view-summary"),

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

  setupMetrics: $("setup-metrics"),
  setupChecklist: $("setup-checklist"),
  setupDefaultApi: $("setup-default-api"),
  setupFacebookToken: $("setup-facebook-token"),
  setupInstagramToken: $("setup-instagram-token"),
  setupWhatsappToken: $("setup-whatsapp-token"),
  setupAppId: $("setup-app-id"),
  setupAppSecret: $("setup-app-secret"),
  setupAgentProvider: $("setup-agent-provider"),
  setupAgentModel: $("setup-agent-model"),
  setupAgentApiKey: $("setup-agent-api-key"),
  setupSave: $("setup-save"),
  setupFinish: $("setup-finish"),
  setupReload: $("setup-reload"),
  setupOutput: $("setup-output"),
  setupActionConnectWhatsapp: $("setup-action-connect-whatsapp"),
  setupActionRunDoctor: $("setup-action-run-doctor"),
  setupActionSendTest: $("setup-action-send-test"),
  setupProgressTitle: $("setup-progress-title"),
  setupProgressCopy: $("setup-progress-copy"),
  setupProgressBar: $("setup-progress-bar"),
  setupProgressSteps: $("setup-progress-steps"),
  setupNextStepTitle: $("setup-next-step-title"),
  setupNextStepCopy: $("setup-next-step-copy"),
  setupOpenWhatsappDashboard: $("setup-open-whatsapp-dashboard"),
  setupOpenGuidedMenu: $("setup-open-guided-menu"),
  setupGuidedMenu: $("setup-guided-menu"),

  adminReload: $("admin-reload"),
  adminMetrics: $("admin-metrics"),
  adminChecks: $("admin-checks"),
  adminPaths: $("admin-paths"),
  adminPlaybook: $("admin-playbook"),
  adminInviteRole: $("admin-invite-role"),
  adminInviteHours: $("admin-invite-hours"),
  adminInviteBaseUrl: $("admin-invite-base-url"),
  adminInviteCreate: $("admin-invite-create"),
  adminTeamReload: $("admin-team-reload"),
  adminInviteStats: $("admin-invite-stats"),
  adminRolesList: $("admin-roles-list"),
  adminInvitesList: $("admin-invites-list"),
  adminActivityLimit: $("admin-activity-limit"),
  adminActivityReload: $("admin-activity-reload"),
  adminActivityExport: $("admin-activity-export"),
  adminActivityList: $("admin-activity-list"),
  adminOutput: $("admin-output"),

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
  webchatWidgetCopy: $("webchat-widget-copy"),
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
  baileysMessages: $("baileys-messages"),

  logsLimit: $("logs-limit"),
  logsReload: $("logs-reload"),
  logsOutput: $("logs-output")
};

const SCREEN_META = {
  command: {
    group: "overview",
    kicker: "Overview",
    title: "Command Deck",
    summary: "Use the home screen to confirm readiness, triage approvals, and choose the next lane."
  },
  approvals: {
    group: "overview",
    kicker: "Overview",
    title: "Approvals",
    summary: "Resolve pending decisions quickly with context, audit-safe notes, and clean queue visibility."
  },
  logs: {
    group: "overview",
    kicker: "Overview",
    title: "Logs",
    summary: "Review traces, runtime history, and recent hosted events without leaving the state lane."
  },
  copilot: {
    group: "run",
    kicker: "Run Flows",
    title: "Agent Copilot",
    summary: "Conversational control with live execution events and approval-safe plan execution."
  },
  diagnose: {
    group: "run",
    kicker: "Run Flows",
    title: "Ads Diagnosis",
    summary: "Run guided diagnosis commands from a user-friendly form and capture immediate operator actions."
  },
  launchpad: {
    group: "run",
    kicker: "Run Flows",
    title: "Launchpad",
    summary: "One-click operational flows for onboarding, guardrails, recurring routines, and runbooks."
  },
  agents: {
    group: "build",
    kicker: "Build",
    title: "Agents",
    summary: "Manage built-in specialists and custom crews from a visual registry."
  },
  tools: {
    group: "build",
    kicker: "Build",
    title: "Tool Registry",
    summary: "Typed callable tools with service-aligned contracts and descriptions."
  },
  recipes: {
    group: "build",
    kicker: "Build",
    title: "Recipes",
    summary: "Compose saved workflow stacks, execute them, and inspect outputs in one surface."
  },
  triggers: {
    group: "build",
    kicker: "Build",
    title: "Triggers",
    summary: "Map cron, webhook, and event entry points to reusable recipes."
  },
  webchat: {
    group: "channels",
    kicker: "Channels",
    title: "Website Chat",
    summary: "Run site conversations, visitor tests, and operator replies from one cleaner inbox."
  },
  baileys: {
    group: "channels",
    kicker: "Channels",
    title: "WhatsApp Web",
    summary: "Manage WhatsApp lines, QR pairing, and message history with operator-friendly controls."
  },
  setup: {
    group: "configure",
    kicker: "Configure",
    title: "Setup",
    summary: "Connect tokens, app credentials, and AI providers without editing process environment variables."
  },
  keys: {
    group: "configure",
    kicker: "Configure",
    title: "Keys",
    summary: "Store per-user encrypted provider keys with masked reads and fast operator controls."
  },
  admin: {
    group: "configure",
    kicker: "Configure",
    title: "Admin",
    summary: "Self-hosted deployment confidence for hardening, storage, team access, and operator activity."
  }
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
    const merged = { ...DEFAULT_CONFIG, ...(parsed || {}) };
    merged.baseUrl = normalizeBaseUrl(merged.baseUrl);

    // Auto-repair the common local static-host misconfiguration where API calls
    // are pointed at the frontend host (:4173) instead of the gateway (:1310).
    const host = String(window.location.hostname || "").toLowerCase();
    const isLocalStaticHost = (host === "127.0.0.1" || host === "localhost")
      && String(window.location.port || "") === "4173";
    const usingFrontendAsGateway = /https?:\/\/(127\.0\.0\.1|localhost):4173$/i.test(merged.baseUrl);
    if (isLocalStaticHost && usingFrontendAsGateway) {
      merged.baseUrl = DEFAULT_CONFIG.baseUrl;
    }

    return merged;
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
  if (!String(nodes.adminInviteBaseUrl.value || "").trim()) {
    nodes.adminInviteBaseUrl.value = state.config.baseUrl;
  }
  nodes.workspacePill.textContent = `Workspace: ${state.config.workspace || "default"}`;
}

function setStatus(kind, text) {
  nodes.statusPill.textContent = text;
  nodes.statusPill.classList.remove("ok", "warn", "err");
  nodes.statusPill.classList.add(kind);
}

function setSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) {
    nodes.sessionPill.textContent = "Copilot: waiting";
    return;
  }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    nodes.sessionPill.textContent = "Copilot: live";
    return;
  }
  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
    nodes.sessionPill.textContent = "Copilot: connecting";
    return;
  }
  if (state.wsReconnectTimer || state.wsAutoReconnect) {
    nodes.sessionPill.textContent = "Copilot: reconnecting";
    return;
  }
  nodes.sessionPill.textContent = "Copilot: session ready";
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

function defaultAgentModel(provider) {
  const normalized = String(provider || "openai").trim().toLowerCase();
  if (normalized === "ollama") return "qwen2.5:7b";
  if (normalized === "anthropic") return "claude-3-5-sonnet-latest";
  if (normalized === "openrouter") return "openai/gpt-4o-mini";
  if (normalized === "xai") return "grok-2-latest";
  if (normalized === "gemini") return "gemini-1.5-pro";
  return "gpt-4o-mini";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  try {
    return date.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return date.toLocaleString();
  }
}

function firstPresent(values, fallback = "") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return fallback;
}

function activityStamp(...values) {
  const value = values.find(Boolean);
  return value ? `Updated ${formatDateTime(value)}` : "";
}

async function copyTextToClipboard(value, { success = "Copied.", empty = "Nothing to copy yet." } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    toast(empty, "err");
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(success, "ok");
    return true;
  } catch {
    toast("Copy failed. Select and copy manually.", "err");
    return false;
  }
}

function selectBaileysSession(sessionId, { focusComposer = false, loadMessages = false } = {}) {
  const id = String(sessionId || "").trim();
  nodes.baileysSessionId.value = id;
  if (focusComposer) {
    window.requestAnimationFrame(() => nodes.baileysTo?.focus());
  }
  if (loadMessages) {
    void loadBaileysMessages();
  }
}

function extractBaileysSession(payload) {
  if (payload && typeof payload.session === "object" && payload.session) return payload.session;
  if (payload && typeof payload === "object") return payload;
  return {};
}

function formatBaileysPairingOutput(payload, fallback = "") {
  const session = extractBaileysSession(payload);
  const lines = [];
  const title = firstPresent([session.label, session.phone, session.id], "WhatsApp line");
  lines.push(`Line: ${title}`);
  if (session.status) lines.push(`State: ${labelFromKey(session.status)}`);

  if (session.qr) {
    lines.push("QR ready. Scan it from WhatsApp on the phone.");
    if (session.qrUpdatedAt) lines.push(`Updated ${formatDateTime(session.qrUpdatedAt)}`);
    lines.push("");
    lines.push("Raw QR payload:");
    lines.push(String(session.qr));
    return lines.join("\n");
  }

  if (session.lastConnectedAt) lines.push(`Connected ${formatDateTime(session.lastConnectedAt)}`);
  if (session.lastDisconnectedAt) lines.push(`Last disconnected ${formatDateTime(session.lastDisconnectedAt)}`);
  if (session.lastError) lines.push(`Note: ${session.lastError}`);
  if (fallback) lines.push(fallback);

  return lines.filter(Boolean).join("\n");
}

function labelFromKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDurationLabel(value) {
  const raw = String(value || "").trim();
  if (raw) return raw;
  return "--";
}

function isCompactNavigation() {
  return window.matchMedia("(max-width: 1040px)").matches;
}

function screenExists(target) {
  return nodes.screens.some((screen) => screen.dataset.screen === target);
}

function resolveScreenTarget(raw) {
  const target = String(raw || "").trim().replace(/^#/, "").toLowerCase();
  return screenExists(target) ? target : "command";
}

function updateViewHeader(target) {
  const meta = SCREEN_META[target] || SCREEN_META.command;
  nodes.viewKicker.textContent = meta.kicker;
  nodes.viewTitle.textContent = meta.title;
  nodes.viewSummary.textContent = meta.summary;
  document.title = `Social Flow Studio · ${meta.title}`;
}

function setDrawerState(drawer, open) {
  if (!drawer) return;
  drawer.classList.toggle("is-open", open);
  const toggle = drawer.querySelector(".nav-drawer-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function openDrawer(group, { exclusive = false } = {}) {
  void exclusive;
  nodes.navDrawers.forEach((drawer) => {
    const isMatch = drawer.dataset.navDrawer === group;
    setDrawerState(drawer, isMatch);
  });
  nodes.moduleTabs.forEach((button) => {
    const isMatch = button.dataset.moduleTarget === group;
    button.classList.toggle("active", isMatch);
    button.setAttribute("aria-selected", isMatch ? "true" : "false");
  });
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  nodes.sidebarToggle?.setAttribute("aria-expanded", "false");
}

function openSidebar() {
  if (!isCompactNavigation()) return;
  document.body.classList.add("sidebar-open");
  nodes.sidebarToggle?.setAttribute("aria-expanded", "true");
  const activeGroup = nodes.screenLinks.find((button) => button.classList.contains("active"))?.dataset.navGroup;
  if (activeGroup) openDrawer(activeGroup, { exclusive: false });
}

function toggleSidebar() {
  if (document.body.classList.contains("sidebar-open")) {
    closeSidebar();
    return;
  }
  openSidebar();
}

function syncScreenHistory(target, historyMode = "push") {
  const nextHash = `#${target}`;
  if (window.location.hash === nextHash) return;
  const action = historyMode === "replace" ? "replaceState" : "pushState";
  window.history[action](null, "", nextHash);
}

function iconSvg(name) {
  const icons = {
    spark: `<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 4l.8 2.2L22 7l-2.2.8L19 10l-.8-2.2L16 7l2.2-.8L19 4Z"/><path d="M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3l7 4v5c0 4.2-2.4 7.2-7 9-4.6-1.8-7-4.8-7-9V7l7-4Z"/><path d="M8.5 12.5l2.2 2.2 4.8-5"/></svg>`,
    diagnose: `<svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-4"/></svg>`,
    rocket: `<svg viewBox="0 0 24 24"><path d="M5 19h14"/><path d="M8 16l4-11 4 11"/><path d="M9.5 12h5"/></svg>`,
    setup: `<svg viewBox="0 0 24 24"><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M6.5 6.5l2.8 2.8"/><path d="M14.7 14.7l2.8 2.8"/><path d="M17.5 6.5l-2.8 2.8"/><path d="M9.3 14.7l-2.8 2.8"/><circle cx="12" cy="12" r="3.5"/></svg>`,
    key: `<svg viewBox="0 0 24 24"><circle cx="8.5" cy="12" r="3.5"/><path d="M12 12h8"/><path d="M17 12v3"/><path d="M20 12v2"/></svg>`,
    agent: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19"/><path d="M4 7h2"/><path d="M18 7h2"/></svg>`,
    router: `<svg viewBox="0 0 24 24"><path d="M6 6.5h5.5A2.5 2.5 0 0 1 14 9v0A2.5 2.5 0 0 0 16.5 11.5H18"/><path d="M18 11.5l-2.5-2.5"/><path d="M18 11.5L15.5 14"/><path d="M6 17.5h5.5A2.5 2.5 0 0 0 14 15v0a2.5 2.5 0 0 1 2.5-2.5H18"/></svg>`,
    marketing: `<svg viewBox="0 0 24 24"><path d="M4 13.5V10a1.5 1.5 0 0 1 1.5-1.5H9l6-3v13l-6-3H5.5A1.5 1.5 0 0 1 4 13.5Z"/><path d="M18 9.5a4.5 4.5 0 0 1 0 5"/><path d="M20 8a7 7 0 0 1 0 8"/></svg>`,
    messaging: `<svg viewBox="0 0 24 24"><path d="M5 6h14v9H9l-4 4Z"/><path d="M9 10h6"/><path d="M9 13h4"/></svg>`,
    analytics: `<svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-7"/></svg>`,
    ops: `<svg viewBox="0 0 24 24"><path d="M12 3l2.4 1.4 2.8-.2.8 2.7 2.3 1.6-1.1 2.5 1.1 2.5-2.3 1.6-.8 2.7-2.8-.2L12 21l-2.4-1.4-2.8.2-.8-2.7-2.3-1.6 1.1-2.5-1.1-2.5 2.3-1.6.8-2.7 2.8.2L12 3Z"/><path d="M9.5 12.2l1.6 1.6 3.4-3.5"/></svg>`,
    browser: `<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17"/><path d="M7 7.2h.01"/><path d="M10 7.2h.01"/><path d="M13 7.2h.01"/></svg>`,
    tool: `<svg viewBox="0 0 24 24"><path d="M14 5l5 5"/><path d="M10 19l-5-5"/><path d="M13 6l-7 7"/><path d="M18 11l-7 7"/></svg>`,
    recipe: `<svg viewBox="0 0 24 24"><path d="M7 4.5h10"/><path d="M7 9.5h10"/><path d="M7 14.5h6"/><path d="M17 17.5l2 2 3-4"/></svg>`,
    trigger: `<svg viewBox="0 0 24 24"><path d="M12 3v5"/><path d="M12 16v5"/><path d="M5 12h5"/><path d="M14 12h5"/><circle cx="12" cy="12" r="4"/></svg>`,
    webchat: `<svg viewBox="0 0 24 24"><path d="M5 6h14v9H9l-4 4Z"/><path d="M9 10h6"/><path d="M9 13h4"/></svg>`,
    baileys: `<svg viewBox="0 0 24 24"><path d="M7 5.5h10A3.5 3.5 0 0 1 20.5 9v5A3.5 3.5 0 0 1 17 17.5H9l-4 3v-4A3.5 3.5 0 0 1 3.5 14V9A3.5 3.5 0 0 1 7 5.5Z"/><path d="M9 10h6"/><path d="M9 13h5"/></svg>`,
    logs: `<svg viewBox="0 0 24 24"><path d="M6 5.5h12"/><path d="M6 12h12"/><path d="M6 18.5h8"/></svg>`,
    command: `<svg viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h10"/><path d="M17 15l3 3-3 3"/></svg>`
  };
  return icons[name] || icons.spark;
}

function compactList(values, limit = 4) {
  const list = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (list.length <= limit) return list;
  return [...list.slice(0, limit), `+${list.length - limit} more`];
}

function inferToolIcon(service, key) {
  const text = `${service || ""} ${key || ""}`.toLowerCase();
  if (text.includes("browser")) return "browser";
  if (text.includes("baileys") || text.includes("whatsapp")) return "baileys";
  if (text.includes("webchat")) return "webchat";
  if (text.includes("meta")) return "marketing";
  if (text.includes("gateway") || text.includes("log")) return "logs";
  if (text.includes("cli")) return "ops";
  return "tool";
}

function inferAgentIcon(agent = {}) {
  const slug = String(agent.slug || "").toLowerCase();
  if (slug.includes("router")) return "router";
  if (slug.includes("marketing")) return "marketing";
  if (slug.includes("messaging")) return "messaging";
  if (slug.includes("analytics")) return "analytics";
  if (slug.includes("ops")) return "ops";
  if (slug.includes("browser")) return "browser";
  if (slug.includes("webchat")) return "webchat";
  if (slug.includes("baileys") || slug.includes("whatsapp")) return "baileys";
  return "agent";
}

function inferSetupIcon(meta, title = "") {
  const status = String(meta || "").toLowerCase();
  const label = String(title || "").toLowerCase();
  if (status === "ready" || status === "complete") return "shield";
  if (label.includes("app") || label.includes("onboarding")) return "setup";
  if (label.includes("agent")) return "agent";
  if (label.includes("token")) return "key";
  return status === "required" ? "trigger" : "spark";
}

function writeSetupOutput(title, payload) {
  nodes.setupOutput.textContent = `${title}\n\n${pretty(payload)}`;
}

function writeAdminOutput(title, payload) {
  nodes.adminOutput.textContent = `${title}\n\n${pretty(payload)}`;
}

function makeMetricCard(label, value) {
  const card = document.createElement("article");
  card.className = "metric-card";
  const labelNode = document.createElement("p");
  labelNode.className = "metric-label";
  labelNode.textContent = label;
  const valueNode = document.createElement("p");
  valueNode.className = "metric-value";
  valueNode.textContent = value;
  card.appendChild(labelNode);
  card.appendChild(valueNode);
  return card;
}

function setupSecretPlaceholder(prefix, configured, preview = "") {
  if (configured) {
    return preview ? `${prefix} saved (${preview}). Paste a new value to replace it.` : `${prefix} saved. Paste a new value to replace it.`;
  }
  return `Paste ${prefix.toLowerCase()}`;
}

function populateSetupForm(snapshot, { force = false } = {}) {
  const cfg = snapshot?.config || {};
  if (!force && state.setupDraftInitialized) return;
  nodes.setupDefaultApi.value = String(cfg.defaultApi || "facebook");
  nodes.setupAppId.value = String(cfg?.app?.appId || "");
  const provider = String(cfg?.agent?.provider || "openai");
  nodes.setupAgentProvider.value = provider;
  nodes.setupAgentProvider.dataset.lastProvider = provider;
  nodes.setupAgentModel.value = String(cfg?.agent?.model || defaultAgentModel(provider));
  state.setupDraftInitialized = true;
}

function clearSetupSensitiveInputs() {
  nodes.setupFacebookToken.value = "";
  nodes.setupInstagramToken.value = "";
  nodes.setupWhatsappToken.value = "";
  nodes.setupAppSecret.value = "";
  nodes.setupAgentApiKey.value = "";
}

function applySetupPlaceholders(snapshot) {
  const cfg = snapshot?.config || {};
  nodes.setupFacebookToken.placeholder = setupSecretPlaceholder(
    "Facebook token",
    Boolean(cfg?.tokens?.facebook?.configured),
    String(cfg?.tokens?.facebook?.preview || "")
  );
  nodes.setupInstagramToken.placeholder = setupSecretPlaceholder(
    "Instagram token",
    Boolean(cfg?.tokens?.instagram?.configured),
    String(cfg?.tokens?.instagram?.preview || "")
  );
  nodes.setupWhatsappToken.placeholder = setupSecretPlaceholder(
    "WhatsApp token",
    Boolean(cfg?.tokens?.whatsapp?.configured),
    String(cfg?.tokens?.whatsapp?.preview || "")
  );
  nodes.setupAppSecret.placeholder = setupSecretPlaceholder(
    "App Secret",
    Boolean(cfg?.app?.appSecretConfigured)
  );
  nodes.setupAgentApiKey.placeholder = setupSecretPlaceholder(
    "Agent API key",
    Boolean(cfg?.agent?.apiKeyConfigured)
  );
}

function renderSetupMetrics(snapshot) {
  const report = snapshot?.readiness || {};
  const cfg = snapshot?.config || {};
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const tracksReady = [
    Boolean(cfg?.tokens?.[cfg?.defaultApi || "facebook"]?.configured),
    Boolean(cfg?.app?.appId) && Boolean(cfg?.app?.appSecretConfigured),
    Boolean(cfg?.agent?.apiKeyConfigured),
    Boolean(cfg?.onboarding?.completed)
  ].filter(Boolean).length;

  nodes.setupMetrics.innerHTML = "";
  [
    { label: "Core Setup", value: report.ok ? "Ready" : "Action" },
    { label: "Blockers", value: String(blockers.length) },
    { label: "Warnings", value: String(warnings.length) },
    { label: "Tracks Ready", value: `${tracksReady}/4` }
  ].forEach((item) => nodes.setupMetrics.appendChild(makeMetricCard(item.label, item.value)));
}

function setupProgressSteps(snapshot) {
  const cfg = snapshot?.config || {};
  const defaultApi = String(cfg.defaultApi || "whatsapp");
  return [
    {
      label: `Connect ${defaultApi}`,
      done: Boolean(cfg?.tokens?.[defaultApi]?.configured),
      detail: cfg?.tokens?.[defaultApi]?.configured
        ? `${defaultApi} token saved`
        : `Add the ${defaultApi} token`
    },
    {
      label: "Meta app",
      done: Boolean(cfg?.app?.appId) && Boolean(cfg?.app?.appSecretConfigured),
      detail: cfg?.app?.appId && cfg?.app?.appSecretConfigured
        ? "App ID and App Secret saved"
        : "Save App ID and App Secret"
    },
    {
      label: "AI helper",
      done: Boolean(cfg?.agent?.apiKeyConfigured),
      detail: cfg?.agent?.apiKeyConfigured
        ? `${cfg?.agent?.provider || "AI provider"} ready`
        : "Save the AI provider key"
    },
    {
      label: "Finish",
      done: Boolean(cfg?.onboarding?.completed),
      detail: cfg?.onboarding?.completed
        ? "Onboarding complete"
        : "Use Save + Finish Setup"
    }
  ];
}

function renderSetupJourney(snapshot) {
  const steps = setupProgressSteps(snapshot);
  const doneCount = steps.filter((step) => step.done).length;
  const total = steps.length || 1;
  const percent = Math.round((doneCount / total) * 100);
  const report = snapshot?.readiness || {};
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];

  nodes.setupProgressTitle.textContent = `Setup progress: ${percent}%`;
  nodes.setupProgressCopy.textContent = blockers.length
    ? `${doneCount} of ${total} steps are ready. We still have ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to clear.`
    : doneCount === total
      ? "Everything essential is ready. You can finish setup or move into operations."
      : `${doneCount} of ${total} steps are ready. Follow the next-step card to keep moving.`;
  nodes.setupProgressBar.style.width = `${percent}%`;
  nodes.setupProgressSteps.innerHTML = "";
  steps.forEach((step) => {
    const chip = document.createElement("div");
    chip.className = `setup-progress-step${step.done ? " is-done" : ""}`;
    chip.innerHTML = `
      <strong>${escapeHtml(step.label)}</strong>
      <span>${escapeHtml(step.detail)}</span>
    `;
    nodes.setupProgressSteps.appendChild(chip);
  });
}

function buildSetupGuidedActions(snapshot) {
  const cfg = snapshot?.config || {};
  const report = snapshot?.readiness || {};
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const defaultApi = String(cfg.defaultApi || "whatsapp");
  const actions = [];

  if (!cfg?.tokens?.whatsapp?.configured) {
    actions.push({
      title: "Connect WhatsApp token",
      body: "Open the Meta dashboard, copy the token, and paste it into the WhatsApp token field.",
      action: "connect-whatsapp",
      actionLabel: "Guide me there"
    });
  }

  if (!cfg?.app?.appId || !cfg?.app?.appSecretConfigured) {
    actions.push({
      title: "Save Meta app credentials",
      body: "App ID and App Secret unlock smoother diagnosis and OAuth-style setup recovery.",
      action: "focus-app",
      actionLabel: "Fill app details"
    });
  }

  if (!cfg?.agent?.apiKeyConfigured) {
    actions.push({
      title: "Save AI helper key",
      body: "This powers the guided assistant so non-technical operators can ask for help naturally.",
      action: "focus-ai",
      actionLabel: "Set AI key"
    });
  }

  if (cfg?.tokens?.[defaultApi]?.configured && cfg?.agent?.apiKeyConfigured && blockers.length > 0) {
    actions.push({
      title: "Run a guided doctor check",
      body: "Let Copilot inspect the remaining setup blockers and suggest the next safe fix.",
      action: "run-doctor",
      actionLabel: "Open doctor"
    });
  }

  if (report.ok === true && !cfg?.onboarding?.completed) {
    actions.push({
      title: "Finish onboarding",
      body: "You have the essentials saved. The last step is marking onboarding complete.",
      action: "finish-setup",
      actionLabel: "Finish setup"
    });
  }

  if (!actions.length) {
    actions.push({
      title: "You are ready to test",
      body: "Setup looks healthy. Move to the WhatsApp lane and send a first test message.",
      action: "send-test",
      actionLabel: "Open test flow"
    });
  }

  return actions.slice(0, 4);
}

function renderSetupGuidedMenu(snapshot) {
  const report = snapshot?.readiness || {};
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const actions = buildSetupGuidedActions(snapshot);
  const first = actions[0];

  nodes.setupNextStepTitle.textContent = first?.title || "You are ready to go";
  nodes.setupNextStepCopy.textContent = first?.body
    || (blockers.length
      ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} still need attention.`
      : warnings.length
        ? `${warnings.length} recommended improvement${warnings.length === 1 ? "" : "s"} remain.`
        : "Everything essential is in place.");

  nodes.setupGuidedMenu.innerHTML = "";
  actions.forEach((item) => {
    const card = document.createElement("article");
    card.className = "setup-guided-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body)}</p>
      </div>
      <button type="button" class="secondary" data-setup-action="${escapeHtml(item.action)}">${escapeHtml(item.actionLabel)}</button>
    `;
    nodes.setupGuidedMenu.appendChild(card);
  });
}

function renderSetupChecklist(snapshot) {
  const cfg = snapshot?.config || {};
  const report = snapshot?.readiness || {};
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const defaultApi = String(cfg.defaultApi || "facebook");

  const rows = [
    {
      title: `Default ${defaultApi} token`,
      meta: cfg?.tokens?.[defaultApi]?.configured ? "READY" : "ACTION",
      body: cfg?.tokens?.[defaultApi]?.configured
        ? `Saved ${cfg.tokens[defaultApi].preview || "token"} for the active API.`
        : `Paste a ${defaultApi} token so the agent can act without env vars.`
    },
    {
      title: "Meta app credentials",
      meta: cfg?.app?.appId && cfg?.app?.appSecretConfigured ? "READY" : "RECOMMENDED",
      body: cfg?.app?.appId
        ? `App ID ${cfg.app.appId}${cfg.app.appSecretConfigured ? " with secret saved." : " saved, but App Secret is still missing."}`
        : "Save App ID and App Secret to unlock OAuth and advanced diagnostics."
    },
    {
      title: "Agent AI provider",
      meta: cfg?.agent?.apiKeyConfigured ? "READY" : "ACTION",
      body: cfg?.agent?.apiKeyConfigured
        ? `${cfg.agent.provider || "openai"} is configured for Copilot${cfg.agent.model ? ` using ${cfg.agent.model}` : ""}.`
        : `Save a ${cfg?.agent?.provider || "openai"} API key so non-technical users can use Copilot without env vars.`
    },
    {
      title: "Onboarding state",
      meta: cfg?.onboarding?.completed ? "COMPLETE" : "PENDING",
      body: cfg?.onboarding?.completed
        ? `Marked complete${cfg?.onboarding?.completedAt ? ` at ${cfg.onboarding.completedAt}` : ""}.`
        : "Save required setup, then use Save + Finish Setup to mark onboarding complete."
    }
  ];

  blockers.forEach((item) => {
    rows.push({
      title: `Blocker: ${item.code || "setup"}`,
      meta: "REQUIRED",
      body: `${item.message || ""}${item.fix ? ` Next: ${item.fix}` : ""}`.trim()
    });
  });

  warnings.forEach((item) => {
    rows.push({
      title: `Recommended: ${item.code || "warning"}`,
      meta: "OPTIONAL",
      body: `${item.message || ""}${item.fix ? ` Next: ${item.fix}` : ""}`.trim()
    });
  });

  renderStackList(nodes.setupChecklist, rows, "No setup guidance available.", (row) => makeHostedCard({
    title: row.title,
    eyebrow: row.meta,
    body: row.body,
    icon: inferSetupIcon(row.meta, row.title)
  }));
}

function applySetupSnapshot(snapshot, options = {}) {
  state.setupSnapshot = snapshot;
  renderSetupJourney(snapshot);
  renderSetupGuidedMenu(snapshot);
  renderSetupMetrics(snapshot);
  renderSetupChecklist(snapshot);
  applySetupPlaceholders(snapshot);
  populateSetupForm(snapshot, { force: Boolean(options.forcePopulate) });
}

async function loadSetupSnapshot(options = {}) {
  try {
    const out = await requestApi("/api/config");
    applySetupSnapshot(out, options);
    if (options.writeOutput) writeSetupOutput("Saved setup loaded", out);
    return out;
  } catch (error) {
    nodes.setupChecklist.textContent = `Unable to load setup: ${errorText(error)}`;
    if (nodes.setupMetrics) {
      nodes.setupMetrics.innerHTML = "";
      nodes.setupMetrics.appendChild(makeMetricCard("Core Setup", "Error"));
    }
    throw error;
  }
}

function buildSetupPayload() {
  const body = {
    defaultApi: String(nodes.setupDefaultApi.value || "facebook").trim().toLowerCase(),
    tokens: {},
    app: {},
    agent: {}
  };

  const facebook = String(nodes.setupFacebookToken.value || "").trim();
  const instagram = String(nodes.setupInstagramToken.value || "").trim();
  const whatsapp = String(nodes.setupWhatsappToken.value || "").trim();
  const appId = String(nodes.setupAppId.value || "").trim();
  const appSecret = String(nodes.setupAppSecret.value || "").trim();
  const provider = String(nodes.setupAgentProvider.value || "openai").trim().toLowerCase();
  const model = String(nodes.setupAgentModel.value || "").trim();
  const apiKey = String(nodes.setupAgentApiKey.value || "").trim();

  if (facebook) body.tokens.facebook = facebook;
  if (instagram) body.tokens.instagram = instagram;
  if (whatsapp) body.tokens.whatsapp = whatsapp;
  if (appId) body.app.appId = appId;
  if (appSecret) body.app.appSecret = appSecret;
  if (provider) body.agent.provider = provider;
  if (model) body.agent.model = model;
  if (apiKey) body.agent.apiKey = apiKey;

  return body;
}

async function saveSetupConfiguration({ markComplete = false } = {}) {
  const payload = buildSetupPayload();
  const out = await requestApi("/api/config/update", {
    method: "POST",
    body: payload
  });
  clearSetupSensitiveInputs();
  applySetupSnapshot(out, { forcePopulate: true });
  writeSetupOutput("Setup saved", out);

  if (!markComplete) {
    toast("Setup saved.", "ok");
    return out;
  }

  const report = out?.readiness || {};
  if (report.ok !== true) {
    toast("Core setup still has blockers. Finish those before marking onboarding complete.", "err");
    return out;
  }

  const finish = await requestApi("/api/config/update", {
    method: "POST",
    body: { onboarding: { completed: true } }
  });
  applySetupSnapshot(finish, { forcePopulate: true });
  writeSetupOutput("Setup saved and onboarding completed", finish);
  toast("Setup saved and onboarding completed.", "ok");
  await refreshAll();
  return finish;
}

function syncSetupModelForProvider(force = false) {
  const provider = String(nodes.setupAgentProvider.value || "openai").trim().toLowerCase();
  const previous = String(nodes.setupAgentProvider.dataset.lastProvider || provider);
  const previousDefault = defaultAgentModel(previous);
  const nextDefault = defaultAgentModel(provider);
  const currentModel = String(nodes.setupAgentModel.value || "").trim();
  if (force || !currentModel || currentModel === previousDefault) {
    nodes.setupAgentModel.value = nextDefault;
  }
  nodes.setupAgentModel.placeholder = nextDefault;
  nodes.setupAgentProvider.dataset.lastProvider = provider;
}

function focusAndSelect(node) {
  if (!node) return;
  try {
    node.focus({ preventScroll: false });
  } catch {
    node.focus();
  }
  if (typeof node.select === "function") {
    node.select();
  }
}

function openExternalUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function runSetupGuidedAction(action) {
  const next = String(action || "").trim().toLowerCase();
  if (!next) return;

  if (next === "connect-whatsapp") {
    activateScreen("setup");
    nodes.setupDefaultApi.value = "whatsapp";
    openExternalUrl("https://developers.facebook.com/apps/");
    focusAndSelect(nodes.setupWhatsappToken);
    writeSetupOutput("WhatsApp token guide", {
      next: "Paste the WhatsApp token into the field after copying it from Meta App Dashboard -> WhatsApp -> API Setup.",
      dashboard: "https://developers.facebook.com/apps/"
    });
    toast("WhatsApp token helper opened.", "ok");
    return;
  }

  if (next === "focus-app") {
    activateScreen("setup");
    focusAndSelect(nodes.setupAppId);
    toast("Add your Meta App ID and App Secret here.", "ok");
    return;
  }

  if (next === "focus-ai") {
    activateScreen("setup");
    focusAndSelect(nodes.setupAgentApiKey);
    toast("Paste the AI provider key here.", "ok");
    return;
  }

  if (next === "run-doctor") {
    activateScreen("copilot");
    nodes.chatInput.value = "Run setup doctor and tell me what is missing in plain English.";
    focusAndSelect(nodes.chatInput);
    toast("Doctor prompt loaded in Copilot.", "ok");
    return;
  }

  if (next === "send-test") {
    activateScreen("baileys");
    toast("WhatsApp test lane opened. Create or pick a line, then send a test message.", "ok");
    return;
  }

  if (next === "finish-setup") {
    await saveSetupConfiguration({ markComplete: true });
    return;
  }

  if (next === "guided-menu") {
    activateScreen("launchpad");
    toast("Guided menu opened.", "ok");
  }
}

function renderAdminMetrics(system) {
  const security = system?.security || {};
  const setup = system?.setup || {};
  const runtime = system?.runtime || {};
  nodes.adminMetrics.innerHTML = "";
  [
    { label: "Gateway Version", value: system?.version || "--" },
    { label: "Uptime", value: formatDurationLabel(runtime.uptime) },
    { label: "Gateway Guard", value: security.apiKeyRequired ? "Locked" : "Open" },
    { label: "Studio Assets", value: setup.studioFrontendInstalled ? "Ready" : "Missing" },
    { label: "Onboarding", value: setup.onboardingCompleted ? "Complete" : "Pending" }
  ].forEach((item) => nodes.adminMetrics.appendChild(makeMetricCard(item.label, item.value)));
}

function renderAdminChecks(system) {
  const rows = Array.isArray(system?.checks) ? system.checks : [];
  renderStackList(nodes.adminChecks, rows, "No self-hosted checks available.", (row) => makeHostedCard({
    title: labelFromKey(row.key || "check"),
    eyebrow: row.ok ? "Ready" : row.severity === "recommended" ? "Recommended" : "Required",
    meta: row.detail || "",
    body: row.fix ? `Next: ${row.fix}` : "",
    icon: row.ok ? "shield" : row.severity === "recommended" ? "spark" : "trigger"
  }));
}

function renderAdminPaths(system) {
  const rows = Array.isArray(system?.paths) ? system.paths : [];
  renderStackList(nodes.adminPaths, rows, "No storage paths reported.", (row) => makeHostedCard({
    title: row.label || labelFromKey(row.key || "path"),
    eyebrow: row.exists ? "Present" : "Missing",
    body: row.path || "Path unavailable.",
    chips: [row.key || ""],
    icon: row.exists ? "shield" : "logs"
  }));
}

function renderAdminPlaybook(system) {
  const runtime = system?.runtime || {};
  const network = system?.network || {};
  const commands = system?.commands || {};
  const nextActions = Array.isArray(system?.nextActions) ? system.nextActions : [];
  const lines = [
    `Version: ${system?.version || "--"}`,
    `Workspace: ${system?.workspace || "--"}`,
    `Runtime: ${runtime.node || "--"} on ${runtime.platform || "--"} (${runtime.arch || "--"})`,
    `Gateway URL: ${network.baseUrl || "--"}`,
    "",
    "Core Commands:",
    `  doctor  -> ${commands.doctor || "social doctor"}`,
    `  status  -> ${commands.status || "social status"}`,
    `  start   -> ${commands.start || "social start"}`,
    `  studio  -> ${commands.studio || "social studio"}`,
    `  upgrade -> ${commands.upgrade || "npm install -g @vishalgojha/social-flow@latest"}`,
    `  backup  -> ${commands.backup || "Back up the config and hosted data directories."}`
  ];
  if (nextActions.length) {
    lines.push("", "Next Actions:");
    nextActions.forEach((item) => lines.push(`  - ${item}`));
  }
  nodes.adminPlaybook.textContent = lines.join("\n");
}

function renderAdminInviteStats(stats) {
  nodes.adminInviteStats.innerHTML = "";
  [
    { label: "Active Invites", value: String(stats?.active ?? "--") },
    { label: "Accepted", value: String(stats?.accepted ?? "--") },
    { label: "Expired", value: String(stats?.expiredRecent ?? "--") },
    { label: "Avg Accept", value: Number(stats?.avgAcceptMs || 0) > 0 ? `${Math.round(Number(stats.avgAcceptMs) / 60000)}m` : "--" }
  ].forEach((item) => nodes.adminInviteStats.appendChild(makeMetricCard(item.label, item.value)));
}

async function loadSelfHostedAdmin() {
  try {
    const out = await requestApi("/api/self-host/admin");
    const system = out?.system || {};
    state.adminSnapshot = system;
    if (!String(nodes.adminInviteBaseUrl.value || "").trim()) {
      nodes.adminInviteBaseUrl.value = String(system?.network?.baseUrl || state.config.baseUrl || "");
    }
    renderAdminMetrics(system);
    renderAdminChecks(system);
    renderAdminPaths(system);
    renderAdminPlaybook(system);
  } catch (error) {
    nodes.adminChecks.textContent = `Unable to load admin snapshot: ${errorText(error)}`;
    nodes.adminPaths.textContent = `Unable to load storage paths: ${errorText(error)}`;
    nodes.adminPlaybook.textContent = `Unable to load playbook: ${errorText(error)}`;
  }
}

async function loadTeamRoles() {
  try {
    const out = await requestApi(`/api/team/roles?workspace=${encodeURIComponent(state.config.workspace || "default")}`);
    const roles = Array.isArray(out?.roles) ? out.roles : [];
    renderStackList(nodes.adminRolesList, roles, "No team roles assigned yet.", (row) => makeHostedCard({
      title: row.user || "user",
      eyebrow: row.role || "viewer",
      meta: `${row.scope || "workspace"} scope`,
      body: row.workspaceRole
        ? `Workspace role ${row.workspaceRole}${row.globalRole ? `, global fallback ${row.globalRole}` : ""}.`
        : `Global role ${row.globalRole || "viewer"}.`,
      icon: row.role === "owner" || row.role === "admin" ? "shield" : "agent"
    }));
  } catch (error) {
    nodes.adminRolesList.textContent = `Unable to load roles: ${errorText(error)}`;
  }
}

async function loadTeamInvites() {
  try {
    const out = await requestApi(`/api/team/invites?workspace=${encodeURIComponent(state.config.workspace || "default")}`);
    const invites = Array.isArray(out?.invites) ? out.invites : [];
    renderStackList(nodes.adminInvitesList, invites, "No invites created yet.", (row) => {
      const card = makeHostedCard({
        title: row.role || "invite",
        eyebrow: row.status || "active",
        meta: row.createdBy ? `created by ${row.createdBy}` : "",
        body: row.expiresAt
          ? `Expires ${formatDateTime(row.expiresAt)}${row.acceptedBy ? `. Accepted by ${row.acceptedBy}.` : "."}`
          : "No expiration recorded.",
        chips: [
          row.id || "",
          row.tokenMasked || "",
          row.acceptedAt ? `Accepted ${formatDateTime(row.acceptedAt)}` : ""
        ],
        icon: row.status === "accepted" ? "shield" : row.status === "active" ? "spark" : "logs"
      });
      if (row.status === "active") {
        const actionRow = document.createElement("div");
        actionRow.className = "row";
        const resendBtn = document.createElement("button");
        resendBtn.type = "button";
        resendBtn.textContent = "Resend";
        resendBtn.addEventListener("click", () => resendTeamInvite(row.id));
        const revokeBtn = document.createElement("button");
        revokeBtn.type = "button";
        revokeBtn.className = "secondary";
        revokeBtn.textContent = "Revoke";
        revokeBtn.addEventListener("click", () => revokeTeamInvite(row.id));
        actionRow.appendChild(resendBtn);
        actionRow.appendChild(revokeBtn);
        card.appendChild(actionRow);
      }
      return card;
    });
  } catch (error) {
    nodes.adminInvitesList.textContent = `Unable to load invites: ${errorText(error)}`;
  }
}

async function loadTeamInviteStats() {
  try {
    const out = await requestApi(`/api/team/invites/stats?workspace=${encodeURIComponent(state.config.workspace || "default")}&days=30`);
    renderAdminInviteStats(out?.stats || {});
  } catch (error) {
    nodes.adminInviteStats.innerHTML = "";
    nodes.adminInviteStats.appendChild(makeMetricCard("Invite Stats", "Error"));
  }
}

async function loadTeamActivity() {
  const limit = Math.max(5, Math.min(200, Number(nodes.adminActivityLimit.value || 25) || 25));
  try {
    const out = await requestApi(`/api/team/activity?workspace=${encodeURIComponent(state.config.workspace || "default")}&limit=${encodeURIComponent(limit)}`);
    const rows = Array.isArray(out?.activity) ? out.activity : [];
    renderStackList(nodes.adminActivityList, rows, "No team activity logged yet.", (row) => makeHostedCard({
      title: row.summary || row.action || "activity",
      eyebrow: row.status || "logged",
      meta: `${row.actor || "system"} • ${formatDateTime(row.createdAt) || row.createdAt || "time unknown"}`,
      body: row.why || row.action || "",
      chips: [row.action || "", row.risk || ""],
      icon: row.status === "success" ? "shield" : row.status === "error" ? "trigger" : "spark"
    }));
  } catch (error) {
    nodes.adminActivityList.textContent = `Unable to load activity: ${errorText(error)}`;
  }
}

async function exportTeamActivityJson() {
  const limit = Math.max(5, Math.min(200, Number(nodes.adminActivityLimit.value || 25) || 25));
  try {
    const out = await requestApi(`/api/team/activity/export?workspace=${encodeURIComponent(state.config.workspace || "default")}&format=json&limit=${encodeURIComponent(limit)}`);
    writeAdminOutput("Team activity exported", out);
    toast("Team activity exported to output panel.", "ok");
  } catch (error) {
    toast(errorText(error, "Failed to export activity"), "err");
  }
}

async function createTeamInvite() {
  try {
    const role = String(nodes.adminInviteRole.value || "operator").trim();
    const expiresInHours = Math.max(1, Math.min(720, Number(nodes.adminInviteHours.value || 72) || 72));
    const baseUrl = String(nodes.adminInviteBaseUrl.value || state.config.baseUrl || "").trim();
    const out = await requestApi("/api/team/invites", {
      method: "POST",
      body: {
        workspace: state.config.workspace || "default",
        role,
        expiresInHours,
        baseUrl
      }
    });
    writeAdminOutput("Invite created", out?.invite || out);
    toast("Invite created.", "ok");
    await Promise.all([loadTeamInvites(), loadTeamInviteStats()]);
  } catch (error) {
    toast(errorText(error, "Failed to create invite"), "err");
  }
}

async function resendTeamInvite(id) {
  try {
    const out = await requestApi("/api/team/invites/resend", {
      method: "POST",
      body: {
        workspace: state.config.workspace || "default",
        id,
        baseUrl: String(nodes.adminInviteBaseUrl.value || state.config.baseUrl || "").trim(),
        expiresInHours: Math.max(1, Math.min(720, Number(nodes.adminInviteHours.value || 72) || 72))
      }
    });
    writeAdminOutput("Invite rotated", out?.invite || out);
    toast("Invite link rotated.", "ok");
    await Promise.all([loadTeamInvites(), loadTeamInviteStats()]);
  } catch (error) {
    toast(errorText(error, "Failed to rotate invite"), "err");
  }
}

async function revokeTeamInvite(id) {
  try {
    await requestApi("/api/team/invites/revoke", {
      method: "POST",
      body: {
        workspace: state.config.workspace || "default",
        id
      }
    });
    toast("Invite revoked.", "ok");
    await Promise.all([loadTeamInvites(), loadTeamInviteStats()]);
  } catch (error) {
    toast(errorText(error, "Failed to revoke invite"), "err");
  }
}

async function loadAdminSurface() {
  await Promise.all([
    loadSelfHostedAdmin(),
    loadTeamRoles(),
    loadTeamInvites(),
    loadTeamInviteStats(),
    loadTeamActivity()
  ]);
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

function clearWsReconnectTimer() {
  if (!state.wsReconnectTimer) return;
  window.clearTimeout(state.wsReconnectTimer);
  state.wsReconnectTimer = null;
}

function nextWsReconnectDelay() {
  const backoff = Math.min(
    WS_RECONNECT_MAX_MS,
    WS_RECONNECT_MIN_MS * (2 ** Math.min(state.wsReconnectAttempts, 4))
  );
  return backoff + Math.floor(Math.random() * WS_RECONNECT_JITTER_MS);
}

function disposeWs() {
  if (!state.ws) return;
  const ws = state.ws;
  state.ws = null;
  ws.onopen = null;
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  try {
    ws.close();
  } catch {
    // Ignore ws close errors.
  }
}

function scheduleWsReconnect(reason = "connection closed") {
  const sessionId = String(state.chatSessionId || "").trim();
  if (!state.wsAutoReconnect || !sessionId || state.ws || state.wsReconnectTimer) {
    setSession(sessionId);
    return;
  }

  const delayMs = nextWsReconnectDelay();
  state.wsReconnectAttempts += 1;
  addWsEvent("ws", `${reason}. Retrying in ${Math.ceil(delayMs / 1000)}s.`);
  state.wsReconnectTimer = window.setTimeout(() => {
    state.wsReconnectTimer = null;
    connectWs(sessionId, { isReconnect: true });
  }, delayMs);
  setSession(sessionId);
}

function closeWs() {
  state.wsAutoReconnect = false;
  state.wsReconnectAttempts = 0;
  clearWsReconnectTimer();
  disposeWs();
  setSession(state.chatSessionId);
}

function connectWs(sessionId, { isReconnect = false } = {}) {
  clearWsReconnectTimer();
  disposeWs();
  if (!sessionId) return;
  try {
    state.wsAutoReconnect = true;
    const base = new URL(state.config.baseUrl);
    const wsUrl = new URL("/ws", base);
    wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("sessionId", sessionId);
    if (state.config.apiKey) wsUrl.searchParams.set("gatewayKey", state.config.apiKey);

    const ws = new WebSocket(wsUrl.toString());
    state.ws = ws;
    setSession(sessionId);

    ws.onopen = () => {
      if (state.ws !== ws) return;
      state.wsReconnectAttempts = 0;
      clearWsReconnectTimer();
      addWsEvent("ws", isReconnect ? "reconnected" : "connected");
      setSession(sessionId);
    };
    ws.onerror = () => {
      if (state.ws !== ws) return;
      addWsEvent("ws", "error");
    };
    ws.onclose = (event) => {
      if (state.ws !== ws) return;
      state.ws = null;
      addWsEvent("ws", event.wasClean ? "closed" : "disconnected");
      setSession(sessionId);
      scheduleWsReconnect("session disconnected");
    };

    ws.onmessage = (event) => {
      if (state.ws !== ws) return;
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
    state.wsAutoReconnect = false;
    state.wsReconnectAttempts = 0;
    addWsEvent("ws", errorText(error, "connection failed"));
    setSession(sessionId);
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
      const card = makeHostedCard({
        title: check.key,
        eyebrow: status,
        body: check.detail || "No detail provided.",
        icon: check.ok === true ? "shield" : check.ok === false ? "trigger" : "spark"
      });
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

function makeHostedCard({ title, meta = "", body = "", eyebrow = "", icon = "spark", chips = [], className = "" }) {
  const card = document.createElement("div");
  card.className = ["stack-card", className].filter(Boolean).join(" ");
  const renderedChips = compactList(chips).map((chip) => `<span class="entity-chip">${escapeHtml(chip)}</span>`).join("");
  card.innerHTML = `
    <div class="entity-head">
      <span class="entity-icon" aria-hidden="true">${iconSvg(icon)}</span>
      <div class="entity-copy">
        ${eyebrow ? `<div class="entity-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<div class="stack-meta">${escapeHtml(meta)}</div>` : ""}
        ${body ? `<p>${escapeHtml(body)}</p>` : ""}
        ${renderedChips ? `<div class="entity-chips">${renderedChips}</div>` : ""}
      </div>
    </div>
  `;
  return card;
}

async function loadHostedKeys() {
  try {
    const out = await requestApi("/api/keys");
    const keys = Array.isArray(out?.keys) ? out.keys : [];
    renderStackList(nodes.keysList, keys, "No keys saved for this user.", (row) => {
      const card = makeHostedCard({
        title: row.label || row.service || "Stored key",
        eyebrow: row.service || "secret",
        meta: `id ${row.id || "-"}`,
        body: `Masked value ${row.keyMask || "unavailable"}`,
        chips: [
          row.keyMask || "",
          row.updatedAt ? `Updated ${formatDateTime(row.updatedAt)}` : ""
        ],
        icon: "key"
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
      const card = makeHostedCard({
        title: row.name || row.slug || "Agent",
        eyebrow: row.source === "user" ? "Custom Agent" : "Built-in Agent",
        meta: row.slug ? `slug ${row.slug}` : "",
        body: row.description || "No description provided.",
        chips: Array.isArray(row.tools) && row.tools.length ? row.tools : ["No tools"],
        icon: inferAgentIcon(row),
        className: "agent-card"
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
      eyebrow: row.service || "tool",
      body: row.description || "No description provided.",
      chips: [row.key || ""],
      icon: inferToolIcon(row.service, row.key)
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
      const stepCount = Array.isArray(row.steps) ? row.steps.length : 0;
      const card = makeHostedCard({
        title: row.slug || "-",
        eyebrow: "Recipe",
        meta: row.description || `${row.mode || "sequential"} workflow`,
        body: `${row.format || "json"} format${stepCount ? ` with ${stepCount} step(s)` : ""}`,
        chips: [row.mode || "sequential", row.format || "json", stepCount ? `${stepCount} step(s)` : ""],
        icon: "recipe"
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
        eyebrow: `${row.type || "trigger"} trigger`,
        meta: row.recipe_slug ? `recipe ${row.recipe_slug}` : "Recipe not linked",
        body: descriptor || "No trigger descriptor available.",
        chips: [row.id || "", descriptor || ""],
        icon: "trigger"
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
    renderStackList(nodes.webchatWidgetList, keys, "No access keys yet.", (row) => {
      const card = makeHostedCard({
        title: row.label || "Website access key",
        eyebrow: row.status || "active",
        meta: activityStamp(row.updatedAt, row.createdAt),
        body: row.keyMask ? `Stored key ${row.keyMask}` : "Ready for site chat.",
        chips: [row.keyMask || "", row.status || "active"],
        icon: "webchat"
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
    nodes.webchatWidgetList.textContent = `Unable to load access keys: ${errorText(error)}`;
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
      nodes.webchatPublicOutput.textContent = [
        "New website install key created.",
        "Copy it now. The full key is only shown once.",
        "",
        secret
      ].join("\n");
    }
    nodes.webchatWidgetLabel.value = "";
    toast("Access key created.", "ok");
    await loadWebchatWidgetKeys();
  } catch (error) {
    toast(errorText(error, "Failed to create access key"), "err");
  }
}

async function deleteWebchatWidgetKey(id) {
  try {
    await requestApi(`/api/channels/webchat/widget-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Access key deleted.", "ok");
    await loadWebchatWidgetKeys();
  } catch (error) {
    toast(errorText(error, "Failed to delete access key"), "err");
  }
}

async function startPublicWebchatSession() {
  const widgetKey = String(nodes.webchatPublicWidgetKey.value || "").trim();
  const visitorId = String(nodes.webchatPublicVisitor.value || "").trim();
  if (!widgetKey) {
    toast("Website access key is required.", "err");
    return;
  }
  nodes.webchatPublicOutput.textContent = "Starting test conversation...";
  try {
    const out = await requestApi("/api/webchat/public/session/start", {
      method: "POST",
      body: { widgetKey, visitorId, metadata: { source: "agentic-ui" } }
    });
    nodes.webchatPublicToken.value = String(out.sessionToken || "");
    nodes.webchatSessionId.value = String(out?.session?.id || "");
    nodes.webchatPublicOutput.textContent = [
      "Test conversation started.",
      out.sessionToken ? "Temporary reply token added above." : "",
      out?.session?.id ? "Conversation selected in the reply panel." : ""
    ].filter(Boolean).join("\n");
    toast("Website chat started.", "ok");
    await loadWebchatSessions();
  } catch (error) {
    nodes.webchatPublicOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to start website chat"), "err");
  }
}

async function sendPublicWebchatMessage() {
  const sessionToken = String(nodes.webchatPublicToken.value || "").trim();
  const text = String(nodes.webchatPublicMessage.value || "").trim();
  if (!sessionToken || !text) {
    toast("Temporary reply token and message are required.", "err");
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
    nodes.webchatPublicOutput.textContent = [
      "Visitor message sent.",
      out?.session?.id ? "Conversation refreshed in the reply panel." : ""
    ].filter(Boolean).join("\n");
    nodes.webchatPublicMessage.value = "";
    if (out?.session?.id) nodes.webchatSessionId.value = String(out.session.id);
    toast("Visitor message sent.", "ok");
    await Promise.all([loadWebchatSessions(), loadWebchatSessionMessages()]);
  } catch (error) {
    nodes.webchatPublicOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to send visitor message"), "err");
  }
}

async function loadWebchatSessions() {
  try {
    const out = await requestApi("/api/channels/webchat/sessions?limit=120");
    const sessions = Array.isArray(out?.sessions) ? out.sessions : [];
    renderStackList(nodes.webchatSessionsList, sessions, "No website conversations yet.", (row) => {
      const card = makeHostedCard({
        title: firstPresent([row.visitorName, row.visitorId, row.email, row.phone], "Website visitor"),
        eyebrow: row.status || "open",
        meta: activityStamp(row.lastMessageAt, row.updatedAt, row.createdAt),
        body: row.lastMessagePreview || "No messages yet.",
        chips: [`${row.messageCount || 0} message${Number(row.messageCount || 0) === 1 ? "" : "s"}`],
        icon: "webchat"
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.textContent = "Reply";
      selectBtn.addEventListener("click", () => {
        nodes.webchatSessionId.value = String(row.id || "");
        loadWebchatSessionMessages();
        window.requestAnimationFrame(() => nodes.webchatSessionMessage?.focus());
      });
      actionRow.appendChild(selectBtn);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.webchatSessionsList.textContent = `Unable to load website conversations: ${errorText(error)}`;
  }
}

async function loadWebchatSessionMessages() {
  const sessionId = String(nodes.webchatSessionId.value || "").trim();
  if (!sessionId) {
    nodes.webchatSessionMessages.textContent = "Choose a conversation to load messages.";
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
    toast("Choose a conversation and enter a reply.", "err");
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
    toast("Choose a conversation first.", "err");
    return;
  }
  try {
    await requestApi(`/api/channels/webchat/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: "POST",
      body: { status }
    });
    toast(`Conversation marked ${status}.`, "ok");
    await Promise.all([loadWebchatSessions(), loadWebchatSessionMessages()]);
  } catch (error) {
    toast(errorText(error, "Failed to update conversation"), "err");
  }
}

async function loadBaileysSessions() {
  try {
    const out = await requestApi("/api/channels/baileys/sessions?limit=120");
    const sessions = Array.isArray(out?.sessions) ? out.sessions : [];
    renderStackList(nodes.baileysSessionsList, sessions, "No WhatsApp lines yet.", (row) => {
      const card = makeHostedCard({
        title: firstPresent([row.label, row.phone, row.name], "WhatsApp line"),
        eyebrow: row.status || "idle",
        meta: activityStamp(row.qrUpdatedAt, row.lastConnectedAt, row.updatedAt, row.createdAt),
        body: row.qr
          ? "QR ready. Scan from WhatsApp on the phone to finish pairing."
          : (row.lastError || row.lastMessagePreview || "Ready to pair and chat."),
        chips: [
          row.phone || "",
          row.qr ? "qr ready" : "",
          row.status === "connected" ? "ready to chat" : "",
          row.phone ? "phone linked" : "phone optional"
        ],
        icon: "baileys"
      });
      const actionRow = document.createElement("div");
      actionRow.className = "row";
      const pairBtn = document.createElement("button");
      pairBtn.type = "button";
      pairBtn.textContent = row.qr ? "Refresh QR" : "Show QR";
      pairBtn.addEventListener("click", () => {
        selectBaileysSession(row.id);
        nodes.baileysOutput.textContent = formatBaileysPairingOutput(row, "Starting pairing...");
        connectBaileysSession();
      });
      const chatBtn = document.createElement("button");
      chatBtn.type = "button";
      chatBtn.className = "secondary";
      chatBtn.textContent = "Chat";
      chatBtn.addEventListener("click", () => {
        selectBaileysSession(row.id, { focusComposer: true, loadMessages: true });
        nodes.baileysOutput.textContent = formatBaileysPairingOutput(row, "Ready for chat.");
      });
      actionRow.appendChild(pairBtn);
      actionRow.appendChild(chatBtn);
      card.appendChild(actionRow);
      return card;
    });
  } catch (error) {
    nodes.baileysSessionsList.textContent = `Unable to load WhatsApp lines: ${errorText(error)}`;
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
    selectBaileysSession(String(out?.session?.id || ""));
    nodes.baileysOutput.textContent = "WhatsApp line created.\nNext: tap Show QR to pair this phone.";
    nodes.baileysMessages.textContent = "Pair this line first, then load messages here.";
    nodes.baileysLabel.value = "";
    nodes.baileysPhone.value = "";
    toast("WhatsApp line created.", "ok");
    await loadBaileysSessions();
    window.requestAnimationFrame(() => nodes.baileysConnect?.focus());
  } catch (error) {
    toast(errorText(error, "Failed to create WhatsApp line"), "err");
  }
}

async function connectBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Choose a WhatsApp line first.", "err");
    return;
  }
  nodes.baileysOutput.textContent = "Connecting WhatsApp line...";
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/connect`, {
      method: "POST",
      body: {}
    });
    const session = extractBaileysSession(out);
    nodes.baileysOutput.textContent = formatBaileysPairingOutput(
      session,
      "Connection started. Refresh this line in a moment if the QR takes a second to appear."
    );
    if (session?.status === "connected") {
      nodes.baileysMessages.textContent = "Line connected. Load messages to review recent chat.";
    }
    toast("WhatsApp connection started.", "ok");
  } catch (error) {
    nodes.baileysOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "WhatsApp connection failed"), "err");
  } finally {
    await loadBaileysSessions();
  }
}

async function disconnectBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Choose a WhatsApp line first.", "err");
    return;
  }
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
      method: "POST",
      body: {}
    });
    const session = extractBaileysSession(out);
    nodes.baileysOutput.textContent = formatBaileysPairingOutput(session, "WhatsApp line disconnected.");
    nodes.baileysMessages.textContent = "This line is disconnected. Reconnect to resume chat.";
    toast("WhatsApp line disconnected.", "ok");
    await loadBaileysSessions();
  } catch (error) {
    toast(errorText(error, "WhatsApp disconnect failed"), "err");
  }
}

async function deleteBaileysSession() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    toast("Choose a WhatsApp line first.", "err");
    return;
  }
  try {
    await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
    nodes.baileysSessionId.value = "";
    nodes.baileysOutput.textContent = "WhatsApp line deleted.";
    nodes.baileysMessages.textContent = "Create or choose another line to load messages.";
    toast("WhatsApp line deleted.", "ok");
    await loadBaileysSessions();
  } catch (error) {
    toast(errorText(error, "Failed to delete WhatsApp line"), "err");
  }
}

async function sendBaileysMessage() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  const to = String(nodes.baileysTo.value || "").trim();
  const text = String(nodes.baileysMessage.value || "").trim();
  if (!sessionId || !text) {
    toast("Choose a WhatsApp line and enter a message.", "err");
    return;
  }
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: "POST",
      body: { to, text, metadata: { source: "agentic-ui" } }
    });
    nodes.baileysOutput.textContent = [
      "WhatsApp message sent.",
      to ? `Recipient: ${to}` : ""
    ].filter(Boolean).join("\n");
    nodes.baileysMessage.value = "";
    toast("WhatsApp message sent.", "ok");
    await Promise.all([loadBaileysSessions(), loadBaileysMessages(), loadHostedLogs()]);
    window.requestAnimationFrame(() => nodes.baileysMessage?.focus());
  } catch (error) {
    nodes.baileysOutput.textContent = `Error: ${errorText(error)}`;
    toast(errorText(error, "Failed to send WhatsApp message"), "err");
  }
}

async function loadBaileysMessages() {
  const sessionId = String(nodes.baileysSessionId.value || "").trim();
  if (!sessionId) {
    nodes.baileysMessages.textContent = "Choose a WhatsApp line to load messages.";
    return;
  }
  nodes.baileysMessages.textContent = "Loading messages...";
  try {
    const out = await requestApi(`/api/channels/baileys/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`);
    nodes.baileysMessages.textContent = pretty(out.messages || []);
  } catch (error) {
    nodes.baileysMessages.textContent = `Error: ${errorText(error)}`;
  }
}

async function refreshAll() {
  await Promise.all([
    refreshCommandDeck().catch((error) => toast(errorText(error, "Failed to refresh command deck"), "err")),
    loadQueues().catch(() => {}),
    refreshLaunchpadReadiness().catch(() => {}),
    loadSetupSnapshot().catch(() => {}),
    loadAdminSurface().catch(() => {}),
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
  const safeTarget = resolveScreenTarget(target);
  nodes.screenLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.screenTarget === safeTarget);
  });
  nodes.screens.forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === safeTarget);
  });
  updateViewHeader(safeTarget);
  const group = SCREEN_META[safeTarget]?.group;
  if (group) openDrawer(group, { exclusive: isCompactNavigation() });
  syncScreenHistory(safeTarget);
  if (isCompactNavigation()) closeSidebar();
}

function bindEvents() {
  nodes.screenLinks.forEach((button) => {
    button.addEventListener("click", () => activateScreen(button.dataset.screenTarget || "command"));
  });

  nodes.moduleTabs.forEach((button) => {
    button.setAttribute("aria-selected", button.classList.contains("active") ? "true" : "false");
    button.addEventListener("click", () => {
      const group = String(button.dataset.moduleTarget || "").trim();
      const target = String(button.dataset.moduleScreen || "").trim()
        || nodes.screenLinks.find((item) => item.dataset.navGroup === group)?.dataset.screenTarget
        || "command";
      activateScreen(target);
    });
  });

  nodes.navDrawers.forEach((drawer) => setDrawerState(drawer, drawer.classList.contains("is-open")));
  nodes.navDrawerToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const target = String(button.dataset.drawerTarget || "").trim();
      const drawer = nodes.navDrawers.find((item) => item.dataset.navDrawer === target);
      if (!drawer) return;
      const willOpen = !drawer.classList.contains("is-open");
      if (willOpen && isCompactNavigation()) {
        nodes.navDrawers.forEach((item) => setDrawerState(item, item === drawer));
        return;
      }
      setDrawerState(drawer, willOpen);
    });
  });

  nodes.sidebarToggle?.setAttribute("aria-expanded", "false");
  nodes.sidebarToggle?.addEventListener("click", () => toggleSidebar());
  nodes.sidebarScrim?.addEventListener("click", () => closeSidebar());

  window.addEventListener("hashchange", () => {
    activateScreen(resolveScreenTarget(window.location.hash));
  });
  window.addEventListener("popstate", () => {
    const target = resolveScreenTarget(window.location.hash);
    nodes.screenLinks.forEach((button) => {
      button.classList.toggle("active", button.dataset.screenTarget === target);
    });
    nodes.screens.forEach((screen) => {
      screen.classList.toggle("active", screen.dataset.screen === target);
    });
    updateViewHeader(target);
    const group = SCREEN_META[target]?.group;
    if (group) openDrawer(group, { exclusive: isCompactNavigation() });
    if (isCompactNavigation()) closeSidebar();
  });
  window.addEventListener("resize", () => {
    if (!isCompactNavigation()) closeSidebar();
  });
  window.addEventListener("online", () => {
    if (!state.chatSessionId || state.ws || !state.wsAutoReconnect) return;
    clearWsReconnectTimer();
    connectWs(state.chatSessionId, { isReconnect: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.chatSessionId || state.ws || !state.wsAutoReconnect) return;
    clearWsReconnectTimer();
    connectWs(state.chatSessionId, { isReconnect: true });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
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

  nodes.setupSave.addEventListener("click", async () => {
    try {
      await saveSetupConfiguration();
    } catch (error) {
      toast(errorText(error, "Failed to save setup"), "err");
    }
  });
  nodes.setupFinish.addEventListener("click", async () => {
    try {
      await saveSetupConfiguration({ markComplete: true });
    } catch (error) {
      toast(errorText(error, "Failed to finish setup"), "err");
    }
  });
  nodes.setupReload.addEventListener("click", async () => {
    try {
      clearSetupSensitiveInputs();
      await loadSetupSnapshot({ forcePopulate: true, writeOutput: true });
      toast("Saved setup reloaded.", "ok");
    } catch (error) {
      toast(errorText(error, "Failed to reload setup"), "err");
    }
  });
  nodes.setupAgentProvider.addEventListener("change", () => syncSetupModelForProvider());
  nodes.setupActionConnectWhatsapp?.addEventListener("click", () => {
    void runSetupGuidedAction("connect-whatsapp");
  });
  nodes.setupActionRunDoctor?.addEventListener("click", () => {
    void runSetupGuidedAction("run-doctor");
  });
  nodes.setupActionSendTest?.addEventListener("click", () => {
    void runSetupGuidedAction("send-test");
  });
  nodes.setupOpenWhatsappDashboard?.addEventListener("click", () => {
    void runSetupGuidedAction("connect-whatsapp");
  });
  nodes.setupOpenGuidedMenu?.addEventListener("click", () => {
    void runSetupGuidedAction("guided-menu");
  });
  nodes.setupGuidedMenu?.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement
      ? event.target.closest("[data-setup-action]")
      : null;
    if (!button) return;
    event.preventDefault();
    void runSetupGuidedAction(button.dataset.setupAction || "");
  });

  nodes.adminReload.addEventListener("click", () => loadSelfHostedAdmin());
  nodes.adminTeamReload.addEventListener("click", () => loadAdminSurface());
  nodes.adminInviteCreate.addEventListener("click", () => createTeamInvite());
  nodes.adminActivityReload.addEventListener("click", () => loadTeamActivity());
  nodes.adminActivityExport.addEventListener("click", () => exportTeamActivityJson());

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
  nodes.webchatWidgetCopy.addEventListener("click", () => copyTextToClipboard(nodes.webchatPublicWidgetKey.value, {
    success: "Install key copied.",
    empty: "Create a new website key first. Full keys are only shown once."
  }));
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
  const initialTarget = resolveScreenTarget(window.location.hash);
  const shouldReplaceHistory = window.location.hash !== `#${initialTarget}`;
  if (shouldReplaceHistory) {
    syncScreenHistory(initialTarget, "replace");
  }
  nodes.screenLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.screenTarget === initialTarget);
  });
  nodes.screens.forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === initialTarget);
  });
  updateViewHeader(initialTarget);
  const group = SCREEN_META[initialTarget]?.group;
  if (group) openDrawer(group, { exclusive: false });
  updateDiagnosisPreview();
  setSession("");
  await refreshAll();
  startAutoRefresh();
}

init().catch((error) => {
  toast(errorText(error, "Frontend initialization failed"), "err");
});

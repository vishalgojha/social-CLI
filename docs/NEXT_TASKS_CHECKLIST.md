# Next Tasks Checklist

This is the working checklist for the next Social Flow build sessions.

## Phase 1: Agent Identity

- [x] Decide on the primary agent name: `Flow`
- [x] Create `IDENTITY.md` for runtime behavior and product voice
- [x] Load `IDENTITY.md` from the chat runtime
- [ ] Show the active agent identity in the Control UI and TUI
- [ ] Add tests for identity loading and fallback behavior

## Phase 2: Subscription And Entitlements

- [ ] Define `customer`, `workspace`, `subscription`, and `entitlement` models
- [ ] Add entitlement-aware feature flags instead of plan-name checks
- [ ] Add gateway middleware to enforce entitlements
- [ ] Define usage events for AI calls, browser sessions, and workspace limits
- [ ] Add hosted billing webhook sync design

## Phase 3: Browser Agent Functions

- [ ] Create a browser session manager with per-workspace state
- [ ] Add browser tools: `open`, `click`, `type`, `read`, `wait`, `screenshot`
- [ ] Add higher-level tools: `select`, `upload`, `snapshot`
- [ ] Add approval policy for destructive browser actions
- [ ] Expose browser tools to chat and operator surfaces

## Phase 4: Real Control UI

- [ ] Replace remaining mock diagnostics with live gateway-backed data
- [ ] Add a visible identity header: "Ask Flow"
- [ ] Add a real AI chat workbench with timeline and tool activity
- [ ] Add setup readiness indicators sourced from gateway config state
- [ ] Add support bundle export from the UI

## Phase 5: Ads Intelligence

- [ ] Implement Phase A backend normalization for ads data
- [ ] Implement deterministic winner / watch / bleeder heuristics
- [ ] Add `GET /api/ads/overview`
- [ ] Add `GET /api/ads/briefing`
- [ ] Add the first Ads Overview screen in the Control UI

## Phase 6: Hardening

- [ ] Add focused tests for prompt/runtime and browser tools
- [ ] Add redaction checks for secrets in logs and UI output
- [ ] Add audit logging for approvals and browser actions
- [ ] Review hosted defaults for CORS, auth, and safe mode

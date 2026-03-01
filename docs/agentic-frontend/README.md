# Agentic Frontend Screens

This folder contains an external, static frontend prototype for Social Flow.

It is intentionally not bundled into gateway root (`/`).

## Included Screens

- `Command Deck`: readiness, risk pressure, and source health
- `Agent Copilot`: conversation-first control with plan preview + live websocket events
- `Approvals Center`: pending approvals and open alerts with resolve/ack actions
- `Ads Diagnosis`: form wrapper for `social marketing diagnose-poor-ads`
- `Ops Launchpad`: operator setup, morning run, guard mode, and handoff generation

## Run Locally

1. Start gateway (example):

```bash
social gateway --host 127.0.0.1 --port 1310
```

2. Serve this folder as static files:

```bash
py -m http.server 4173 --directory docs/agentic-frontend
```

3. Open:

- `http://127.0.0.1:4173`

4. In the app settings panel, set:

- Gateway URL: `http://127.0.0.1:1310`
- API key: if your gateway requires it

## Optional Launch Via `social studio`

If you host this frontend somewhere (local or cloud), use:

```bash
social studio --url http://127.0.0.1:1310 --frontend-url http://127.0.0.1:4173
```


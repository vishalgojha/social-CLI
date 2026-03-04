# Agentic Frontend Screens

This folder contains an external, static frontend prototype for Social Flow.

It is intentionally not bundled into gateway root (`/`).

## Included Screens

- `Command Deck`: readiness, risk pressure, and source health
- `Agent Copilot`: conversation-first control with plan preview + live websocket events
- `Approvals Center`: pending approvals and open alerts with resolve/ack actions
- `Ads Diagnosis`: form wrapper for `social marketing diagnose-poor-ads`
- `Ops Launchpad`: operator setup, morning run, guard mode, and handoff generation
- `Keys`: BYOK encrypted key vault management (`/api/keys`)
- `Agents`: built-in + user-defined agent registry (`/api/agents`)
- `Tools`: typed tool registry with schema metadata (`/api/tools`)
- `Recipes`: JSON/YAML multi-step workflow management (`/api/recipes`)
- `Triggers`: cron/webhook/event recipe execution (`/api/triggers`)
- `Webchat`: widget key lifecycle, public session simulation, operator replies (`/api/webchat/public/*`, `/api/channels/webchat/*`)
- `Baileys`: WhatsApp Web session controls and message logs (`/api/channels/baileys/*`)
- `Logs`: hosted observability stream (`/api/logs`)

## Optional Baileys Dependency

Install this in deployments that need WhatsApp Web sessions:

```bash
npm install @whiskeysockets/baileys
```

Without this package, Baileys routes stay available but return dependency-missing errors on connect.

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
- Gateway API key: if your gateway requires `x-gateway-key`
- User API key: required for hosted multi-agent routes (`x-api-key`)

## Optional Launch Via `social studio`

If you host this frontend somewhere (local or cloud), use:

```bash
social studio --url http://127.0.0.1:1310 --frontend-url http://127.0.0.1:4173
```

For a local Vite Studio project folder:

```bash
social studio --url http://127.0.0.1:1310 --frontend-path C:\Users\you\Downloads\social-flow-ui
```


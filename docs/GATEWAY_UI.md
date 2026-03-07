# Social API Gateway

## Command

```bash
social gateway
```

## Purpose

`social gateway` runs a local HTTP server that provides:

- API routes for chat/agent, ops workflows, and SDK actions
- a WebSocket stream for live events
- secure frontend connectivity via gateway key + CORS controls

Supported workflow categories:

- Marketing/content operations (posts, campaigns, analytics)
- Developer operations (auth status, token debug, webhook subscription checks)

Root `/` is disabled by default in current builds.
Studio switcher UI is served at `/studio` (or `/studio/context`) and can toggle between bundled Studio and licensed full function-calling screens.
Bundled Studio UI is served at `/studio/app`.
Licensed full function-calling UI is served at `/studio/full/`.
If you want gateway to serve additional static Studio assets, set:

- `SOCIAL_STUDIO_ASSET_DIRS=<comma-separated-absolute-or-relative-dirs>`

Each directory must be inside allowed gateway roots (project root / configured CLI home).

Studio routes:

- `GET /studio` or `GET /studio/context` (single-entry Studio switcher)
- `GET /studio/app` (bundled Studio frontend SPA)
- `GET /studio/full/` (licensed full function-calling frontend)

## Endpoints

- `GET /api/health`
- `GET /api/status`
- `GET /api/sessions`
- `GET /api/config`
- `POST /api/config/update`
- `POST /api/chat/start`
- `POST /api/chat/message`
- `POST /api/ai`
- `POST /api/execute`
- `POST /api/cancel`
- `GET /api/sdk/status`
- `GET /api/sdk/doctor`
- `GET /api/sdk/actions`
- `POST /api/sdk/actions/plan`
- `POST /api/sdk/actions/execute`
- `GET /api/platform/distribution`
- `POST /api/orchestrate`
- `POST /api/keys`
- `GET /api/keys`
- `DELETE /api/keys/:id`
- `POST /api/webchat/public/session/start`
- `POST /api/webchat/public/session/message`
- `GET /api/channels/webchat/widget-keys`
- `POST /api/channels/webchat/widget-keys`
- `DELETE /api/channels/webchat/widget-keys/:id`
- `GET /api/channels/webchat/sessions`
- `POST /api/channels/webchat/sessions`
- `GET /api/channels/webchat/sessions/:id/messages`
- `POST /api/channels/webchat/sessions/:id/reply`
- `POST /api/channels/webchat/sessions/:id/status`
- `GET /api/channels/baileys/sessions`
- `POST /api/channels/baileys/sessions`
- `POST /api/channels/baileys/sessions/:id/connect`
- `POST /api/channels/baileys/sessions/:id/disconnect`
- `POST /api/channels/baileys/sessions/:id/send`
- `GET /api/channels/baileys/sessions/:id/messages`
- `DELETE /api/channels/baileys/sessions/:id`
- `GET /api/agents`
- `POST /api/agents`
- `DELETE /api/agents/:slug`
- `GET /api/tools`
- `GET /api/recipes`
- `POST /api/recipes`
- `DELETE /api/recipes/:slug`
- `POST /api/recipes/:slug/run`
- `GET /api/triggers`
- `POST /api/triggers`
- `DELETE /api/triggers/:id`
- `POST /api/triggers/:id/run`
- `POST /api/triggers/webhook/:token`
- `GET /api/logs`
- `GET /api/usage`
- `GET /api/cli/commands`
- `POST /api/cli/execute`
- `WS /ws`

Browser automation note:

- Hosted tool catalog now includes `browser.*` function-calling tools (`browser.session_create`, `browser.goto`, `browser.click`, `browser.type`, `browser.press`, `browser.wait_for`, `browser.extract_text`, `browser.screenshot`, `browser.session_close`).
- Install runtime dependency before using interactive browser tools:
  - `npm install playwright`
  - `npx playwright install chromium`

## SDK Contract

`/api/sdk/*` routes return a stable envelope:

```json
{
  "ok": true,
  "traceId": "sdk_xxx",
  "data": {},
  "error": null,
  "meta": {
    "action": "create_post",
    "risk": "MEDIUM",
    "requiresApproval": true,
    "approvalToken": "ap_xxx",
    "approvalTokenExpiresAt": "2026-01-01T00:00:00.000Z",
    "source": "gateway-sdk"
  }
}
```

For medium/high-risk actions:

1. Call `POST /api/sdk/actions/plan`
2. Use returned `approvalToken`
3. Call `POST /api/sdk/actions/execute` with `approvalToken` (and `approvalReason` for high-risk)

## Session Model

Sessions are persisted through the chat memory layer:

- storage path: `~/.social-cli/chat/sessions/*.json`
- resumed automatically when a known `sessionId` is provided

## Safety

- No shell execution in gateway action flow
- Uses `lib/chat/agent.js` + `lib/ai/executor.js`
- Pending actions require explicit conversational confirmation (`yes`/`no`)

## Railway + Frontend

Recommended env vars on Railway:

- `SOCIAL_GATEWAY_API_KEY=<long-random-secret>`
- `SOCIAL_GATEWAY_REQUIRE_API_KEY=true`
- `SOCIAL_GATEWAY_CORS_ORIGINS=https://<your-frontend-domain>`

Frontend requirements:

- Send `x-gateway-key` on REST requests.
- Send `x-api-key` for hosted multi-tenant routes (`/api/keys`, `/api/agents`, `/api/tools`, `/api/recipes`, `/api/triggers`, `/api/orchestrate`, `/api/logs`, `/api/usage`, `/api/cli/*`, `/api/channels/*`).
- Use `wss://<gateway-domain>/ws?gatewayKey=<SOCIAL_GATEWAY_API_KEY>` for WebSocket auth.
- Public webchat endpoints (`/api/webchat/public/*`) and health route (`/api/health`) remain unauthenticated.

## External Starter Screens

An external starter UI (multi-screen, agentic flow) is available at:

- `docs/agentic-frontend/`

It includes:

- Command Deck
- Agent Copilot
- Approvals Center
- Ads Diagnosis
- Ops Launchpad

## Files

- `src-runtime/commands/gateway.ts`
- `lib/gateway/server.ts`

## Studio Command Wiring

`social studio` supports:

- `--frontend-url <url>` for already-hosted UI
- `--frontend-path <path>` for local Studio projects (auto-starts local dev server or static host)

Default behavior:

- Without frontend overrides, `social studio` opens bundled app route: `/studio/app`
- Studio switcher remains reachable at `/studio`
- Licensed full function-calling app remains reachable at `/studio/full/`


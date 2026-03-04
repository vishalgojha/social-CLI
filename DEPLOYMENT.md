# Deployment

This repo is configured for Railway via [railway.json](./railway.json):

- Build: `npm run build`
- Start: `node bin/social.js --no-banner gateway --host 0.0.0.0 --port $PORT --require-api-key`

## Railway CLI (Shell)

Run from repo root:

```bash
railway up
```

## First-Time Setup

```bash
npm i -g @railway/cli
railway login
railway link
railway up
```

## Deploy Specific Service/Environment

```bash
railway up --service <service-name> --environment <environment-name>
```

## Quick Verify

After deploy, verify the service binds Railway `PORT` and is healthy:

```bash
railway logs
```

Look for a line like:

`Social API Gateway is running.`

and then hit:

`/api/health`

## Hosted Channel Smoke Checklist (Webchat + Baileys)

Run this against your deployed URL after basic health is green:

```bash
BASE_URL="https://<railway-service-domain>"
GATEWAY_KEY="<SOCIAL_GATEWAY_API_KEY>"
API_KEY="<SOCIAL_HOSTED_BOOTSTRAP_API_KEY>"
```

1. Create webchat widget key (save `key.key` from response):

```bash
curl -sS -X POST "$BASE_URL/api/channels/webchat/widget-keys" \
  -H "content-type: application/json" \
  -H "x-gateway-key: $GATEWAY_KEY" \
  -H "x-api-key: $API_KEY" \
  -d '{"label":"railway-e2e"}'
```

2. Start public webchat session with that widget key (save `sessionToken` and `session.id`):

```bash
curl -sS -X POST "$BASE_URL/api/webchat/public/session/start" \
  -H "content-type: application/json" \
  -d '{"widgetKey":"<KEY_FROM_STEP_1>","visitorId":"railway-e2e-visitor"}'
```

3. Send public inbound message and expect `ok: true`:

```bash
curl -sS -X POST "$BASE_URL/api/webchat/public/session/message" \
  -H "content-type: application/json" \
  -d '{"sessionToken":"<SESSION_TOKEN_FROM_STEP_2>","text":"hello from railway e2e"}'
```

4. Fetch operator-side messages and verify inbound event is present:

```bash
curl -sS "$BASE_URL/api/channels/webchat/sessions/<SESSION_ID_FROM_STEP_2>/messages?limit=20" \
  -H "x-gateway-key: $GATEWAY_KEY" \
  -H "x-api-key: $API_KEY"
```

5. Create Baileys session (save `session.id`):

```bash
curl -sS -X POST "$BASE_URL/api/channels/baileys/sessions" \
  -H "content-type: application/json" \
  -H "x-gateway-key: $GATEWAY_KEY" \
  -H "x-api-key: $API_KEY" \
  -d '{"label":"railway-e2e","phone":"<E164_OR_DIGITS_OPTIONAL>"}'
```

6. Connect Baileys session and verify there is no dependency-missing error:

```bash
curl -sS -X POST "$BASE_URL/api/channels/baileys/sessions/<BAILEYS_SESSION_ID>/connect" \
  -H "content-type: application/json" \
  -H "x-gateway-key: $GATEWAY_KEY" \
  -H "x-api-key: $API_KEY" \
  -d '{}'
```

Expected:

- No `BAILEYS_DEPENDENCY_MISSING` error.
- Session transitions to `connecting` and exposes a `qr` for pairing.
- After QR scan, session transitions to `connected`.

## Required Railway Variables

Set these in Railway service variables before exposing frontend traffic:

- `SOCIAL_GATEWAY_API_KEY`: long random secret used by `x-gateway-key`
- `SOCIAL_GATEWAY_REQUIRE_API_KEY=true`
- `SOCIAL_GATEWAY_CORS_ORIGINS=https://<your-frontend-domain>`
- `SOCIAL_HOSTED_MASTER_KEY`: encryption secret for BYOK key vault (AES-256-GCM)
- `SOCIAL_HOSTED_BOOTSTRAP_API_KEY`: first user `x-api-key` for hosted routes
- `SOCIAL_HOSTED_BOOTSTRAP_USER_ID`: bootstrap user id (example: `default`)

Optional hardening:

- `SOCIAL_GATEWAY_RATE_MAX=180`
- `SOCIAL_GATEWAY_RATE_WINDOW_MS=60000`
- `SOCIAL_HOSTED_RECIPES_DIR=/data/recipes`
- `SOCIAL_HOSTED_TRIGGERS_DIR=/data/triggers`

## Frontend Integration (Remote)

For browser frontend calls:

- Base URL: `https://<railway-service-domain>`
- REST auth: include header `x-gateway-key: <SOCIAL_GATEWAY_API_KEY>`
- WebSocket auth: connect to `wss://<railway-service-domain>/ws?gatewayKey=<SOCIAL_GATEWAY_API_KEY>`

From CLI, you can open your external frontend directly:

```bash
social studio --url https://<railway-service-domain> --frontend-url https://<frontend-domain>
```

## Docker (Self-Hosted)

Build and run with compose:

```bash
docker compose -f docker-compose.hosted.yml up -d --build
```

Hosted REST routes require both:

- `x-gateway-key` (gateway-level access, if required)
- `x-api-key` (per-user hosted access)

## Rollback (One Command)

If latest deploy is bad, revert commit, push, and redeploy:

```bash
git revert --no-edit <bad_commit_sha> && git push origin main && railway up
```

Replace `<bad_commit_sha>` with the commit to undo.

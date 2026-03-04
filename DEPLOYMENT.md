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

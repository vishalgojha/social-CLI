# Next Agent Continuity - 2026-02-28

## Objective

Stabilize Railway deployment for `socialclaw-core` and align gateway/frontend operation with the new agentic tool-calling model (no bundled Studio frontend in gateway).

## Current Local Code State

Uncommitted modified files:

- `railway.json`
- `DEPLOYMENT.md`
- `README.md`
- `docs/GATEWAY_UI.md`
- `commands/studio.ts`
- `bin/social.ts`
- `commands/explain.ts`

Important local runtime intent:

- Railway start command changed to run gateway directly (avoid `social start` readiness blockers in cloud).
- `social studio` gained `--frontend-url` for external frontend launch.
- Docs updated for Railway + frontend integration (`x-gateway-key`, CORS, websocket `gatewayKey` query param).

## Railway Context Confirmed

WSL Railway CLI auth works for user:

- `Logged in as Vishal (vishal@chaoscraftlabs.com)`

Linked target:

- Project: `Socialclaw`
- Environment: `API Keys`
- Service: `socialclaw-core`

## Deployment Attempts + Failure

Recent deployment IDs (all failed at config parse stage):

1. `057978bb-3779-4b5c-8488-81899df6835c`
2. `eb93c525-2397-4b6e-bbf9-d8b046ce9c6a`
3. `7087c2bf-c977-4a91-bdc7-5fe2cb6fc833`

Error reported by Railway:

- `Failed to parse JSON file railway.json: invalid character '\x00' looking for beginning of value`

Note:

- Local `railway.json` bytes were checked from both PowerShell and WSL and showed `nul_count = 0`.
- This indicates a packaging/path/encoding issue in upload flow, not obvious local file content corruption.

## What Was Already Verified

1. `railway.json` is valid JSON and readable.
2. `railway.json` contains no null bytes locally.
3. `npx @railway/cli up --detach` reproduces the same parse error.
4. Prior production crash loop root cause was confirmed as old start command:
   - `npm start` -> `node bin/social.js start --foreground` -> `Start Blocked` due missing API tokens.

## High-Confidence Next Steps

1. Retry deploy from a pure Linux workspace path (not `/mnt/c/...`), e.g. `/home/vishal/social-flow-deploy`.
2. Recreate `railway.json` inside that Linux path using Linux tooling (`cat > railway.json`) immediately before deploy.
3. Run:
   - `npx --yes @railway/cli link --project "Socialclaw" --service "socialclaw-core" --environment "API Keys"`
   - `npx --yes @railway/cli up --detach`
4. If parse error persists, bypass config file parsing by setting start command in Railway service UI directly:
   - `node bin/social.js --no-banner gateway --host 0.0.0.0 --port $PORT --require-api-key`
5. Ensure Railway variables are set:
   - `SOCIAL_GATEWAY_API_KEY`
   - `SOCIAL_GATEWAY_REQUIRE_API_KEY=true`
   - `SOCIAL_GATEWAY_CORS_ORIGINS=https://<frontend-domain>`
6. Verify:
   - `https://socialclaw-core-api-keys.up.railway.app/api/health`
   - frontend requests include `x-gateway-key`
   - websocket uses `/ws?gatewayKey=<key>`

## Commands Used (for traceability)

- `npx --yes @railway/cli link --project "Socialclaw" --service "socialclaw-core" --environment "API Keys"`
- `npx --yes @railway/cli up --detach`
- `npx --yes @railway/cli deployment list --json`
- `npx --yes @railway/cli status --json`


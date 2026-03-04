# Social Flow Hosted Multi-Agent Platform

## Filled Inputs

- `TOOL_NAME`: Social Flow
- `LIST SERVICES` (BYOK): `openai`, `openrouter`, `xai`, `meta_facebook`, `meta_instagram`, `meta_whatsapp`
- `LIST AGENTS`: `router-agent`, `marketing-agent`, `messaging-agent`, `analytics-agent`, `ops-agent`, `webchat-agent`, `baileys-agent` (+ user-defined agents)
- `LIST ACTIONS`:
  - `meta_marketing`: `status`, `doctor`, `get_profile`, `list_ads`, `create_post`
  - `whatsapp_cloud`: `send_whatsapp`, `logs`
  - `webchat_channel`: `create_widget_key`, `list_widget_keys`, `list_sessions`, `get_messages`, `reply`, `set_status`
  - `baileys_channel`: `create_session`, `list_sessions`, `connect_session`, `disconnect_session`, `send_text`, `get_messages`
- `HOSTING PLATFORM`: Railway
- `PRICE`: `$49/mo` (Tier 2)

## Architecture Summary

### 1. BYOK Key Vault

- Endpoints:
  - `POST /api/keys`
  - `GET /api/keys`
  - `DELETE /api/keys/:id`
- Keys are encrypted at rest using AES-256-GCM.
- Vault records are stored per user and scoped by `userId`.
- Hosted route auth uses `X-API-Key` (mapped to user identity).

### 2. Agent Layer

- Built-in agents with standard shape: `name`, `description`, `tools[]`, `execute(task, context)`.
- Slug-based routing (`/api/agents` + orchestrator planning).
- User-defined agents are persisted and loaded from hosted config state.

### 3. Tool Registry

- Registry exposed via `GET /api/tools`.
- Every tool has:
  - typed key
  - service classification
  - JSON Schema input contract
  - executable handler

### 4. Orchestrator

- Endpoint: `POST /api/orchestrate`
- Uses user BYOK LLM key from vault (`openai/openrouter/xai`) for orchestration eligibility.
- Supports sequential and parallel pipelines.
- Returns structured per-agent/per-tool execution output.

### 5. Trigger Engine

- Endpoints:
  - `GET /api/triggers`
  - `POST /api/triggers`
  - `DELETE /api/triggers/:id`
  - `POST /api/triggers/:id/run`
  - `POST /api/triggers/webhook/:token`
- Trigger types:
  - cron
  - webhook
  - event
- Triggers are persisted as JSON and run through recipes.

### 6. Recipe System

- Endpoints:
  - `GET /api/recipes`
  - `POST /api/recipes`
  - `DELETE /api/recipes/:slug`
  - `POST /api/recipes/:slug/run`
- Supports JSON or YAML input.
- Workflow step contract:
  - `agent_slug`
  - `action_key`
  - `action_props`
  - optional `format_guide`
- Supports `$prev` interpolation across step outputs.

### 7. REST Gateway Wrapping Existing CLI

- Existing gateway/CLI behavior remains unchanged (additive integration).
- Existing CLI is wrapped via:
  - `GET /api/cli/commands`
  - `POST /api/cli/execute`
- CLI execution uses no-shell process spawn wrapper.

### 8. Dashboard Extension

`docs/agentic-frontend` now includes hosted pages:

- Keys
- Agents
- Tools
- Recipes
- Triggers
- Webchat
- Baileys
- Logs

UI uses existing app shell; no replacement of previous screens.

## Hosted Endpoints

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

## Migration Path (CLI -> Hosted)

1. Keep current CLI and scripts unchanged.
2. Start gateway with hosted env vars (`SOCIAL_HOSTED_MASTER_KEY`, bootstrap user key).
3. Use `X-API-Key` for user-scoped hosted endpoints.
4. Move repetitive command sequences into recipes (`/api/recipes`).
5. Add triggers to automate recipe execution.
6. Route tasks through `/api/orchestrate` for multi-agent pipelines.

## Deployment

### Docker

- `Dockerfile`
- `.dockerignore`
- `docker-compose.hosted.yml`

Baileys channel support requires installing:

- `@whiskeysockets/baileys`

### Railway

- Build and start remain compatible through `railway.json`.
- Required env vars:
  - `SOCIAL_GATEWAY_API_KEY`
  - `SOCIAL_GATEWAY_REQUIRE_API_KEY=true`
  - `SOCIAL_HOSTED_MASTER_KEY`
  - `SOCIAL_HOSTED_BOOTSTRAP_API_KEY`
  - `SOCIAL_HOSTED_BOOTSTRAP_USER_ID`
- Optional:
  - `SOCIAL_HOSTED_RECIPES_DIR`
  - `SOCIAL_HOSTED_TRIGGERS_DIR`
  - `SOCIAL_GATEWAY_CORS_ORIGINS`

## Build Order

1. BYOK vault + per-user auth (`X-API-Key`) + encryption.
2. Tool registry and built-in agents.
3. Orchestrator (sequential/parallel execution).
4. Recipe parser/store + `$prev` interpolation.
5. Trigger engine (cron/webhook/event) + scheduler lifecycle.
6. CLI wrapper REST endpoints.
7. Dashboard pages (Keys/Agents/Tools/Recipes/Triggers/Logs).
8. Realtime channels (Webchat public/agent flow + Baileys session control).
9. Deploy configs + migration docs + pricing tiers.

## Distribution Tiers

- Tier 1: CLI + self-hosted gateway (free, OSS)
- Tier 2: Cloud hosted + BYOK (`$49/mo`)
- Tier 3: Enterprise white-label + on-prem (custom)

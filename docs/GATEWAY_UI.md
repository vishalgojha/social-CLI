# Social API Gateway UI

## Command

```bash
social gateway --open
```

## Purpose

`social gateway` runs a local HTTP server that combines:

- a conversational web UI (`web/studio/`)
- a safe API gateway for chat operations

This gives you a browser-first control surface while still executing through the same internal `social-cli` logic.

Supported workflow categories:

- Marketing/content operations (posts, campaigns, analytics)
- Developer operations (auth status, token debug, webhook subscription checks)

UI sections:

- `Chat`
- `Data Console`
- `Config`
- `Help`
- `Settings`

## Endpoints

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/config`
- `POST /api/chat/start`
- `POST /api/chat/message`

## Session Model

Sessions are persisted through the chat memory layer:

- storage path: `~/.social-cli/chat/sessions/*.json`
- resumed automatically when a known `sessionId` is provided

## Safety

- No shell execution in gateway action flow
- Uses `lib/chat/agent.js` + `lib/ai/executor.js`
- Pending actions require explicit conversational confirmation (`yes`/`no`)

## Files

- `commands/gateway.js`
- `lib/gateway/server.js`
- `web/studio/index.html`
- `web/studio/styles.css`
- `web/studio/app.js`

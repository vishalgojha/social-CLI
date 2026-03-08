# Social Flow Quickstart

Social Flow ships the deterministic CLI by default. Use it to manage config, run profile/post/ads actions, and replay logged operations from one consistent entrypoint.

## 60-Second Start

```bash
# 1) Install
npm install -g @vishalgojha/social-flow

# 2) Configure token + defaults
social onboard
# also provisions Chromium for browser automation unless you pass --skip-browser

# 3) Validate setup
social doctor
social status
```

## First Commands

```bash
social profile get --fields id,name
social post create --message "Hello team" --page-id PAGE_ID
social ads list --account act_123
social ai --provider deterministic "list ads account act_123"
```

## Local AI

```bash
social ai --provider ollama "get my facebook profile"
```

Default Ollama base URL: `http://127.0.0.1:11434`

## Source Workflow

```bash
npm ci
npm run build:social-ts
npm run test:social-ts
npm start
```

## Config Notes

- Current state path: `~/.social-flow/config.json`
- Legacy `~/.social-cli` and `~/.meta-cli` config is imported automatically
- Existing profile-based `.social-flow` config remains compatible with the latest CLI

## Next

- [README](README.md)
- [Examples](EXAMPLES.md)
- [Contributing](CONTRIBUTING.md)

# Social Flow

<p align="center">
  <img src="docs/assets/social-flow-logo-mint.svg" alt="Social Flow Mint Logo" width="220" />
</p>

Deterministic CLI for Meta profile, post, and ads workflows.

Social Flow now standardizes on the latest deterministic CLI path. The shipped `social` binary, the dev entrypoint, and the TypeScript `cli/` source all resolve to the same command surface and the same `~/.social-flow/config.json` store.

## Quickstart

```bash
# 1) Install
npm install -g @vishalgojha/social-flow

# 2) Set token, defaults, and AI provider
social onboard
# also provisions Chromium for browser automation unless you pass --skip-browser

# 3) Verify local readiness
social doctor
social status

# 4) Run a command
social profile get --fields id,name
```

Natural-language mode:

```bash
social ai --provider deterministic "list ads account act_123"
social ai --provider ollama "get my facebook profile"
```

## Core Commands

```bash
social onboard
social doctor
social status
social config
social profile get --fields id,name
social post create --message "Hello team" --page-id PAGE_ID
social ads list --account act_123
social logs
social replay <LOG_ID>
social ai --provider deterministic "create post \"Hello\" page 12345"
```

## Config Compatibility

- Active state lives in `~/.social-flow/config.json`
- Existing `~/.social-cli/config.json` and `~/.meta-cli/config.json` are migrated automatically
- Existing profile-based `~/.social-flow/config.json` files continue to work; the latest CLI now reads and writes that shared schema directly

## Developer Workflow

```bash
npm ci
npm run build:social-ts
npm run test:social-ts
npm start
```

`npm run dev` uses the same latest CLI entrypoint as the published `social` binary.

## Docs

- [Quickstart](QUICKSTART.md)
- [Examples](EXAMPLES.md)
- [Contributing](CONTRIBUTING.md)

## License

Open-core licensing:

- MIT for default OSS scope - see [LICENSE](LICENSE)
- Commercial license for explicitly marked commercial files/directories - see [LICENSING](LICENSING.md) and [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL.md)

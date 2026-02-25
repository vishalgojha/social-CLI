# CLI v2 Simplification Map

## Goal

Reduce operator-facing complexity to a stable core:

- `social login`
- `social status`
- `social run <task>`
- `social gateway`
- `social config`

Everything else moves under advanced namespace:

- `social x <domain> ...`

## v2 Command Map

### Core Commands

- `social login [--api facebook|instagram|whatsapp]`
  - If omitted, prompts API selection once.
  - Internally routes to `auth login`.
- `social status [--json]`
  - One consolidated health/status output.
  - Internally combines `doctor`, auth status, profile, gateway-ready fields.
- `social run <task> [--deterministic] [--json]`
  - Single execution entrypoint.
  - NL + deterministic dispatch to chat/ai/toolchain.
- `social gateway [--host] [--port] [--api-key ...]`
  - Keep as-is (already production-relevant).
- `social config <show|set|get|profile ...>`
  - Consolidate account/profile/default settings.

### Advanced Namespace

- `social x auth ...`
- `social x query ...`
- `social x post ...`
- `social x whatsapp ...`
- `social x instagram ...`
- `social x marketing ...`
- `social x ops ...`
- `social x hub ...`
- `social x policy ...`
- `social x integrations ...`
- `social x batch ...`
- `social x app ...`
- `social x limits ...`
- `social x utils ...`
- `social x agent ...`
- `social x chat ...`
- `social x tui ...`
- `social x onboard ...`

## Migration Table (Current -> v2)

### Auth / Onboarding / Status

| Current | v2 |
|---|---|
| `social auth login` | `social login` |
| `social auth status` | `social status` |
| `social doctor` | `social status` |
| `social onboard` | `social login` then `social status` |
| `social auth logout` | `social x auth logout` |
| `social auth scopes` | `social x auth scopes` |
| `social auth debug` | `social x auth debug` |
| `social auth app` | `social x auth app` |

### Query / Post / App / Limits

| Current | v2 |
|---|---|
| `social query ...` | `social run "<intent>"` or `social x query ...` |
| `social post ...` | `social run "<intent>"` or `social x post ...` |
| `social app ...` | `social x app ...` |
| `social limits ...` / `social limit ...` | `social x limits ...` |

### WhatsApp / Instagram / Marketing

| Current | v2 |
|---|---|
| `social whatsapp ...` | `social run "<intent>"` or `social x whatsapp ...` |
| `social instagram ...` | `social run "<intent>"` or `social x instagram ...` |
| `social marketing ...` | `social run "<intent>"` or `social x marketing ...` |

### Profiles / Config

| Current | v2 |
|---|---|
| `social accounts list` | `social config profile list` |
| `social accounts add <name>` | `social config profile add <name>` |
| `social accounts switch <name>` | `social config profile use <name>` |
| `social accounts show [name]` | `social config show [--profile <name>]` |
| `social utils config show` | `social config show` |
| `social utils version set <v>` | `social config set apiVersion <v>` |
| `social utils set-default-*` | `social config set defaults.* <value>` |

### AI / Agent / Chat / TUI

| Current | v2 |
|---|---|
| `social ai "..."` | `social run "..."` |
| `social agent "..."` | `social run "..." --deterministic` (or planner mode defaulted by policy) |
| `social chat` | `social run "..."` (interactive mode optional) |
| `social tui` / `social hatch` | `social x tui` |
| `social chat sessions` / `replay` | `social x chat sessions` / `social x chat replay` |

### Ops / Hub / Policy / Integrations / Batch

| Current | v2 |
|---|---|
| `social ops ...` | `social x ops ...` |
| `social hub ...` | `social x hub ...` |
| `social policy ...` | `social x policy ...` |
| `social integrations ...` | `social x integrations ...` |
| `social batch run ...` | `social x batch run ...` |

## Backward Compatibility Plan

### Phase 1 (2 releases)

- Keep all current commands.
- Add aliases for new core commands.
- Print one-line migration hints for legacy commands.

Example:

`[deprecation] "social auth login" -> use "social login" (legacy will be removed in v3).`

### Phase 2 (next major)

- Keep `social x ...` and core commands only.
- Remove top-level legacy command groups (`auth`, `query`, `post`, etc.) from root.

## UX Rules for v2

- Core command prompt/order/labels are contract-locked.
- `--json` output for core commands is schema-stable.
- `social run` is the default operator path; `social x ...` is expert mode.


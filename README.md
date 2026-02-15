# meta-cli

A CLI for Meta's APIs. For devs tired of token gymnastics.

```text
    __  ___      __        ________    ________
   /  |/  /___ _/ /_____ _/ ____/ /   /  _/ __ \
  / /|_/ / __ `/ __/ __ `/ /   / /    / // / / /
 / /  / / /_/ / /_/ /_/ / /___/ /____/ // /_/ /
/_/  /_/\__,_/\__/\__,_/\____/_____/___/\____/
```

Built by Chaos Craft Labs.

## Install

```bash
npm install -g @vishalgojha/meta-cli
meta --help
```

## Releasing (Maintainers)

This repo includes a tag-based GitHub Actions release flow (`.github/workflows/release.yml`).

1. Add a repo secret: `NPM_TOKEN`

Create an npm automation (or granular) token with publish access for `@vishalgojha/meta-cli` and add it to GitHub:

- GitHub repo: Settings -> Secrets and variables -> Actions -> New repository secret
- Name: `NPM_TOKEN`

2. Bump + tag

```bash
# bump version + update CHANGELOG.md first
git commit -am "release: v0.2.7"
git tag v0.2.7
git push origin main --tags
```

Notes:

- npm will reject re-publishing the same version (you must bump).
- The workflow verifies the tag version matches `package.json` before publishing.

## Banner / Colors

If the banner looks messy in your terminal, use the classic banner (default) or switch styles:

```bash
meta --banner-style classic --help
meta --banner-style slant --help
meta --banner-style clean --help
meta --banner-style compact --help
```

If your terminal shows no colors, force it:

```bash
meta --color --help
```

## Config Location

All config is stored here (cross-platform):

- `~/.meta-cli/config.json`

This includes API version, default IDs, and tokens. The CLI never prints full tokens.

## Command Groups

- `auth`: login/app creds/debug token/scopes/status/logout
- `query`: read-only queries (me/pages/instagram-media/feed)
- `post`: create posts/photos/videos for Facebook Pages
- `instagram`: IG accounts/media/insights/comments/publish
- `whatsapp`: send messages, templates, phone numbers
- `marketing`: ads accounts, campaigns, insights (async), ad sets, creatives
- `utils`: config helpers, api version, limits
- `doctor`: quick diagnostics (sanitized config + setup hints)
- `agent`: safe planning + execution with scoped memory
- `chat`: conversational multi-turn AI assistant with persistent sessions
- `accounts`: manage multiple profiles (multi-client)
- `batch`: run tool-based jobs from JSON/CSV

Run `meta <group> --help` for full flags per command.

## Quick Start

```bash
# 1) Login (opens token page, then prompts)
meta auth login --api facebook

# 1.5) Quick diagnostics (sanitized config + next-step hints)
meta doctor

# 2) Query
meta query me --fields id,name
meta query pages --table

# 3) Pick a default Page for posting
meta post pages --set-default

# 4) Post
meta post create --message "Hello from meta-cli"
```

## Multi-Account Profiles

Use profiles to manage multiple clients/environments (agency-friendly). Tokens/default IDs are stored per profile.

```bash
meta accounts list
meta accounts add clientA
meta accounts switch clientA   # persists active profile

# One-off: don't persist, just run using a profile
meta --profile clientA query me
```

## Batch Runner

Run a batch of tool-based jobs from a file. Jobs use the tool registry (the same safety model the agent uses).

```bash
meta batch run jobs.json --concurrency 3
meta batch run jobs.csv --concurrency 2 --yes
```

Example `jobs.json`:

```json
[
  { "id": "1", "profile": "clientA", "tool": "auth.status", "args": {} },
  {
    "id": "2",
    "profile": "clientA",
    "tool": "marketing.insights",
    "args": {
      "adAccountId": "act_123",
      "preset": "last_7d",
      "level": "campaign",
      "fields": "spend,impressions,clicks",
      "export": "./reports/clientA.csv",
      "append": true
    }
  }
]
```

## Marketing API (Ads)

Marketing API calls use your **Facebook token** and require permissions like:

- `ads_read` (read/list/insights)
- `ads_management` (create/update)

Many apps require **Advanced Access** for these scopes. If you get error `(#200)`, you likely need to re-auth with the right scopes and/or get app review/advanced access.

### Common pains this CLI handles

- Async insights jobs (submit, poll, then fetch results) to avoid timeouts.
- Backoff/retry on Ads throttling errors `#17` / `#32` and transient 5xx.
- Full pagination loops on list endpoints.

### Examples

```bash
# List ad accounts
meta marketing accounts --table

# Set a default ad account for future commands
meta marketing set-default-account act_123

# Upload an image to get image_hash
meta marketing upload-image --file ./creative.png

# List campaigns
meta marketing campaigns --status ACTIVE --table

# Async insights (recommended when using breakdowns)
meta marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks,ctr,cpc,cpm --breakdowns age,gender --table

# Export insights to CSV/JSON
meta marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.csv
meta marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.json
meta marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.csv --append

# Quick status (spend today + active campaigns + rate-limit header snapshot)
meta marketing status

# List ads + audiences
meta marketing ads --table
meta marketing audiences --table

# Create ad set + creative + ad (high risk; defaults to PAUSED unless you set ACTIVE)
meta marketing create-adset <CAMPAIGN_ID> --name "Test Adset" --targeting "{\"geo_locations\":{\"countries\":[\"US\"]}}"
meta marketing create-creative --name "Test Creative" --page-id <PAGE_ID> --link "https://example.com" --body-text "Hello" --image-url "https://example.com/creative.png" --call-to-action LEARN_MORE
meta marketing create-ad <ADSET_ID> --name "Test Ad" --creative-id <CREATIVE_ID>

# Operate safely: pause/resume + budget updates (high risk)
meta marketing pause campaign <CAMPAIGN_ID>
meta marketing resume adset <ADSET_ID>
meta marketing set-budget campaign <CAMPAIGN_ID> --daily-budget 15000
meta marketing set-budget adset <ADSET_ID> --daily-budget 8000

# High risk: create a campaign (defaults to PAUSED)
meta marketing create-campaign --name "Test Camp" --objective OUTCOME_SALES --daily-budget 10000
```

Safety note: Always test writes (`create-*`, `set-status`, `set-budget`) on a sandbox/test ad account first. These operations can affect real spend.

## Agent Mode (Meta DevOps Co-pilot)

`meta agent` plans first, then executes only after you confirm.

### Safety Model

- No shell exec, no arbitrary code.
- Strict tool registry: agent steps must use registered tool names.
- High-risk tools (example: `whatsapp.send`) require an extra confirmation per step.
- Scoped memory (optional) stored at `~/.meta-cli/context/<scope>/`:
  - `memory.json` (append-only entries: decision/status/config)
  - `summary.md` (human-readable)
- Secrets/tokens are redacted before writing memory.
- Memory staleness (> 7 days) is warned during planning.

### Usage

```bash
meta agent "fix whatsapp webhook for clientA"
meta agent --scope clientA "check auth + list pages"

# Plan only
meta agent --plan-only "inspect app subscriptions"

# Disable memory
meta agent --no-memory "check my rate limits"

# JSON output
meta agent --json --plan-only "check my setup"
```

### Memory Commands

```bash
meta agent memory list
meta agent memory show clientA
meta agent memory forget clientA
meta agent memory clear
```

### LLM Key Setup

For LLM planning, set `META_AGENT_API_KEY` (or `OPENAI_API_KEY`). If no key is set, the agent falls back to a conservative heuristic planner.

```powershell
setx META_AGENT_API_KEY "YOUR_KEY"
meta agent --provider openai --model gpt-4o-mini "list my pages"
```

## AI Natural Language Interface (`meta ai`)

`meta ai` lets you describe an action in plain English and executes a safe mapped command flow:

- Parse intent (LLM first, heuristic fallback)
- Validate required fields and formats
- Show risk-aware confirmation UI
- Execute via internal API client functions (no shell/eval)

### Examples

```bash
meta ai "show my pages"
meta ai "what are my Facebook pages?"
meta ai "who am I on Instagram"
meta ai "check if I'm close to rate limit"
meta ai "post 'New product launch!' to my Facebook page with link https://product.com"
meta ai "schedule post 'Tomorrow launch reminder' to My Business Page tomorrow at 10am"
meta ai "post sunset photo to Instagram with caption 'Beautiful evening' from https://cdn.example.com/sunset.jpg"
meta ai "send WhatsApp message 'Order confirmed' to +919812345678"
meta ai "list my active ad campaigns for account act_123456789"
meta ai "get ad performance for last 30 days"
meta ai "show campaign spend for account act_123456789"
meta ai "create campaign 'Summer Sale' with objective OUTCOME_SALES and daily budget 10000"
```

### Flags

- `--yes`: skips confirmation for low/medium risk actions (high risk always confirms)
- `--debug`: prints parse/execution internals (sanitized)
- `--json`: prints raw result JSON
- `--ink`: use Ink prompt UI for confirmation when available

### Safety

- No `eval()` and no shell command execution in AI flow
- High-risk actions require user confirmation
- Tokens are redacted in debug logs
- Invalid/missing fields block execution until corrected

See `docs/AI_INTERFACE.md` for full architecture and troubleshooting.

## Conversational Chat Agent (`meta chat`)

`meta chat` is a persistent, multi-turn assistant built on top of the same safe execution layer as `meta ai`.

### What it does

- Keeps context across messages in a session
- Proposes actions and waits for explicit confirmation
- Executes through internal API clients (no shell/eval)
- Saves and resumes sessions across CLI runs

### Quick usage

```bash
# start a new conversation
meta chat

# resume a specific session
meta chat --session chat_20260215150000_ab12cd

# list recent sessions
meta chat sessions
```

### In-session commands

- `help`: examples and usage tips
- `summary`: show known facts and pending actions
- `exit`: save and quit

See `docs/CHAT_AGENT.md` for architecture, flow, and safety details.

## Disclaimer

Unofficial tool. Not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.

## License

MIT

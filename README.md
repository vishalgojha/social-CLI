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
- `agent`: safe planning + execution with scoped memory
- `accounts`: manage multiple profiles (multi-client)
- `batch`: run tool-based jobs from JSON/CSV

Run `meta <group> --help` for full flags per command.

## Quick Start

```bash
# 1) Login (opens token page, then prompts)
meta auth login --api facebook

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

## Disclaimer

Unofficial tool. Not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.

## License

MIT

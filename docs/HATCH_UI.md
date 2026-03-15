# Hatch Conversational UI (`social hatch`)

## Command

```bash
social hatch
```


## Purpose

Hatch is the chat-first terminal control plane for Social Flow:

- conversational input (`Type naturally`)
- conversational planning with safe action mapping + explicit risk gates
- AI-assisted parsing and response phrasing (with deterministic fallback)
- persistent local memory for continuity across sessions

It is not fully autonomous. Actions still pass through risk/approval gates.

## Runtime Model

Per message, Hatch runs this flow:

1. Parse intent (`prefer_ai` by default, deterministic fallback)
2. Map to a known action (`status`, `doctor`, `get_profile`, `create_post`, `list_ads`, `logs`, `replay`, etc.)
3. Check required slots and confidence
4. Apply risk gate and approval rules
5. Execute via registered executor
6. Return conversational summary and log result

## Risk + Approval Behavior

- `LOW` risk:
  - auto-executes when intent confidence meets threshold
  - asks for confirmation when confidence is low
- `MEDIUM` risk:
  - requires explicit approval (`Enter` or `a`)
- `HIGH` risk:
  - requires approval reason, then confirmation

Confidence threshold is controlled by:

- `SOCIAL_TUI_AUTO_EXECUTE_CONFIDENCE` (default `0.82`)

## Persistent Memory

Hatch saves memory under:

- `~/.social-flow/hatch/sessions/<sessionId>.json`
- `~/.social-flow/hatch/profiles/<profileId>.json`
- `~/.social-flow/hatch/index.json`

Legacy single-file memory (`~/.social-cli/hatch/memory.json`) is auto-migrated on load.

Saved state includes:

- recent chat turns
- remembered profile name (for natural greetings)
- recent intents
- unresolved items/failures

Retention limits (current implementation):

- last `80` turns
- last `3` intents
- last `6` unresolved records

Memory examples:

- `my name is Vishal`
- `what's my name`

## Conversational Controls

### Slash commands

- `/help`
- `/doctor`
- `/status`
- `/config`
- `/logs`
- `/replay latest`
- `/why`
- `/ai <intent>`

### Keyboard shortcuts

- `Enter`: send / confirm
- `a`: approve
- `r`: reject
- `e`: edit slots (`key=value`)
- `d`: toggle verbose diagnostics
- `?`: toggle help
- `/`: open command palette
- `x`: collapse/expand diagnostics pane (verbose mode)
- `Up/Down`: command history (and replay suggestion navigation)
- `q`: quit

## AI Provider Setup

Hatch requires an API key when using hosted providers. On launch, it can prompt for:

- provider (`ollama`, `openai`, `openrouter`, `xai`)
- API key
- model

`ollama` is the local/no-key option and defaults to `http://127.0.0.1:11434`.

CLI options:

- `--ai-provider <provider>`
- `--ai-model <model>`
- `--ai-base-url <url>`
- `--ai-api-key <key>`
- `--verbose`
- `--skip-onboard-check`

Important env vars:

- `SOCIAL_TUI_AI_PROVIDER`
- `SOCIAL_TUI_AI_VENDOR`
- `SOCIAL_TUI_AI_MODEL`
- `SOCIAL_TUI_AI_BASE_URL`
- `SOCIAL_TUI_AI_API_KEY`
- `SOCIAL_TUI_AI_AUTO` (AI parse enable/disable)
- `SOCIAL_TUI_PARSE_MODE` / `SOCIAL_TUI_AI_PARSE_MODE` (`prefer_ai` | `balanced` | `deterministic`)
- `SOCIAL_TUI_CHAT_REPLY_AI` (AI conversational phrasing enable/disable)

## Relationship to `social chat`

`social chat` now routes to Hatch UI for the main interactive flow.

Compatibility subcommands still exist:

- `social chat sessions`
- `social chat replay <sessionId>`

## Related Docs

- `docs/AI_INTERFACE.md`
- `docs/CHAT_AGENT.md`
- `docs/GATEWAY_UI.md`
- `sdk/README.md`

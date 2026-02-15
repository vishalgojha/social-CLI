# AI Interface (`meta ai`)

## Overview

`meta ai "<intent>"` is a natural-language command entrypoint for Facebook, Instagram, WhatsApp, and Marketing API workflows.

Execution flow:

1. Parse natural language into structured intent JSON (`lib/ai/parser.js`)
2. Validate requirements, formats, and defaults (`lib/ai/validator.js`)
3. Confirm with risk-aware UI (`lib/ui/confirm.js`, `lib/ui/format.js`)
4. Execute mapped internal API calls (`lib/ai/executor.js`)
5. Format output by action type (`lib/ai/format.js`)

## Supported Actions

- `post_facebook`
- `post_instagram`
- `post_whatsapp`
- `query_pages`
- `query_me`
- `query_instagram_media`
- `query_insights`
- `get_analytics`
- `check_limits`
- `list_campaigns`
- `create_campaign`
- `schedule_post` (facebook)

Intent metadata and risk profiles are defined in `lib/ai/intents.json`.

## Safety Model

- No shell execution, no `eval()`
- Strict intent validation before execution
- Token redaction in debug logs
- High-risk actions (`post_*`, `create_campaign`) require confirmation
- Structured execution results with metadata:
  - `apiCalls`
  - `executionTime`
  - optional `cost` hint

## Configuration

LLM parsing:

- `OPENAI_BASE_URL` (default: `https://api.openai.com/v1`)
- `META_AI_MODEL` (default: `gpt-4o-mini`)
- `OPENAI_API_KEY` or `META_AI_KEY`

Behavior:

- If LLM parsing fails/timeouts, parser falls back to heuristics
- Existing profile config defaults are reused:
  - default Facebook page id
  - default IG user id
  - default WhatsApp phone number id
  - default marketing ad account id

## Examples

```bash
meta ai "show my Facebook pages"
meta ai "who am I on Facebook"
meta ai "post 'Hello world' to my Facebook page"
meta ai "schedule post 'Launch reminder' tomorrow at 9am to My Business Page"
meta ai "post to Instagram with caption 'Sunset' and image https://cdn.example.com/sunset.jpg"
meta ai "send WhatsApp message 'Order confirmed' to +15551234567"
meta ai "check if I'm close to rate limit"
meta ai "get ad performance for last 30 days"
meta ai "list my active ad campaigns for account act_123456789"
meta ai "create campaign 'Summer Sale' with objective OUTCOME_SALES and daily budget 10000"
```

## Troubleshooting

`Missing token`

- Run auth:
  - `meta auth login -a facebook`
  - `meta auth login -a instagram`
  - `meta auth login -a whatsapp`

`Could not resolve page`

- List pages: `meta query pages --table`
- Set default page: `meta post pages --set-default`

`Missing IG user id`

- Resolve and set default:
  - `meta instagram accounts list --set-default`

`Missing ad account id`

- Set default:
  - `meta marketing set-default-account act_123456789`

`Parser confidence is low`

- Rephrase request with explicit action + ids (page/account/phone id)
- Use `--debug` to inspect parsed intent

`Non-interactive shell blocked`

- `meta ai` requires confirmation for writes.
- Use interactive terminal and approve prompts.

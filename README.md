# Social Flow

<p align="center">
  <img src="docs/assets/social-flow-logo-mint.svg" alt="Social Flow Mint Logo" width="220" />
</p>

Self-hosted execution engine for Meta operations.

Social Flow is the execution backbone for Marketing API, Graph, Instagram, and WhatsApp workflows. It handles deterministic runs, token and scope lifecycle, safe pagination, rate-limit discipline, error recovery, deployment hygiene, and multi-account/profile switching.

Start with the CLI for operator speed. Use the same runtime through the Gateway + SDK for agents, scripts, and custom apps.

## Why This Matters

In Meta ops, analytics logic is rarely the hard part. Reliable execution is. Tokens expire, scopes drift, retries fail midway, and partial writes create cleanup risk. Social Flow reduces that operational risk so teams can spend time on decisions, not firefighting.

## Who It Is For

- Agencies running multi-account Meta operations
- Operators managing daily ads/content/messaging workflows
- Indie hackers automating client delivery
- Agent builders who need a reliable Meta execution surface

## 60-Second Quickstart

```bash
# 1) Install
npm install -g @vishalgojha/social-flow

# 2) Guided setup + health checks
social start-here

# 3) Open the conversational control plane
social hatch
```

Optional Studio UI:

```bash
social studio --url http://127.0.0.1:1310
```

If `social` is not recognized, open a new terminal and retry.

## CLI Entry Points

```bash
social auth ...        # token/app credential management
social marketing ...   # Ads/Marketing API operations
social whatsapp ...    # WhatsApp API operations
social ops ...         # approvals, alerts, handoff, runbooks
social hatch           # conversational operator control plane
social studio          # Studio launcher
social gateway         # API/WebSocket runtime
```

## Gateway + SDK

Use the same execution engine programmatically:

```text
GET  /api/sdk/status
GET  /api/sdk/doctor
GET  /api/sdk/actions
POST /api/sdk/actions/plan
POST /api/sdk/actions/execute
```

Hosted multi-agent + BYOK layer (additive):

```text
POST /api/orchestrate
POST /api/keys
GET  /api/keys
GET  /api/agents
GET  /api/tools
GET  /api/recipes
GET  /api/triggers
```

## Common Operator Commands

```bash
social marketing status
social marketing portfolio --preset last_7d --target-daily 250
social marketing insights --help
social ops morning-run --workspace default
social ops approvals list --workspace default --open
social ops alerts list --workspace default --open
```

## Docs

- [Quickstart](QUICKSTART.md)
- [Examples](EXAMPLES.md)
- [Gateway UI/API](docs/GATEWAY_UI.md)
- [Hosted Platform](docs/HOSTED_PLATFORM.md)
- [Hatch UI](docs/HATCH_UI.md)
- [Chat Agent](docs/CHAT_AGENT.md)
- [AI Interface](docs/AI_INTERFACE.md)
- [SDK](sdk/README.md)
- [Deployment](DEPLOYMENT.md)
- [Contributing](CONTRIBUTING.md)

## Safety

High-risk actions should be reviewed before execution.

- Use `social doctor` before production runs
- Prefer plan-first flows in `social hatch` / `social ai`
- Use `social ops` approvals for team workflows

## License

Open-core licensing:

- MIT for default OSS scope - see [LICENSE](LICENSE)
- Commercial license for explicitly marked commercial files/directories - see [LICENSING](LICENSING.md) and [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL.md)

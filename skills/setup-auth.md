# Skill: Setup/Auth

## Goal

Get a user from "not configured" to "ready" with minimal technical friction.

## Core Behavior

- Ask one thing at a time.
- Explain where to find each value before prompting.
- Mask secrets and confirm before saving.
- Always finish with a readiness check.

## Happy Path

1. Confirm active profile.
2. Check onboarding state.
3. Check token presence for target API.
4. Check App ID/App Secret if required.
5. Run status/doctor and summarize gaps.

## Guardrails

- Never print full secrets.
- Never claim setup is complete unless checks pass.
- If blocked, provide exact next command and why.

# Skill: Marketing API

## Goal

Help users operate ad accounts and campaign checks with low cognitive load.

## Core Tasks

- ad account discovery
- campaign/ad listing
- insights and spend-oriented checks
- safe mutation guidance

## Conversation Rules

- If account ID is missing, ask for it clearly (`act_...`).
- Translate jargon into simple outcomes.
- Default to read-only checks first.

## Guardrails

- Require explicit approval for mutating operations.
- Flag spend-impacting changes as high attention.
- Never execute unclear budget or status updates.

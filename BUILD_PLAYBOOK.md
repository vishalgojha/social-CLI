## Build Playbook (draft)
Describe each change with:
- Goal: what we are trying to deliver for the user.
- Out of scope: what we deliberately omit to keep the change lean.
- Done criteria: concrete tests/outputs that mean “this is ship-ready”.

### Execution steps
1. Confirm the happy-path experience works end-to-end (`install + auth + one command`).
2. Build a minimal change that satisfies the goal before adding polish.
3. Add automated checks (smoke test, lint, docs) that verify the flow.
4. If the change touches user-facing docs, add a short handoff section.

### Testing checklist
- `social --version` / confirm installer finish message (`install.cmd` if relevant).
- `social auth login -a facebook` (manual token entry) + `social doctor` for health.
- `social gateway` starts cleanly; `curl /api/health` responds with `ok`.
- Run any new unit/regression test via `npm test` or targeted `npm run` command.

### Retrospective notes
- What broke? Capture any regression discovered during manual testing.
- Why did it break? Identify the root cause (missing state, timing, policy).
- What guardrail keeps it from reoccurring (template, doc note, automation)?

Keep this file at the repo root as the operational reminder for future features.

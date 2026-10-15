---
description: forge ship — CI, preview deploy with real post-deploy checks, release notes, production after approval
argument-hint: "[preview | production | stack ids]"
---

Ship: $ARGUMENTS

Use the **devops-engineer** agent following the `ship-release` skill:

1. `ci_generate` and commit the workflow.
2. `deploy_plan` — turn every missing CLI, login, link or secret into a blocker with the command the user must run.
3. `deploy` (preview): forge deploys with the official CLI, smoke-tests the URL, probes security headers and runs the e2e suite against it, then writes the release record and notes.
4. Show the user the release notes and rollback plan; production (`deploy` with `env: production`) only after they approve (`forge approve ship`).
5. `stage_complete ship` — the gate re-checks that the released URL answers.

Without MCP: `forge ci`, `forge deploy --plan`, `forge deploy`, `forge release notes`, `forge deploy --prod`.

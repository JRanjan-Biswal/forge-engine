---
name: write-prd
description: Turn a validated idea into a PRD with forge — goals, non-goals, user stories with Given/When/Then acceptance criteria, priorities, an MVP cut line and metrics. Produces the forge `prd` artifact for the `spec` stage.
---

# Write the PRD (forge `spec` stage)

**Produces:** `prd` artifact — `{ title, goals[], nonGoals[], stories[{ id, as, iWant, soThat, priority (must|should|could|wont), mvp, acceptance[{given, when, then}] }], metrics[{name, definition, target}], openQuestions[] }`.

## Inputs

`artifact_read vision`, `validation`, `competitors` — the PRD answers the validated problem and exploits the documented gaps (`gapOpportunities`, criteria C-07/C-08). Anti-goals from the vision become `nonGoals`.

## Steps

1. **Goals** — 2–4 outcomes tied to the vision's success metrics.
2. **Stories** — `S-1`, `S-2`, … one user-visible capability each, written as "As a <persona>, I want <capability>, so that <outcome>".
3. **Acceptance** — every story except `wont` gets Given/When/Then cases covering the happy path **and** the empty, error and edge states. These become the e2e tests later.
4. **Prioritise** — MoSCoW (`priority`). Mark the **MVP cut** (`mvp: true`): the smallest set that delivers the north star for the first segment. Prefer a walking skeleton through the whole journey over one polished corner.
5. **Metrics** — define each (`definition`) so an analytics engineer can implement it.
6. **Open questions** — anything you could not decide; do not guess.

Record scope decisions (what moved out of the MVP and why) with `ledger_add`.

`artifact_write prd` → `stage_complete spec` (gate: every story has acceptance criteria, at least one MVP story). Self-check with `rubrics/prd.md`.

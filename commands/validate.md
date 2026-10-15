---
description: forge validate stage — evidence-backed scorecard, competitor teardown, go / pivot / kill
argument-hint: "[idea, if not taken from the brainstorm]"
---

Run the forge `validate` stage for: $ARGUMENTS

Delegate to the **validation-scorer** agent, which runs the discovery team (problem-miner, market-researcher, competitor-scout in parallel; then competitor-teardown and devils-advocate). Without subagents, follow the `validate-idea` skill yourself, role by role.

Hard rules: every quote you cite is saved with `evidence_save` first (forge checks it against the source); a `yes` needs saved evidence; unknown stays unknown. Finish with `stage_complete validate` and present the decision memo. Do not approve on the user's behalf.

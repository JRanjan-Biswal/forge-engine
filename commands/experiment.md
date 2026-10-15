---
description: forge demand experiment — honest landing page + waitlist with a pre-registered success threshold
argument-hint: "[waitlist form endpoint URL, traffic plan or notes]"
---

Run a demand experiment for the current idea. User input: $ARGUMENTS

Check `forge_status` and `artifact_read validation` first: this is for a `needs-experiment` or `pivot` verdict. Delegate to the **landing-page-builder** agent if your host supports subagents; otherwise follow the `landing-page-test` skill (`guide skills/landing-page-test`). Without a real waitlist endpoint, record a blocker and stop — never fake signups or social proof.

---
description: forge verify stage — reviewer council → fixer → adversarial verifier, plus QA, until nothing blocking is open
argument-hint: "[branch, task ids or scope]"
---

Verify: $ARGUMENTS

Follow the `review-fix-loop` skill: **reviewer-council** (another model when possible) files findings with evidence → **fixer** (regression test first, minimal diff) → **verifier** tries to refute. Use the **debugger** for anything without a clear root cause, and the **test-strategist** to make sure every story's acceptance is covered by e2e tests. Write the `reviews` artifact and finish with `stage_complete verify`.

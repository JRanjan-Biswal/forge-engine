---
description: forge verify stage — reviewer council → fixer → adversarial verifier, plus QA, until nothing blocking is open
argument-hint: "[branch, task ids or scope]"
---

Verify: $ARGUMENTS

Follow the `review-fix-loop` skill: **reviewer-council** seats the **code-reviewer** (`code-review` skill) and the **security-reviewer** (`security-review` skill: `security_scan`, `security_headers` on the running app, `commands.audit`) — another model when possible — and files findings with evidence → **fixer** (regression test first, minimal diff) → **verifier** tries to refute. Use the **debugger** for anything without a clear root cause, and the **test-strategist** + **qa-engineer** (`qa-e2e` skill) so every MVP acceptance criterion has a tagged test (`qa_coverage` — gated). Write the `reviews` artifact and finish with `stage_complete verify`.

---
description: forge code review — correctness, contract, errors, data, tests, performance, maintainability and stack lens, plus a security pass for sensitive changes
argument-hint: "[branch, task id, PR or path]"
---

Review: $ARGUMENTS

1. **code-reviewer** agent, following the `code-review` skill: spec from the `task_brief` and the contract; read around the diff; lint/typecheck/tests/`security_scan` first; then the lenses in order and the stack's review lens (`stack_info`).
2. If the change touches input handling, auth, sessions, headers, cookies, files, redirects, outbound requests, uploads, crypto or LLM output: **security-reviewer** agent, following the `security-review` skill.
3. Findings go to the `reviews` artifact with evidence and severity. Summarise blocking findings first; continue with the `review-fix-loop` (fixer → verifier) when asked to fix.

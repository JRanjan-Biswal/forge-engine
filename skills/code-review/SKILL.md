---
name: code-review
description: forge's code review — read the diff and its surroundings, then check correctness against the story's acceptance, the API contract, error handling and silent failures, data and concurrency, tests that would actually catch a regression, performance, maintainability, design-system and accessibility rules and the stack pack's review lens; hand security-sensitive changes to the security-review skill. Findings need evidence (file:line plus a failing input or a broken rule) and a calibrated severity. Use for every task branch before merge and in the forge verify stage.
---

# Code review (forge `verify` stage, and every task before `forge merge`)

**Produces:** findings in the `reviews` artifact (`.forge/reviews/findings.json`): `{ id, severity, category, file, line, claim, evidence, suggestedFix, status: open }`. **Gate:** `review.noBlocking` — no open critical/high finding.

## 0. Set up
- Scope: the task branch diff (`git diff <base>...forge/task-<id>`) or the change under review. The `task_brief` — acceptance and stories — is the spec.
- Read **around** the diff: callers and callees (`graph_path`; `product_map` for the affected pages and endpoints), the tests, `contracts/openapi.yaml`, design tokens, and the stack's review lens (`stack_info <pack>`).
- Prefer a different model or vendor from the builder when the host allows; a change is never reviewed only by its author.
- Cheap checks first: `forge security scan`, the project's lint, typecheck and tests. Cite tool output; don't re-report it by hand.

## 1. Lenses (in this order — report criticals as soon as you find them)
1. **Correctness vs acceptance:** every Given/When/Then is implemented and tested. Edge cases: empty, one, many, maximum, unicode, time zones/DST, concurrent requests, retries, partial failure, null/undefined, very large input.
2. **Contract:** request/response shapes, status codes, error model, pagination and idempotency exactly as in the OpenAPI contract; breaking changes are versioned.
3. **Error handling & silent failures:** no swallowed exceptions (`catch {}`, bare `except:`), no success reported on failure, errors logged once with context and without secrets, the user sees a recoverable error state, retries bounded with backoff.
4. **Data & state:** transactions around multi-step writes; migrations reversible and safe on existing data; no N+1 queries; indexes for new filters; race conditions (check-then-act, read-modify-write); cache invalidation after writes; times stored in UTC.
5. **Security (first pass):** input validated at the boundary; authorization checked server-side for the specific object; no injection sinks (SQL, shell, dynamic evaluation, templates, raw HTML); no secrets. Anything that touches auth, sessions, headers, cookies, file paths, redirects, outbound requests, uploads, crypto or LLM output → also run the **security-review** skill (security-reviewer agent).
6. **Tests:** would they fail if the code were wrong? Behaviour assertions, not implementation details; no snapshot-only tests for logic; no mocks of the unit under test; fixtures only in test directories; e2e for each story path including error states.
7. **Performance:** complexity at realistic sizes, unbounded lists and queries, work on the request path that belongs in a job, client bundle size, re-renders in hot components, memory held across requests.
8. **Maintainability:** names say what things are; one responsibility per function/module; no dead or commented-out code; no duplicate of an existing helper (search before accepting a new one); comments explain *why*; consistent with the surrounding code.
9. **Product rules:** design tokens only, all four UI states, accessibility (labels, roles, focus order, contrast, keyboard paths), real copy, no placeholder data (rules/no-fake-data.md).
10. **Operability:** logs/metrics for the new path, a flag or safe rollout for risky changes, configuration from validated env vars.

## 2. Findings
- A finding needs **evidence**: `file:line` plus an input that breaks it, a failing test, or the contract clause or rule it violates. No evidence → it is a question; ask it in the summary.
- **Severity:** critical — data loss, a security hole, a crash on the main path. high — a story's acceptance is wrong, the contract is broken, a silent failure. medium — edge-case bug, missing test on a risky branch, performance problem at expected scale. low — maintainability and clarity.
- `suggestedFix` says concretely what to change.
- Don't block on taste. What a linter could enforce is a lint rule proposal, not a finding.
- A one-line "what's good" in the summary helps the builder keep it.

## 3. Hand-off
- `artifact_write reviews` with the new findings (keep existing ones; never mark your own findings fixed).
- **fixer** takes each open finding (regression test first); **verifier** tries to refute each fix — the `review-fix-loop` skill.
- Summary for the user: blocking findings first, then the rest by severity, with counts.

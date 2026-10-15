---
name: review-fix-loop
description: forge's review → fix → verify loop — a multi-lens reviewer council (ideally more than one model) files findings with evidence, a fixer makes minimal diffs with a failing regression test first, and an adversarial verifier tries to refute each fix — until no critical/high finding is open. Writes the `reviews` artifact the verify gate checks.
---

# Review → fix → verify (forge `verify` stage)

**Produces:** `reviews` artifact (`.forge/reviews/findings.json`): `{ findings: [{ id, severity: critical|high|medium|low, category, file, line, claim, evidence, suggestedFix, verifiedBy, status: open|fixed|wontfix|false-positive }] }`. Gate: no open critical/high, plus configured e2e/lint commands.

1. **Review (council)** — each lens reads the diff *and* its surroundings: correctness · security (OWASP, authz, injection, secrets) · design-system adherence (tokens, states) · contract conformance · maintainability · performance · language-specific idioms · silent failures (swallowed errors, mock data in prod paths). Use a second model/vendor as a reviewer when available. Every finding cites evidence (file:line, failing input, test). No evidence → not a finding.
2. **Fix** — per finding, smallest diff; write a regression test that fails before the fix. Do not refactor around it.
3. **Verify (adversarial)** — a different agent tries to break the fix: other inputs, edge cases, related call paths. Can't refute → `status: fixed`, `verifiedBy`. Refuted → back to fix.
4. Loop until no critical/high finding is open, or `maxIterations` → decision memo. False positives get a reason, never silent deletion.
5. `artifact_write reviews` → `stage_complete verify`. Repeated root causes → `memory_add_learning`.

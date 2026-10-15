---
name: debug-scientific
description: Debug like a scientist with forge — reproduce, minimise, rank at least three hypotheses, instrument, test one at a time, find the root cause, then hand a failing regression test to the fixer. Uses the graphify code graph to trace paths. Use for any bug, failing test or production incident.
---

# Scientific debugging

1. **Reproduce** — exact steps, input and environment; write it as a failing test or script. No reproduction → gather more data (logs, `memory_query "<symptom>"`), don't guess.
2. **Minimise** — smallest input and code path that still fails.
3. **Hypothesise** — at least three ranked causes; for each, the observation that would confirm or kill it. Use `graph_path` / `graph_explain` (graphify) and `product_map` to see what the failing path touches.
4. **Instrument & test** — one hypothesis at a time (logs, asserts, bisect with `git bisect` on the reproduction). Record what each result ruled out.
5. **Root cause** — the earliest point where state diverged from intent, not the line that crashed. Write `.forge/debug/<id>.md`: symptom, reproduction, hypotheses and verdicts, root cause, blast radius.
6. **Hand off** — the failing regression test + root cause to the **fixer**; a review finding if it came from review. Recurring class of bug → `memory_add_learning`.

Stop and report after two failed approaches; never "fix" by catching and ignoring the error.

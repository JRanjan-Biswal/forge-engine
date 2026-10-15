---
name: validate-idea
description: Evidence-backed idea validation with forge — fan out evidence searches, save verified quotes, tear down competitors, steel-man failure, fill the 12-criteria scorecard and reach go / pivot / kill / needs-experiment. Use for the forge `validate` stage or any "is this idea worth building?" question.
---

# Validate an idea (forge `validate` stage)

**Produces:** the `validation` and `competitors` artifacts, passing the validate gate.
**Never:** invent a source, paraphrase inside a quote, or answer "yes" without saved evidence.

## 0. Set up

1. `forge_status` → `stage_start` `validate`.
2. Read context: `artifact_read vision`, `artifact_read brainstorm` (the chosen idea), `memory_query "earlier validation decisions"`.
3. `validation_template` with a one-sentence idea → your working scorecard (12 criteria, all `unknown`).

## 1. Evidence fan-out

Search for the **pain**, not your solution. Phrase queries the way users complain. Run independent searches in parallel when your host allows (one researcher per source).

| Source (`evidence_search`) | Query style | What it proves |
|---|---|---|
| `hackernews` | "Ask HN" + the pain; the category name | Pain in practitioners' words, demand, prior attempts |
| `reddit` | the pain as a question ("how do you…", "I can't…") | Frequency and intensity of pain |
| `github` | solution keywords | Open-source competitors, traction (stars), abandoned attempts |
| `npm` | library keywords | Developer-tool competitors and adoption |
| `appstore` | the category | Consumer competitors, ratings, pricing |
| host web search | pricing pages, review sites, market reports, regulations | Willingness to pay, market size, why-now, risk |

**Save every quote you might cite** with `evidence_save { url, quote }`:
- Copy the source's exact words. Use `…` to skip text between fragments (fragments must stay in order).
- If `evidence_save` rejects the quote, you misquoted — fix it or drop the claim. Never "fix" it by paraphrasing.
- Blocked pages are stored as `unverifiable`. Prefer sources forge can verify: the gate requires `gates.validate.minVerifiedShare` (default 60%) of cited quotes to be verified.
- Target: ≥ 10 distinct sources overall.

## 2. Competitors

Follow the `competitor-teardown` skill → `artifact_write competitors` (≥ 5 competitors, direct + indirect + substitutes, review complaints with saved quotes).

## 3. Answer the scorecard

For each criterion:
- `yes` — only with at least one saved evidence item that directly supports it.
- `no` — when evidence contradicts it (cite it when you can).
- `unknown` — everything else. Unknown is an honest answer, not a failure.

Put each cited item in the criterion's `evidence` array exactly as saved (`url`, `quote`, `retrievedAt`).

## 4. Steel-man failure (devil's advocate)

List the strongest reasons this fails in `risks[]` with severity: distribution, incumbents' response, switching costs, regulation, platform dependence, timing. Revisit any `yes` that rests on weak evidence.

## 5. Score and decide

1. `validation_score` with your criteria → copy `score` into the artifact (the gate recomputes it).
2. Start from `suggestedVerdict`; deviate only with a reason recorded via `ledger_add`.
3. `needs-experiment` → add `experiments[]`, cheapest first: landing page + waitlist, 5 problem interviews, fake-door test, concierge MVP — each with the signal that would change the verdict.
4. `pivot` → hand over to the `pivot-advisor`; `kill` → recommend `forge archive`.

## 6. Write and gate

1. `artifact_write validation` (fix schema errors at their root).
2. `stage_complete validate`. Fix failing checks: evidence never saved, unsupported `yes`, score mismatch, too few sources/competitors.
3. When only `human-approval` remains, give the user a decision memo and let them approve.

### Decision memo (≤ 200 words)

```
Verdict: <go|pivot|kill|needs-experiment> — score <n>/100 (<yes>/<no>/<unknown>)
Strongest evidence: <2 bullets with source names>
Biggest risks: <2 bullets>
Competitors: <count>, white space: <one line>
Recommendation: <one line>  ·  To approve: forge approve validate
```

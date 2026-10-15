---
name: productize-product-vision
description: Define, sharpen or stress-test the vision of a product that already exists — grounded in forge's product model (what is actually built), separating facts from assumptions, drafting 3–5 vision options and choosing one, ending with a concrete next move. Writes the forge `vision` artifact. Use for brownfield products; for a brand-new idea use product-vision.
---

# Productize: product vision for an existing product

A vision answers "how do we inspire people, what are we aspiring to, what do we value" — and for a product that already exists, it must also be **credible against what is built**.

## Preamble — classify before writing

| Classify | Options |
|---|---|
| Persona asking | founder · product leader · AI PM · builder · stakeholder · mixed |
| Product stage | from the product model (`stage`), or idea · validation · PMF search · growth · scale · pivot |
| Artifact | vision statement + strategy memo (choices, trade-offs, risks, next move) |
| Evidence standard | what is **known** (code, docs, data), **assumed**, **missing**, **risky** |
| Decision mode | recommend · ask one blocking question · proceed with stated assumptions |

Operating rules: no generic strategy filler — tie every line to this product's evidence and stage; separate facts from assumptions; search existing context first (`artifact_read product`, `memory_query`, docs); ask only questions that change the output; end with the next action, owner and metric.

## Inputs (forge)

1. `product_sync` if the map is stale, then `artifact_read product` — features with status, gaps, personas, facts vs assumptions. If there is no model yet, run `understand-product` first.
2. `memory_query "vision decisions"`, existing `vision` artifact, docs from `product_map`.

## Method

1. **Core problem** — from personas' jobs and what the live features actually solve.
2. **Ideal future state** — for users, for the team, for the business.
3. **3–5 vision options**, each one sentence, each with: what it emphasises, which built features it leverages, which gaps it would force you to close, the riskiest assumption.
4. **Choose one** and explain why (fit with what is built, ambition vs credibility, customer / team / investor view). Inspiring, achievable, emotional; memorable in one sentence; no jargon.
5. **Translate to forge's vision fields** — `northStar` (a user-value metric), `problem`, `audience`, `principles`, at least 3 `antiGoals` (include what the current product does that the vision says stop doing), `futurePicture`, `narrative`, `successMetrics` with targets.
6. **Gap to vision** — list the product-model gaps and missing features the vision depends on; turn high-risk assumptions into tests, research prompts or instrumentation.

Write `artifact_write vision`, record the chosen option and the rejected ones with `ledger_add`, then `stage_complete vision`.

## Output (memo for the human checkpoint)

```
Vision (one sentence): …
Chosen because: … (vs options B–E)
Facts it rests on: … · Assumptions to test: …
Built today vs needed: [features live] / [gaps to close]
Next move: <action> · owner: <who> · metric: <what moves> · check: <when>
```

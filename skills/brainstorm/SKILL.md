---
name: brainstorm
description: Structured divergent → convergent ideation with forge — generate 30+ ideas with named techniques, cluster, score and pick one, producing the forge `brainstorm` artifact. Use for the forge `brainstorm` stage or "help me find a product idea".
---

# Brainstorm (forge `brainstorm` stage)

**Produces:** `brainstorm` artifact — `{ theme, ideas: [{ id, title, oneLiner, angle, technique, novelty (0–10), cluster }], shortlist[], chosenId }`.

## 1. Frame (2 minutes)

Write the theme as a "How might we…" question. Ask the user for constraints that matter: who they can reach, skills, budget, time. Check `memory_query` for earlier ideas and kills — do not resurface a killed idea without saying why.

## 2. Diverge — at least 30 ideas, no judging

Rotate techniques and record which one produced each idea (`technique`):

| Technique | Prompt |
|---|---|
| Jobs to be done | "When ___, I want to ___, so I can ___" for 5 different users |
| Pain inversion | Take the worst part of an existing workflow and remove it |
| SCAMPER | Substitute, combine, adapt, modify, put to other use, eliminate, reverse |
| 10× vs 10% | One idea that is 10× better, one that is 10% better and easy to sell |
| Analogy | "X for Y" — a proven model moved to a new audience |
| Constraint flip | Free → paid, online → offline, team → solo, manual → automatic |
| New capability | What is newly possible (LLMs, a new API, a regulation)? |
| Unbundling | One feature of a big platform done brilliantly |

Each idea: a title and a one-liner that names **who** and **what changes for them**.

## 3. Converge

1. Cluster duplicates (`cluster`).
2. Score each surviving idea quickly: pain (is it felt weekly?), reach (can the user find these people?), feasibility (MVP in ≤ 4 weeks?), novelty (0–10).
3. Shortlist 3 (`shortlist`). For each, one sentence on why it might fail.
4. Pick one (`chosenId`) — or let the user pick. Record the choice with `ledger_add` including the rejected shortlist ideas and why.

## 4. Write and gate

`artifact_write brainstorm` → `stage_complete brainstorm`.

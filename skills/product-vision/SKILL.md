---
name: product-vision
description: Write a product vision with forge — north star, problem, audience, principles, at least 3 anti-goals, a future picture and a press-release narrative, with measurable success metrics. Produces the forge `vision` artifact.
---

# Product vision (forge `vision` stage)

**Produces:** `vision` artifact — `{ northStar, problem, audience, principles[], antiGoals[≥3], futurePicture, narrative, successMetrics[{name, target}] }`.

## Steps

1. **Ground it.** `artifact_read brainstorm` (chosen idea) and `memory_query "why this idea"`.
2. **Problem** — one paragraph in the user's language: who, what hurts, how often, what they do today.
3. **Audience** — the first narrow segment you can reach, not "everyone".
4. **North star** — one metric that rises only when users get real value (e.g. "weekly users with a 3+ day streak"), not revenue or signups.
5. **Principles** — 3–5 tie-breakers for future decisions ("tiny daily steps over big plans").
6. **Anti-goals** — at least 3 things you will deliberately **not** do, each tempting ("no social feed", "no ads"). They keep scope honest later.
7. **Future picture** — what a user's week looks like in 3 years.
8. **Narrative** — a short press release from launch day: headline, the problem, the solution, a customer quote (clearly fictional), how to start.
9. **Success metrics** — 2–4 measurable ones with targets.

## Quality bar

Use `rubrics/vision.md` to self-check: specific audience, measurable north star, anti-goals that actually exclude something, no unsourced market claims (those belong in `validate`).

`artifact_write vision` → `stage_complete vision` → decision memo for the human checkpoint.

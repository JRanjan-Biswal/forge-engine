---
name: screen-design
description: Design every MVP screen with forge — flows and screen inventory from PRD stories, runnable prototypes on the design tokens with all four states (empty, loading, error, success), a screenshot-based critique loop with a different model as judge, and the screens artifact the design gate checks. Use for the forge `design` stage, part 2.
---

# Screen design (forge `design` stage, part 2)

**Produces:** `screens` artifact (`design/screens.json`), runnable prototypes, the design critique rubric result (`.forge/gates/design.rubric.json`). Gate: every MVP story has a screen, every screen designs all four states, critique ≥ `gates.design.rubricMinPass`, human approval.

1. **Flows & inventory** — from `prd` stories: user flows, navigation model, one screen per job (`storyIds` on every screen). Platform per screen (web / ios / android; adapt to HIG / Material 3 for native).
2. **Prototype** — a small runnable app (e.g. Vite + React) importing `design/dist/tokens.css` (or `tailwind.css`). Each route renders every state via `?state=empty|loading|error|success`. Copy comes from UX-writer keys, not lorem ipsum (the gap gate rejects placeholders).
3. **States** — empty (first use vs filtered-to-nothing, with the next action), loading (skeleton, not a blank page), error (what happened + recovery), success. `stateless: true` only for genuinely static pages.
4. **Critique loop (generator ↔ evaluator)** — `forge design shots` (MCP `design_shots`) screenshots each screen and state at 360 / 768 / 1280 px from `design/prototype/index.html?…&chrome=0`; it flags blank renders and states still holding only the placeholder comment, and the design gate requires shots newer than the prototype and tokens and a critique newer than the shots; the **design-critic** (a different model when available) scores the rubric below and returns fixes; iterate until it passes. Write the judge's result to `.forge/gates/design.rubric.json` (`{ judge, producer, criteria: [{ id, question, pass, note }] }`) — it must be newer than the stage start.
5. `artifact_write screens` → `stage_complete design` → decision memo for the human checkpoint.

**Critique rubric (binary):** one clear primary action per screen · hierarchy readable in a 1-second squint · spacing only on the token scale · contrast pairs pass in all themes · all four states designed · consistent components (no one-offs) · copy matches the voice · works at 360/768/1280 without horizontal scroll · no generic AI-aesthetic tells · visible focus and logical focus order.

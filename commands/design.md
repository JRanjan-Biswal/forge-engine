---
description: forge design stage — design system (tokens, themes, contrast), screens with all states, critique loop
argument-hint: "[brand notes or references]"
---

Run the forge `design` stage. User input: $ARGUMENTS

1. **design-system-architect** (or the `design-system` skill): tokens, themes, contrast pairs, DESIGN.md → `design_build` and `design_audit` clean.
2. **screen-designer** (or the `screen-design` skill): flows, token-based prototypes with all four states.
3. **design-critic** — a different model when possible — scores screenshots and writes `.forge/gates/design.rubric.json`; iterate until it passes.
4. `stage_complete design` → decision memo; the human approves.

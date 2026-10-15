---
description: forge motion stage — motion tokens, choreography specs with reduced-motion fallbacks, page animation
argument-hint: "[route to animate, or notes]"
---

Run forge motion work for: $ARGUMENTS

1. **motion-designer** (or the `motion-system` skill): motion tokens → `design_build`; specs → `artifact_write motion` → `stage_complete motion` (requires the `motion` pack in forge.config.yaml).
2. **web-animation-developer**: implement the specs for the requested route with tokens and reduced-motion fallbacks; verify frame rate and CLS/INP.
For an existing page without a motion stage, skip step 1's gate and implement against the specs directly.

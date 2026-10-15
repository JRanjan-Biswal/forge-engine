---
name: design-system
description: Build a product's design system with forge — brand intent → W3C DTCG tokens (primitive → semantic → component, light/dark/high-contrast themes) → declared contrast pairs → component specs → DESIGN.md — then `design_build` exports CSS, Tailwind v4, a typed TS theme and JSON. Use for the forge `design` stage or to extract tokens from an existing app.
---

# Design system (forge `design` stage, part 1)

**Produces:** `design/tokens/*.tokens.json`, `design/contrast.json`, `design/DESIGN.md`, component specs; `design_build` output in `design/dist/`. Gate: tokens resolve and validate, every declared pair meets WCAG in every theme.

## 1. Brand intent (from evidence)
Read `vision`, `personas` / product model, and competitors' positioning. Write 3–5 brand attributes ("calm, precise, warm") and what they rule out. Avoid default AI aesthetics: purple gradients, everything centred, emoji as icons, identical card grids.

## 2. Tokens — three tiers (DTCG)
- **Primitive** (`primitive.tokens.json`): colour ramps (50–950), type scale, spacing scale (4px grid), radius, elevation, z-index, breakpoints, durations/easings.
- **Semantic** (`semantic.tokens.json`): what code uses — `color.text.default/muted/inverse`, `color.bg.default/subtle/elevated`, `color.border.*`, `color.accent.*`, `color.state.success/warning/danger/info`, `space.inline/stack.*`, `motion.duration.*` — **aliases** of primitives (`"{color.indigo.500}"`).
- **Themes**: `semantic.dark.tokens.json` (and `.high-contrast.`) override only semantic tokens.
- **Component** tokens only when a component needs a decision the semantic layer cannot express.
Every token has `$type` (on it or its group). Code must reference semantic/component tokens, never primitives or raw hex — the gap gate's drift check enforces this.

## 3. Contrast pairs
Declare every text/background combination the UI uses in `design/contrast.json` (`{ "pairs": [{ "fg": "color.text.default", "bg": "color.bg.default" }, { "fg": "color.text.muted", "bg": "color.bg.subtle" }, …] }`; `min` 3 for large text/icons, default 4.5). forge checks each pair in every theme. Use hex, rgb or hsl — oklch is reported as uncheckable.

## 4. Components
For each component in the screens: anatomy, variants, sizes, states (default/hover/focus/active/disabled/loading/error), props, accessibility (role, label, focus order, target ≥ 44×44), motion hooks, do/don't. Store as `design/components/<name>.spec.json` or a section of DESIGN.md.

## 5. DESIGN.md
Brand intent · principles · colour usage · typography · spacing & grid · components · iconography · imagery · motion (link MOTION.md) · accessibility · do/don't. Portable — compatible with the DESIGN.md convention other tools read.

## 6. Build and check
`design_build` → fix every error (unresolved alias, invalid value, missing type). `design_audit` → fix failing contrast pairs (adjust the semantic token, not the component). Brownfield: start from `design_audit` drift output — each hard-coded colour with its suggested token is a migration task.

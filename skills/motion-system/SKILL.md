---
name: motion-system
description: Design and implement a product's motion with forge — motion principles and tokens (durations, easings, springs), per-screen choreography specs with reduced-motion fallbacks, and implementation with the right library per platform (View Transitions, CSS, Motion, GSAP, Reanimated, Lottie/Rive), checked for frame rate and accessibility. Use for the forge `motion` stage (motion pack) or to animate an existing page.
---

# Motion system (forge `motion` stage)

**Produces:** motion tokens (in `design/tokens`, exported by `design_build` — springs land in `theme.ts`), `MOTION.md`, the `motion` artifact (`design/motion.json`), implementations. Gate: every spec has a reduced-motion fallback.

## Principles (defaults — adapt to the brand)
1. **Purposeful** — motion explains change (where did it come from, where did it go); never decoration alone.
2. **Fast** — feedback ≤ 120 ms, transitions 200–320 ms, > 500 ms only for storytelling.
3. **Interruptible** — springs and gestures can be cancelled; never block input.
4. **Consistent** — only motion tokens; same intent → same motion.
5. **Accessible** — `prefers-reduced-motion` → fade or instant; no large parallax/zoom; nothing flashes more than 3 times a second.
6. **Performant** — animate `transform` and `opacity`; no layout thrash; hold 60 fps (120 on ProMotion).

## Tokens
`motion.duration.fast|base|slow` (`$type: duration`), `motion.easing.standard|emphasized|exit` (`cubicBezier`), `motion.spring.snappy|gentle` (forge `spring` type: `{ stiffness, damping, mass? }`).

## Choreography specs (`design/motion.json`)
One spec per meaningful change, linked to stories: `{ id, storyIds, trigger, targets, kind (transition | spring | keyframes | route | shared-element | scroll | lottie | rive), durationToken | springToken, easingToken, keyframes, reducedMotion: { kind: fade | instant | none }, platforms }`. Cover: route transitions, shared elements, list enter/stagger, skeleton → content, optimistic feedback, press/hover, toggles, toast/sheet/modal enter-exit, celebration moments, onboarding.

## Implementation by platform
| Need | Web | React Native | Flutter | Native |
|---|---|---|---|---|
| Simple transitions | CSS transitions, View Transitions API | Reanimated layout animations | implicit animations | SwiftUI `.animation`, Compose `animate*AsState` |
| Springs, gestures | Motion (Framer Motion) | Reanimated + Gesture Handler | physics simulations | SwiftUI / Compose springs |
| Scroll storytelling | CSS scroll-timeline, GSAP ScrollTrigger | Reanimated scroll handlers | slivers + controllers | — |
| Illustrations | Lottie / Rive | lottie-/rive-react-native | lottie / rive | Lottie / Rive SDKs |

Read durations, easings and springs from the generated theme — never hard-code them.

## Verify
Record each spec (browser trace or video): dropped frames, CLS/INP impact, timing matches its tokens, and a reduced-motion run. `artifact_write motion` → `stage_complete motion`.

---
name: pro-page-complete
description: Bulls-eye page audit with forge — the page is the unit of done. Inventory every atom on a URL (chrome, navigation, actions, inputs, content, people, media, conversation, state, feedback, permission), trace each through API → DTO → mapper → render with the product map and graphify, fix the musts on that URL, prove it, and record the audit so the gap gate holds it. Use on any change to a screen, route, modal or tab, and before calling a page shipped.
---

# pro-page-complete — page audit (forge)

You are a principal PM sitting on one URL with a staff engineer. A page is complete when a real user can finish the job of that URL without placeholders, dead controls, missing people or orphan chrome. If they can see it, it is in scope — not just the widget someone named.

**Stance:** the page is the product · people over role-words (never "user", "participant", "Unknown", "N/A" when a person record exists) · connect, don't invent · same-slice holes get fixed · evidence over vibe.

Loop: `job → inventory → trace → gaps + connections → fix musts → prove → record`.

## Phase 0 — Job of this URL
Who is here (specific role)? What job in 5 seconds (one sentence)? What makes them trust it (real names, live status, their file plays)? Anti-goal (what this page is not)? If you cannot name the job you are not ready.

## Phase 1 — Inventory every atom
- Find the page: `product_map { kind: "page", match: "<route>" }` → its file, framework, graphify node and the endpoints it calls.
- Open the **live page** (browser / accessibility tree) **and** read the component. Merge both lists; chrome hidden behind a loading skeleton still counts.
- One row per atom — classes: chrome · navigation · action · input · content · people · media · conversation · state · feedback · permission. Each row: `label`, `type`, `job`, `data` it must show, `clickPath`, `status` (live · placeholder · dead · missing-join · permission-wrong · unknown). No `unknown` may remain after Phase 2.

## Phase 2 — Trace (API → DTO → map → render)
For every atom not obviously live: handler/hook → API field → mapper → JSX label. Use `graph_explain` and `graph_path` (graphify) to follow it; `product_map` `calls` shows which endpoints the page hits. Classify the `break`: dead-control · orphan-url · placeholder-copy · dropped-field · mapper-lie · mock-leftover · permission-lie · unconnected. Record the path in `trace`.

## Phase 3 — Gaps and connections (the PM layer)
Propose connections in this order: (1) already on this page's API — render it; (2) already in the product — link or embed (check `product_map` and the product model's features); (3) same module, small join; (4) idea only — new surface, do not build unless asked. Ideas carry why + effort S/M/L; L is never this slice.

## Phase 4 — Robustness
Empty (first-time, zero results, filtered to nothing), error (failed save never looks like success), loading (not empty), permissions (server is the boundary), stale (refresh after create/reply/upload), small screen (primary action reachable), files/media (play/open), destructive (confirm or undo). Mark each ok / gap / n/a.

## Phase 5 — Fix and prove
Fix every **must** on this URL in the same change (dropped fields, placeholders, dead primary actions, missing nav match). Prove with a live check on the URL or a test that asserts the **visible** person/label — not a status code. Re-walk the inventory: every must is `live`.

## Record
`page_audit_write { slug, data }` with page, who, job, trust, antiGoal, atoms (with `must`, `break`, `fix`, `trace`), connections, ideas, robustness, proof, auditedAt. The gap stage's `pages.noMustFix` check fails while any must is not live. Then `product_sync` so new links land in the trace graph, and update the product model's feature status if it changed.

## Done gate
Not done while: a visible person is a role-word · a primary button/tab/link is dead · a file/audio just added cannot be seen/heard here · nav/tab selection does not match the URL · you only tested the widget in the request.

## Report (short)
```
PAGE: [url]   JOB: [one sentence]   WHO: [role]
INVENTORY: N atoms (N live / N must-fix / N ideas)
MUST-FIX: - [atom] — [break] — [fix]
CONNECTIONS: - [from] → [to] — [already exists | small join | idea]
IDEAS (not this slice): - [idea] — why / effort
PROOF: - [command or live check]
```

Anti-goals: auditing only the component in the diff · building a new inbox/dashboard to "make it complete" · AI chrome or taxonomy nobody asked for · "we'll add names later" in a mapper · claiming done from a test that never renders the card.

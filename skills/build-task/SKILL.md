---
name: build-task
description: Build one forge task test-first from its brief — in its own git worktree, touching only the files it owns, against the API contract and design tokens, with no placeholder data — and report it for review. Use for every task in the forge `build` stage, whether run by a subagent or a headless worker.
---

# Build one task (forge `build` stage)

1. **Get the brief:** `task_brief <id>` (or the `.forge/worktrees/<id>.brief.md` a worker received). It holds acceptance, stories with Given/When/Then, screens, motion specs, the API contract, related decisions, learnings and rules. `task_update <id> doing`.
2. **Work in isolation:** the task's worktree (`forge worktree create <id>` — branch `forge/task-<id>`). Edit only the files the task owns; if you need another file, stop and report it — that is a planning change.
3. **Test first:** for each acceptance item write the failing test (unit/integration; e2e for screens), see it fail, then implement until it passes.
4. **Follow the system:** the contract exactly as written; design tokens only (`design/dist`), all four UI states; real data paths — a missing key, account or decision becomes `blocker_add`, never a stub.
5. **Check:** the project's build and tests pass in the worktree (one heavy job at a time; stop anything you started).
6. **Report:** what changed, tests added, open questions. `task_update <id> done "<summary>"` — the review-fix loop and merge follow; link stories to code and tests with `trace_link` (`implementedBy`, `verifiedBy`).

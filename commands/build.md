---
description: forge build stage — run the task DAG in parallel waves, one worktree per task, test-first
argument-hint: "[task ids, or 'next']"
---

Run forge build work for: $ARGUMENTS

1. `task_waves` to see the plan; `task_next` for what can start now.
2. For each ready task (at most `workers.maxConcurrent` at once): give the **feature-builder** (UI) or **service-builder** (API) the verbatim `task_brief`, in its own worktree (`forge worktree create <id>`). Without subagents, run them headless with `forge workers run` or build them one by one following the `build-task` skill.
3. After each wave: review (`/forge:verify` loop), merge `forge/task-<id>` branches, then the next wave.
4. When all tasks are done: `stage_complete build` (runs the configured build and test commands).

---
description: Run, resume or inspect the forge pipeline (idea → validated → designed → built → verified → shipped)
argument-hint: "[status | run | resume | <stage> | <idea text>]"
---

You are driving **forge** through its MCP tools (server name `forge`). Arguments: `$ARGUMENTS`

- **No arguments, `status`:** call `forge_status` and show a compact dashboard — each stage with its status, the next stage and its command, open blockers. Then stop.
- **`run` or `resume`:** act as the forge **conductor** agent (delegate to it if your host supports subagents): orient with `forge_status` and `memory_query`, then work stages in order until a gate needs a human decision or the user stops you.
- **A stage id** (e.g. `validate`): work only that stage — `stage_start`, produce its artifacts with `artifact_write`, then `stage_complete` and report the gate result.
- **Free text** (an idea): if the project is not initialised, call `project_init`; start the `brainstorm` stage with the text as the theme, then continue as for `run`.

Always: a stage is done only when `stage_complete` passes; record decisions with `ledger_add`; save `memory_save_episode` before stopping.

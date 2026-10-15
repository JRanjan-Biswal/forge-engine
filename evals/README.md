# forge-bench

Published, reproducible measurements of what forge's agents actually produce. Runs use real agents and real web research, so they cost money and are run on demand — never in CI.

## Validate track

```bash
pnpm build
node evals/run.mjs                                   # all 6 tasks (≈ $1–2 each with --budget 2)
node evals/run.mjs --tasks habit-tracker --budget 2  # a subset
```

Each task in `validate/tasks.json` is an idea brief plus competitors that are well known in its market. For every task the runner initialises a fresh project, runs `/forge:validate` headless in Claude Code with the forge plugin, and scores **what is on disk**:

| Metric | Meaning |
|---|---|
| Checks passed | Every evidence, schema and scoring check of the validate gate passed (only the verdict decision / human approval may remain) |
| Verified-evidence share | Share of saved quotes forge verified against their source |
| Known-competitor recall | Share of the task's well-known competitors that appear in the teardown — an objective floor, not the whole picture |
| Competitors | Number analysed |
| Cost, time | From Claude Code's result and wall clock |

Verdicts are **reported, not graded**: whether an idea is worth building is a judgement, and an honest `needs-experiment` is a good outcome.

Tasks run **one at a time** (see `rules/process-lifecycle.md`). Results land in `results/` (committed, no local paths); raw run directories in `runs/` (gitignored).

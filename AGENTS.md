# Working on the forge repo

Instructions for coding agents (Codex, Claude Code, Gemini, Cursor, Copilot…) contributing to forge itself.

## Layout

- `src/schemas/` — zod contracts for every artifact and runtime record. Change these first; everything else follows.
- `src/core/` — the deterministic runtime: `engine.ts` (stage state machine), `gates.ts` (check runners and builtins), `stages.ts` (pipeline definition), `artifacts.ts` (registry + validated I/O), `ledger.ts`, `config.ts`, `init.ts`.
- `src/memory/` — episodes, learnings, secret scanning, graphify bridge, `query.ts` (cross-layer recall).
- `src/trace/` — traceability graph, gap analysis, placeholder scan.
- `src/mcp/server.ts` — MCP tools; `src/cli.ts` — the `forge` CLI. Both are thin layers over `Forge`.
- `agents/`, `commands/`, `rules/` — portable markdown content loaded by host plugins.
- `test/` — vitest; every behaviour change needs a test. `test/helpers.ts` has fixtures.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build          # dist/ is what the plugin's MCP server runs
pnpm schemas        # regenerate schemas/*.schema.json after changing src/schemas
```

## Principles

- Control flow is deterministic code; LLM output is never trusted to decide whether a stage is done.
- Every gate check must fail loudly with an actionable message. Unconfigured inputs fail (or skip when `optional`) — never pass silently.
- No new dependency without a clear need; the runtime must stay `npx`-installable and fast.
- Memory is committed to git: anything written to `.forge/` passes the secret scanner.
- New agents ship with an output schema, a rubric and eval cases (see `../plan/03-agent-roster.md` if present).

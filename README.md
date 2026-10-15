# forge

**Idea → validated → designed → built → verified → shipped — with receipts.**

forge is an open-source product pipeline for coding agents. Instead of a bag of prompts, it gives your agent (Claude Code, Codex, Gemini CLI, Cursor, or anything that speaks MCP) a **gated, resumable pipeline**: every stage writes a schema-validated artifact, every stage has a machine-checked gate, and every decision lands in a ledger that the next session — in any tool — can recall.

> **Status: alpha (v0.1.0-alpha).** The runtime spine is here: state machine, gates, artifacts, decision ledger, memory (with graphify), traceability and gap analysis, MCP server, CLI, and the Claude Code plugin with the conductor agent. Department agents (validation, design, motion, frontend, backend, mobile, QA…) land in the next waves — see [Roadmap](#roadmap).

## Why

- **Gates, not vibes.** A stage is done when its gate passes — schema valid, evidence cited, tests green, no open critical findings — not when the model says so.
- **Evidence or unknown.** Validation claims need a URL and a quote, or they stay `unknown`. Scores are recomputed from the answers.
- **Memory that survives tools.** State, artifacts, an append-only decision ledger, session episodes, learnings and a [graphify](https://pypi.org/project/graphifyy/) code graph live in your repo under `.forge/`.
- **Traceability.** Every MVP story must link to a screen, code and a test before `gap` passes. Placeholder data in product code fails the gate.
- **No fake data.** Missing keys or decisions become recorded blockers, never stubs.

## The pipeline

| # | Stage | Gate (abridged) |
|---|---|---|
| 1 | `brainstorm` | ideas valid, one chosen |
| 2 | `vision` | north star, ≥ 3 anti-goals, human approval |
| 3 | `validate` | every "yes" cites evidence · score recomputed and ≥ threshold · ≥ N sources · ≥ N competitors · verdict = go · approval |
| 4 | `spec` | every story has Given/When/Then · MVP cut set |
| 5 | `design` | tokens exist · every MVP story has a screen · empty/loading/error/success states · design-critic rubric · approval |
| 6 | `motion` *(pack)* | every motion spec has a reduced-motion fallback |
| 7 | `architect` | architecture doc · OpenAPI contract · ≥ 1 ADR |
| 8 | `plan` | task DAG acyclic · every MVP story has a task |
| 9 | `build` | your `build` and `test` commands exit 0 |
| 10 | `verify` | no open critical/high findings · e2e/lint if configured |
| 11 | `gap` | trace coverage ≥ 95% · no placeholder data |
| 12 | `ship` | release checks pass · rollback plan · approval |
| 13 | `launch` *(pack)* | launch kit |
| 14 | `learn` | episode saved |

Run `forge stages` for the exact checks. Thresholds live in `forge.config.yaml`. `autonomy: auto | checkpoint | strict` controls human approvals.

## Quick start

```bash
git clone https://github.com/<org>/forge && cd forge
pnpm install && pnpm build
pnpm link --global          # puts `forge` (and `forge-engine`) on your PATH
```

> Using Foundry? Its CLI is also called `forge` — use the `forge-engine` alias.

In your project:

```bash
forge init                  # forge.config.yaml + .forge/
forge status                # what's next
forge start brainstorm
forge artifact write brainstorm --file ideas.json
forge complete brainstorm   # runs the gate; exit code 1 if it fails
forge memory query "why did we choose Supabase?"
forge gaps                  # stories missing design / code / test links
```

### Claude Code

```text
/plugin marketplace add /path/to/forge
/plugin install forge@forge
```

Then use `/forge` (status), `/forge run`, `/forge validate`, or `/forge "an idea"`. Claude Code namespaces plugin commands, so it appears as **`/forge:forge`**. The plugin registers the forge MCP server and the **conductor** agent (`forge:conductor`). The plugin runs `dist/cli.js`, so build first.

Tested end to end: headless Claude Code (`claude -p --plugin-dir ./forge`) and OpenCode each drove a stage through its gate using only forge's MCP tools, verified on disk.

### Codex, Gemini CLI, Cursor and other MCP clients

Point the client at the MCP server: command `node`, args `["/path/to/forge/dist/cli.js", "mcp"]`. For example, Codex `~/.codex/config.toml`:

```toml
[mcp_servers.forge]
command = "node"
args = ["/path/to/forge/dist/cli.js", "mcp"]
```

Gemini CLI / Cursor (`settings.json` / `mcp.json`):

```json
{ "mcpServers": { "forge": { "command": "node", "args": ["/path/to/forge/dist/cli.js", "mcp"] } } }
```

Check your host's MCP documentation for the exact file. The server's instructions teach the agent the protocol: status → start → write artifacts → complete → record decisions → save an episode.

## Memory

| Layer | Where | Ask it |
|---|---|---|
| State | `.forge/state.json` | "what's next / blocked?" |
| Artifacts | `.forge/artifacts/`, `design/`, `contracts/` | "what are the MVP stories?" |
| Decision ledger | `.forge/ledger.jsonl` | "why Supabase?" |
| Code graph | `graphify-out/graph.json` (optional) | "which file handles checkout?" |
| Traceability | `.forge/graph/trace.json` | "is S-4 tested?" |
| Episodes & learnings | `.forge/episodes/`, `.forge/learnings.md`, `~/.forge/global/` | "what happened last session?" |

`forge memory query` (MCP: `memory_query`) routes the question to the right layers and returns cited hits within a token budget. Every write to memory passes a secret scanner.

## Process & RAM protection

Agents love to leave dev servers, watchers, test runners and MCP servers running. forge doesn't, and makes your agents stop too:

- **Gate commands run in their own process group.** On exit, timeout or Ctrl-C the whole group is stopped — including background jobs a command left behind (forge reports them: "stopped 1 background process(es) it left running").
- **One heavy command at a time per project**, shared across every agent and process (`resources.maxConcurrentCommands`, default 1).
- **The MCP server never outlives its host:** it exits when the client disconnects, on SIGINT/SIGTERM/SIGHUP, or if it gets orphaned.
- **`forge procs`** (MCP: `process_snapshot`) lists every process belonging to the project with its resident memory; `forge doctor` shows memory headroom; `forge procs init` creates a local `AGENT_PROCESSES.md` registry.
- The conductor agent and the MCP instructions carry the [process-lifecycle rule](rules/process-lifecycle.md): look before launching, reuse, cap test workers, stop what you start, verify it exited, never kill what you didn't start.

These are process rules, not an OS-enforced memory limit.

## Roadmap

- **v0.1 Validate** — brainstorm, vision, evidence collectors, competitor teardown, validation scorer, PRD team
- **v0.2 Design + Motion** — design-system engine (DTCG tokens → web/RN/Flutter/SwiftUI/Compose), screen generator, critique loop, motion system
- **v0.5 Build & Verify** — architecture, frontend/backend/web teams, task DAG + worktrees + headless workers, review/debug/fix, QA, gap
- **v1.0 Everywhere** — mobile, adapters for every host, published forge-bench evals

## Development

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm schemas    # regenerate schemas/*.schema.json
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.

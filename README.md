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
forge evidence search hackernews "habit tracker"
forge evidence save --url <url> --quote "<the source's exact words>"
forge validate score               # weighted score + suggested verdict
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

## Build & verify (parallel, bounded)

```bash
forge tasks waves          # the task DAG as parallel waves (dependencies + file ownership conflicts)
forge tasks brief T-4      # everything one task needs: stories, acceptance, screens, motion, contract, decisions
forge workers run --max 1  # ready tasks run headless (Claude Code, Codex, Gemini, OpenCode), one git worktree each
forge merge                # done tasks merge back in wave order — only if their tests pass; conflicts abort cleanly
```

**Stack packs** — `nextjs`, `expo`, `fastapi`, `node-hono`, `supabase` (add your own in `.forge/stack-packs/<id>/pack.yaml`). Each pack knows how to recognise its stack, which gate commands it can run (only when the scripts, dependencies and files exist — never guessed), the official generator, and a conventions + review lens that lands in every task brief and review.

```bash
forge stack detect                    # stacks in this repo (monorepos too) and the commands each could run
forge stack use                       # record them in forge.config.yaml and fill empty build/test/e2e/lint
forge stack scaffold nextjs --run     # official generator (create-next-app), then `stack use`
forge stack show fastapi              # conventions and review lens
```

Workers are capped (`workers.maxConcurrent`, default 1), run in their own process groups with timeouts, and mark tasks done or blocked; review and merge follow. The verify stage runs a reviewer council → fixer (regression test first) → adversarial verifier loop, with a scientific debugger and a test strategist.

## Code & security review

Two reviewer skills ship with forge — `code-review` and `security-review` — each with an agent (`code-reviewer`, `security-reviewer`), a slash command (`/forge:review`, `/forge:security`) and, for security, a rubric and an always-on `secure-by-default` rule for builders. The verify gate doesn't trust the reviewers' word: it re-runs the checks itself.

```bash
forge security scan             # code/SQL/NoSQL/shell/template injection, XSS, SSRF, path traversal, open redirects,
                                # header injection, unsafe deserialization, TLS off, CORS+credentials, secrets, .env files
forge security scan --record    # file new findings into the reviews artifact for the review → fix → verify loop
forge security headers http://localhost:3000   # CSP, HSTS, clickjacking, nosniff, Referrer/Permissions-Policy,
                                               # COOP, cookie flags, CORS with a foreign Origin, version leaks
```

Every finding carries file:line, CWE and a fix. A justified exception needs an inline `forge-security-ignore <rule> -- <reason>`; suppressions without a reason are ignored. Set `security.url` to have the verify gate check the running app's headers, and `commands.audit` (filled by `forge stack use`) for vulnerable dependencies.

## Existing products (brownfield)

Most teams are mid-build, not starting from scratch. forge can adopt a product that already exists and keep an always-current understanding of it:

```bash
forge adopt            # init + product map + graphify code graph; adds the "understand" stage
forge hooks install    # re-sync the map after every commit / merge / checkout
forge product pages    # what forge found: pages, endpoints, calls, docs
```

- **Product map** — every page and API endpoint (Next.js app/pages, Expo Router, SvelteKit, Nuxt, React Router, Express/Hono/Fastify, FastAPI/Flask, plain `node:http`), which code calls which endpoint, all docs, each linked to its graphify node and into the traceability graph.
- **Product model** — personas and features, each tied to real pages, endpoints and files with a verified status, gaps, and facts kept apart from assumptions. The `understand` gate fails until **every** page and endpoint is accounted for and the map is fresh.
- **Always in sync** — a fingerprint detects code changes instantly; git hooks and a Claude Code SessionStart hook keep the map current; `forge sync` reports added/removed surfaces and features that reference removed code.
- **`/forge:productize-vision`** — the product vision for what is actually built: facts vs assumptions, 3–5 options, one chosen, gaps to close, next move.
- **`/forge:page <route>`** — pro-page-complete: inventory every atom on a page, trace API → DTO → mapper → render, fix the musts, prove them; the gap gate holds open musts.

## Design & motion engine

One W3C DTCG token source → every platform, with checks instead of opinions:

```bash
forge design build      # design/tokens → design/dist: tokens.css (light/dark + prefers-color-scheme), tailwind.css (@theme),
                        #   theme.ts (typed, incl. springs), tokens.json, tokens.dart (Flutter), ForgeTokens.swift (SwiftUI), ForgeTokens.kt (Compose)
forge design prototype  # single-file prototype: every screen × empty/loading/error/success, on the tokens
forge design audit      # token validity, WCAG contrast for declared pairs in every theme, hard-coded colours with the token to use instead
```

The design gate requires valid tokens and passing contrast; the gap gate rejects hard-coded colours. Agents: design-system-architect, screen-designer, design-critic (a different model judges screenshots), motion-designer and web-animation-developer, with `design-system`, `screen-design` and `motion-system` playbooks.

## Evidence engine (validate stage)

Validation is only as good as its sources, so forge **checks quotes instead of trusting them**:

- `evidence_search` / `forge evidence search <source> "<query>"` — Hacker News, GitHub, npm and the App Store (Reddit when it allows unauthenticated access); results cached 24h, with traction metrics.
- `evidence_save` / `forge evidence save --url … --quote "…"` — forge confirms the quote appears in the search result or on the fetched page (`…` skips text between fragments). **Misquotes are rejected.** Pages it cannot fetch are stored as `unverifiable`, with the reason.
- The validate gate fails if any quote cited in the scorecard or competitor teardown was never saved through the store, or if fewer than `gates.validate.minVerifiedShare` (default 60%) of cited quotes are verified.
- `validation_template` gives the standard 12-criteria binary scorecard; `validation_score` computes the weighted score and suggests go / pivot / kill / needs-experiment.

The discovery team that uses it — `validation-scorer` leading `problem-miner`, `market-researcher`, `competitor-scout`, `competitor-teardown`, `devils-advocate` and `pivot-advisor` — plus `brainstorm-facilitator`, `product-visionary` and `pm-lead`, ship as Claude Code subagents. Their playbooks ship as portable skills that any MCP host can read with the `guide` tool.

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

- **v0.1 Validate** *(in progress)* — evidence engine with quote verification ✅, scorecard ✅, strategy/discovery/PM agents and skills ✅; next: forge-bench Validate track, landing-page smoke test
- **v0.2 Design + Motion** *(in progress)* — DTCG token pipeline → CSS/Tailwind/TS ✅, contrast + drift audits ✅, design/motion agents and skills ✅; native exporters (Flutter, SwiftUI, Compose) ✅, prototype scaffold ✅; next: screenshot critique automation
- **v0.5 Build & Verify** *(in progress)* — task waves + briefs ✅, worktrees + bounded headless workers ✅, architecture/build/review/debug/QA agents and skills ✅; merge queue ✅; stack packs (Next.js, Expo, FastAPI, Hono, Supabase) ✅; next: forge-bench Build track
- **v1.0 Everywhere** — mobile, adapters for every host, published forge-bench evals

## Development

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm schemas    # regenerate schemas/*.schema.json
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.

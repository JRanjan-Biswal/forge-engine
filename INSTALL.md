# Installing forge-engine

forge-engine works in **Claude Code** (full plugin: MCP server, agents, skills, slash commands), **Codex** (native plugin: MCP server + skills), and **any MCP client** (Gemini CLI, Cursor, OpenCode, Windsurf, …). The same npm package also gives you the `forge-engine` command line.

- Repository: https://github.com/JRanjan-Biswal/forge-engine
- npm package: `forge-engine`

## Requirements

| | Needed for |
|---|---|
| **Node.js 20+** (with npm/npx) | everything — the MCP server and CLI are Node |
| **Claude Code 2.1.275+** | the Claude Code plugin (`claude plugin install … --marketplace` in one step) |
| **Codex CLI 0.146+** | the Codex plugin (`codex plugin add`) |
| git | installing from GitHub, worktrees for parallel builds |

Optional, only for the features that use them: [graphify](https://pypi.org/project/graphifyy/) for code-graph memory (`uv tool install graphifyy`), a Chromium-family browser for `forge design shots` (Chrome works, or `npx playwright install chromium-headless-shell`), the toolchains of the stacks you build with (pnpm, uv, …) and the deploy CLIs you ship with (`vercel`, `fly`, `eas`, `supabase`).

## Quick install (recommended)

```bash
npx forge-engine setup
```

It finds Claude Code and Codex on your machine, **prints the exact commands it will run**, asks before changing anything, then checks the result with each host's own `plugin list`:

```text
Will run:
  claude plugin install forge-engine --marketplace JRanjan-Biswal/forge-engine --scope user
  codex plugin marketplace add JRanjan-Biswal/forge-engine
  codex plugin add forge-engine@forge-engine
Proceed? [y/N]
```

| Option | |
|---|---|
| `--dry-run` | show the plan only |
| `--yes` | don't ask (CI, scripts) |
| `--host claude` / `--host codex` | only one host |
| `--scope user\|project\|local` | Claude Code install scope (default `user`; Codex has no scopes) |
| `--source <path\|owner/repo>` | install from a checkout or a fork instead of the main repo |
| `--remove` | uninstall from the hosts again |

Restart Claude Code / Codex afterwards.

## Claude Code

**From the GitHub marketplace** — in a terminal:

```bash
claude plugin install forge-engine --marketplace JRanjan-Biswal/forge-engine --scope user
```

or inside Claude Code: `/plugin install forge-engine --marketplace JRanjan-Biswal/forge-engine` (two steps on older versions: `/plugin marketplace add JRanjan-Biswal/forge-engine`, then `/plugin install forge-engine@forge-engine`). The plugin starts its MCP server with `npx forge-engine@<version>` — downloaded from npm once, on first use.

**From npm**, where your Claude Code account has npm plugin installs enabled: `claude plugin install forge-engine@npm` (bundles the built server, works offline afterwards). If it says npm installs are not enabled for your account, use the marketplace command above.

**Scopes:** `user` (all your projects), `project` (shared with the repo through `.claude/settings.json`), `local` (this repo, only you).

**Check it works:**

- `/plugin list` shows `forge-engine@forge-engine` enabled; `/mcp` shows the `forge` server connected.
- `/forge-engine:forge` prints the pipeline status (`forge-engine init` the project first, or let the conductor do it).
- More commands: `/forge-engine:validate <idea>`, `/forge-engine:design`, `/forge-engine:build`, `/forge-engine:review`, `/forge-engine:security`, `/forge-engine:qa`, `/forge-engine:ship`, `/forge-engine:adopt` (existing codebases). Agents appear as `forge-engine:<name>` — conductor, security-reviewer, qa-engineer, devops-engineer and the rest.

**Update:** `claude plugin update forge-engine` · **Remove:** `claude plugin uninstall forge-engine` (or `npx forge-engine setup --remove`).

## Codex

```bash
codex plugin marketplace add JRanjan-Biswal/forge-engine
codex plugin add forge-engine@forge-engine
codex plugin list --json          # forge-engine@forge-engine … "enabled": true
codex mcp list                    # forge  npx --yes forge-engine@<version> mcp
```

Restart Codex (or open `/plugins`). You get forge's **MCP server** (pipeline, memory, evidence, design, security, QA and deploy tools) and its **skills** — the playbooks: validate-idea, design-system, code-review, security-review, qa-e2e, ship-release, … Codex has no Claude-style slash commands or subagents, so ask in plain words:

> Use forge: call `forge_status` and work on the next stage.
>
> Use the security-review skill on this repository.

The server explains its protocol when the agent connects, and the `guide` tool returns any playbook (`guide skills/security-review`).

Codex asks before each MCP tool call. Approve forge's tools when asked, or pre-approve the ones you trust in `~/.codex/config.toml` (one block per tool):

```toml
[mcp_servers.forge.tools.forge_status]
approval_mode = "approve"
```

**Update:** `codex plugin marketplace upgrade forge-engine && codex plugin add forge-engine@forge-engine` · **Remove:** `codex plugin remove forge-engine@forge-engine && codex plugin marketplace remove forge-engine`.

**MCP only** (no plugin), in `~/.codex/config.toml`:

```toml
[mcp_servers.forge]
command = "npx"
args = ["--yes", "forge-engine", "mcp"]
```

## Other MCP clients

The server is `npx --yes forge-engine mcp` (stdio); it exits when the client disconnects.

Gemini CLI (`~/.gemini/settings.json`), Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`), Windsurf and most others:

```json
{ "mcpServers": { "forge": { "command": "npx", "args": ["--yes", "forge-engine", "mcp"] } } }
```

OpenCode (`opencode.json`):

```json
{ "mcp": { "forge": { "type": "local", "command": ["npx", "--yes", "forge-engine", "mcp"], "enabled": true } } }
```

Check your client's MCP documentation for the exact file location.

## Command line

```bash
npm install -g forge-engine
forge-engine --help
```

The package installs two commands, `forge-engine` and `forge`. If you use Foundry (Ethereum), its CLI is also called `forge` — use `forge-engine`.

```bash
forge-engine init            # forge.config.yaml + .forge/ in this project
forge-engine status          # pipeline dashboard
forge-engine adopt           # existing codebase: product map + code graph + understand stage
forge-engine doctor          # node, memory, config, graphify, agent CLIs
```

## From source (contributors)

```bash
git clone git@github.com:JRanjan-Biswal/forge-engine.git && cd forge-engine
pnpm install && pnpm build
pnpm link --global                         # forge / forge-engine on your PATH
forge-engine setup --source . --dry-run    # install this checkout as the plugin
```

Installing a **local path** as a plugin copies the whole folder into the host's plugin cache — including `node_modules`, a few hundred MB. Use a clean clone, or install from GitHub.

## First run

```bash
cd your-project
forge-engine init
```

Then, in Claude Code, `/forge-engine:forge "a habit tracker for busy professionals"` — or in Codex, "use forge to validate this idea: …". forge walks the gated pipeline (brainstorm → vision → validate → spec → design → architect → plan → build → verify → gap → ship → learn), and every stage ends at a deterministic gate. The [README](README.md) explains each stage.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `forge: command not found`, or Foundry's `forge` runs | use `forge-engine`, or `npx forge-engine …` |
| `npx forge-engine@x.y.z mcp` → `notarget` / 404 | that version is not published (yet) — update the plugin, or `npm i -g forge-engine` |
| `/mcp` doesn't list `forge` | restart Claude Code; `claude plugin list` must show it enabled |
| Codex doesn't see the tools | restart Codex; `codex mcp list` must show `forge`; the first start downloads the package (needs network once) |
| `forge design shots`: no browser found | install Chrome, or `npx playwright install chromium-headless-shell`, or set `FORGE_BROWSER` |
| `forge deploy` blocked: not logged in | run the login it names (`vercel login`, `fly auth login`, …) — forge never fakes a deploy |
| Working **on forge itself** (inside this repo): the Codex plugin's server doesn't start | npx sees the repo's own `package.json` (also named forge-engine) — in this repo use the local build: `codex mcp add forge -- node <repo>/dist/cli.js mcp` |
| Anything else | `forge-engine doctor`, then open an issue: https://github.com/JRanjan-Biswal/forge-engine/issues |

## Uninstall

```bash
npx forge-engine setup --remove      # Claude Code + Codex plugins
npm uninstall -g forge-engine        # the CLI, if installed globally
```

Project data lives in each project's `.forge/` and `forge.config.yaml`; delete them to remove forge from a project.

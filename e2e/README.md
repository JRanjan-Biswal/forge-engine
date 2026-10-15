# forge end-to-end tests

Acceptance tests that run forge the way users will, against the built `../forge/dist/`.

```bash
# from the forge repo root, after pnpm install && pnpm build
pnpm e2e                            # free, deterministic, ~1 min (one heavy job — run nothing else heavy alongside)
pnpm e2e:hosts                      # real agents: Claude Code, Codex, OpenCode (costs a little)
node e2e/hosts.mjs claude           # just one host
FORGE_E2E_OPENCODE_MODEL=xai/grok-4.7 node e2e/hosts.mjs opencode   # OpenCode on Grok
```

Reports: `e2e/LATEST-local.md`, `e2e/LATEST-hosts.md`, plus a full run directory under `e2e/runs/<timestamp>-*/` (gitignored) containing every test project, so any failure can be inspected. Only the newest 6 run directories are kept.

## What `run.mjs` covers

0. `pnpm build` + the vitest unit suite
1. Packaging — `npm pack`, tarball contents, `npm install` of the tarball, both binaries run
2. A 14-stage pipeline (motion + growth packs on) on a real Node app in `fixtures/app/`. Each gate is first shown failing for the right reason, then the cause is fixed. Real fix loops: a planted streak bug fails the real test suite until `fixtures/fixes/store.js` is applied; planted lorem-ipsum copy fails `gap` until `fixtures/fixes/copy.js` is applied; the ship stage runs a real smoke test against the running server.
3. Memory — why / coverage / history / spec / status questions, learnings, secret refusal
4. graphify — real code graph build, code questions routed to graphify, `explain`, `path`
5. Robustness — root discovery, `FORGE_ROOT`, corrupt state/config/ledger, ordering, escalation, override, reopen, archive, blockers, strict autonomy, EPIPE, concurrent writers
6. MCP over real stdio using the official SDK client, including that the server exits when the client disconnects
7. Process hygiene & RAM protection — a gate command that leaves a background process (forge stops it), the MCP server exiting on stdin close and when orphaned, `forge procs` / `procs init` / `doctor`, and a final check that the run leaves **no** processes behind
8. Exported JSON Schemas validated with Ajv against the pipeline's real artifacts

The validate stage's fixture quotes are served by `fixtures/evidence-server.mjs` (a separate process the harness starts and stops), so evidence is genuinely verified through forge's evidence store without the internet.

## What `hosts.mjs` covers

`node e2e/hosts.mjs claude-validate` (opt-in, real web research, capped by `FORGE_E2E_BUDGET`, default $4) runs `/forge:validate` on a real idea (`FORGE_E2E_IDEA`) with the discovery subagents, and reports how far the gate got, the verdict, competitors and the verified-evidence share.


Each host must, using only forge's MCP tools: initialise a project, start `brainstorm`, write a valid artifact, pass the gate, and record a decision. Results are verified **on disk**, not from the agent's claims. Claude Code also checks plugin registration (MCP server, 25 tools, `/forge` command, conductor agent) and runs the `/forge status` command. The plugin is loaded with `--plugin-dir`, so your global Claude Code configuration is not changed.

Fixture data (evidence URLs on example.com, competitors) is synthetic and exists only to exercise gate logic.

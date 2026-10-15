---
name: architecture
description: Design the system for a validated PRD with forge — stack choice from what the team and product need, boundaries, a contract-first API (OpenAPI), data model, threat model and one ADR per major decision — then the task DAG that the build waves run from. Use for the forge `architect` and `plan` stages.
---

# Architecture → plan (forge `architect` + `plan` stages)

**Produces:** `architecture` (`.forge/artifacts/architecture.md`), `openapi` (`contracts/openapi.yaml`), ADRs in `.forge/adr/`, then `tasks` (`.forge/artifacts/tasks.json`).

## Architect
1. **Inputs:** `prd` (MVP stories, non-goals), `vision` principles, `screens`, product model (brownfield: respect what exists — extend, don't rewrite). `memory_query` for earlier decisions.
2. **Stack:** choose the boring option that fits the team and platforms (`forge.config.yaml` platforms). Prefer a stack pack (`stack_list`: nextjs, expo, fastapi, node-hono, supabase) — packs bring conventions into every task brief, a review lens and gate commands. Existing repo: `stack_use` records what is detected. New app: run the official generator from `stack_info <pack>` (`forge stack scaffold <pack> --run`), then `stack_use`. Commands it reports as missing are tasks in the skeleton wave (add the test runner, e2e tool). One ADR per major choice (`.forge/adr/0001-<slug>.md`: context, options, decision, consequences) and a `ledger_add` with rejected options.
3. **Contract first:** every endpoint the screens need, in OpenAPI — request/response schemas, error model, pagination, idempotency for writes, auth. Frontend, backend and mobile build in parallel against this contract.
4. **Data model:** tables/collections, indexes, ownership and access rules (RLS / tenancy) for every entity in the stories.
5. **Threat model:** STRIDE per boundary; abuse cases; where secrets live (env/secret store, never the repo).
6. `stage_complete architect`.

## Plan (task DAG)
- One task = one reviewable change (≈ ½–1 day), linked to `storyIds`, with `dept`, `deps`, the **files it owns** (`files` — tasks in the same wave must not share files) and concrete `acceptance`.
- Order: contracts & skeleton (schema, generated API client, tokens → code, app shell, CI) → services ∥ components → features → integrations.
- Every MVP story needs at least one task; check with `task_waves` that the waves look sensible.
- `artifact_write tasks` → `stage_complete plan`.

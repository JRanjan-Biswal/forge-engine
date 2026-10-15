---
name: understand-product
description: Understand an existing product in depth before changing it — adopt it into forge, read every page, endpoint, doc and the graphify code graph, and write a product model where every surface belongs to a feature. Use when joining a product mid-build (developer or PM), before productize-product-vision or pro-page-complete, and for the forge `understand` stage.
---

# Understand an existing product (forge `understand` stage)

**Produces:** the `product` artifact (`.forge/product/model.json`) — personas, features linked to real pages/endpoints/files with a status, gaps, facts vs assumptions, open questions. The gate requires a **fresh** product map and **every** page and endpoint accounted for.

## 1. Map (deterministic — forge does this)

1. `product_adopt` (first time) or `product_sync` (afterwards). This builds the product map — pages and endpoints per framework, client→endpoint calls, docs — refreshes the graphify code graph, and links it all into the trace graph.
2. `product_map` → note frameworks, counts, and anything surprising (no pages found? an API with no callers?).
3. Optional, for richer docs/semantic links: run graphify's full pipeline on the repo (`/graphify` in Claude Code). `forge sync` keeps the code part fresh without an LLM.

## 2. Read — in depth, not by filename

Work feature by feature; fan out to subagents per area when your host allows.

- **Every doc** in `product_map.docs` (README, docs/, ADRs, PRDs): what the product claims to do.
- **Every page**: open its file; follow what it renders and which endpoints it calls (`calls` in the map). Use `graph_explain <node>` and `graph_path <a> <b>` (graphify) to see what a page or endpoint touches.
- **Every endpoint**: handler → data access → who calls it. An endpoint with no caller is either an integration point or dead code — say which.
- `memory_query` for decisions already recorded.

## 3. Model

Write `artifact_write product`:

| Field | Rule |
|---|---|
| `summary` | What the product is, for whom, in 2–3 sentences — from evidence |
| `stage` | idea / validation / pmf-search / growth / scale / pivot / unknown |
| `personas` | Who uses it and their jobs (from UI copy, roles, docs) |
| `features` | One per user-visible capability. `surfaces` = map ids (`page:/…`, `endpoint:GET /…`), `files`, `status`: live / partial / placeholder / broken / unknown, `evidence` = file paths, docs, tests, graph nodes you read |
| `ignoredSurfaces` | Health checks, internal/admin tools — each with a reason |
| `gaps` | Broken flows, placeholders, unconnected surfaces, missing states |
| `facts` / `assumptions` | Keep them separate. Everything not seen in code or docs is an assumption |
| `openQuestions` | What only the team can answer |

Status means what you **verified**: `live` only if the flow is wired end to end; `unknown` is honest.

## 4. Gate and keep in sync

`stage_complete understand` — fix `product.coverage` by adding every missing surface to a feature (or `ignoredSurfaces` with a reason). After later code changes: `product_sync` (the SessionStart hook and the git hooks from `forge hooks install` remind you); it reports features that reference removed code — update the model.

Next: `productize-product-vision` (where should this product go?) and `pro-page-complete` (is each page actually done?).

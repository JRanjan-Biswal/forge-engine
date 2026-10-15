import { McpServer } from "../vendor/mcp-server.js";
import { StdioServerTransport } from "../vendor/mcp-stdio.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "../vendor/zod.js";
import { ARTIFACTS, listArtifacts, loadArtifact, readArtifactText, writeArtifact } from "../core/artifacts.js";
import { Forge } from "../core/engine.js";
import { listProjectProcesses, memorySnapshot } from "../core/procs.js";
import { adoptProject } from "../product/adopt.js";
import { auditContrast, auditDrift } from "../design/audit.js";
import { buildDesign, loadTokens } from "../design/tokens.js";
import { buildPrototype } from "../design/prototype.js";
import { captureShots, readManifest, shotProblems, VIEWPORTS } from "../design/shots.js";
import { loadTasks, nextTasks, planWaves, taskBrief, updateTask } from "../build/tasks.js";
import { mergeTasks } from "../build/workers.js";
import { contractDrift, platformParity } from "../trace/drift.js";
import { qaCoverage, qaPlan } from "../qa/coverage.js";
import { writeWorkflow } from "../ship/ci.js";
import { deploy, deployPlan } from "../ship/deploy.js";
import { blockingHeaders, checkHeaders } from "../security/headers.js";
import { blocking, recordFindings, scanSecurity } from "../security/scan.js";
import { detectStacks, listPacks, loadPack, readLens, scaffoldPlan, stackCommands, useStacks } from "../build/stacks.js";
import { checkProduct, listPageAudits, loadProductMap, savePageAudit, syncProduct } from "../product/sync.js";
import { scoreValidation, validationTemplate } from "../core/validation.js";
import { SOURCES, searchEvidence } from "../evidence/connectors.js";
import { loadEvidence, saveEvidence } from "../evidence/store.js";
import { ValidationCriterion } from "../schemas/artifacts.js";
import { appendLedger, readLedger } from "../core/ledger.js";
import { errorMessage } from "../core/util.js";
import { LedgerKind } from "../schemas/runtime.js";
import { saveEpisode } from "../memory/episodes.js";
import { graphExplain, graphPathBetween, graphStatus, graphUpdate } from "../memory/graphify.js";
import { addLearning } from "../memory/learnings.js";
import { queryMemory } from "../memory/query.js";
import { computeGaps, linkTrace } from "../trace/trace.js";
import { VERSION } from "../version.js";
const INSTRUCTIONS = `forge runs a gated product pipeline: brainstorm → vision → validate → spec → design → (motion) → architect → plan → build → verify → gap → ship → (launch) → learn.

Protocol:
1. Call forge_status first. Work on the stage it reports as next; call stage_start before working on it. Read the playbook for that stage with the guide tool (e.g. guide skills/validate-idea) and follow it; rubrics/* are the quality checks.
2. Write every stage output with artifact_write — it validates against the schema and rejects bad data.
3. Call stage_complete to run the gate. A stage is done only when its gate passes. Never claim a stage is complete otherwise; report the failing checks and fix them.
4. Human checkpoints: when a gate waits for approval, show the user a short decision memo and let them run \`forge approve <stage>\` (or call stage_approve only after the user explicitly approves).
5. Memory: call memory_query before re-deriving past decisions. Record decisions with ledger_add (include why and rejected alternatives). Save memory_save_episode before the session ends.
6. Never fabricate evidence, data, keys or results. Research with evidence_search (or your own web search), then save every quote you will cite with evidence_save — forge checks the quote against the source and rejects mismatches. Cite only saved evidence. Unknown research answers stay "unknown"; missing credentials become blockers (blocker_add). Start validation from validation_template and compute the score with validation_score.
7. Existing products (brownfield): product_adopt once, then product_sync after code changes — the understand gate fails on a stale map. Read product_map and the product model before changing anything; audit pages with skills/pro-page-complete and record them with page_audit_write.
8. Protect the machine's RAM: call process_snapshot before starting any server, watcher, test runner or browser and reuse what is already running; prefer one-shot commands to watch mode; run one heavy job at a time; stop every process you start (and its children) as soon as it is no longer needed, and verify it exited before you finish. Never kill processes you did not start.
9. Stacks: in the architect stage call stack_list, then stack_use to record the stacks and their gate commands (only commands the repo can actually run are filled). Builders follow the stack's Conventions (included in task_brief); reviewers check the stack's Review lens from stack_info.
10. Reviews: code review follows guide skills/code-review; security review follows guide skills/security-review — run security_scan (record=true) and, with the app running, security_headers; triage every finding with evidence. The verify gate re-runs the scan and the header check.`;
function text(value) {
    return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
function guarded(handler) {
    return async (args) => {
        try {
            return text(await handler(args));
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
        }
    };
}
const artifactName = z.enum(Object.keys(ARTIFACTS));
/** The installed forge package (dist/mcp/server.js and src/mcp/server.ts are both two levels down). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUIDE_KINDS = ["skills", "rubrics", "rules"];
function summarizeSync(result) {
    const pages = result.map.surfaces.filter((s) => s.kind === "page").length;
    return {
        frameworks: result.map.frameworks,
        pages,
        endpoints: result.map.surfaces.length - pages,
        calls: result.map.calls.length,
        docs: result.map.docs.length,
        graph: result.map.graph,
        diff: result.diff,
        staleFeatures: result.staleFeatures,
    };
}
export function listGuides() {
    return GUIDE_KINDS.flatMap((kind) => {
        const dir = join(PACKAGE_ROOT, kind);
        if (!existsSync(dir))
            return [];
        return kind === "skills"
            ? readdirSync(dir).filter((id) => existsSync(join(dir, id, "SKILL.md"))).map((id) => `skills/${id}`)
            : readdirSync(dir).filter((file) => file.endsWith(".md")).map((file) => `${kind}/${file.slice(0, -3)}`);
    });
}
export function readGuide(name) {
    const [kind, id] = name.replace(/\.md$/, "").replace(/\/SKILL$/, "").split("/");
    if (!kind || !id || !GUIDE_KINDS.includes(kind) || !/^[a-z0-9-]+$/.test(id)) {
        throw new Error(`Unknown guide "${name}". Available: ${listGuides().join(", ")}`);
    }
    const file = kind === "skills" ? join(PACKAGE_ROOT, "skills", id, "SKILL.md") : join(PACKAGE_ROOT, kind, `${id}.md`);
    if (!existsSync(file))
        throw new Error(`Unknown guide "${name}". Available: ${listGuides().join(", ")}`);
    return readFileSync(file, "utf8");
}
export function createForgeServer(root) {
    const server = new McpServer({ name: "forge", version: VERSION }, { instructions: INSTRUCTIONS });
    // A fresh Forge per call: state lives on disk and may change between calls.
    const forge = () => new Forge(root);
    const stage = z.string().describe("Stage id, e.g. validate");
    server.registerTool("project_init", {
        description: "Initialise forge in the project (creates forge.config.yaml and .forge/). Safe to call twice.",
        inputSchema: { name: z.string().optional().describe("Project name") },
    }, guarded(({ name }) => Forge.init(forge().root, { name })));
    server.registerTool("forge_status", { description: "Pipeline dashboard: every stage's status, the next stage and its command, blockers.", inputSchema: {} }, guarded(() => forge().status()));
    server.registerTool("stage_list", { description: "Enabled stages with their outputs and gate checks.", inputSchema: {} }, guarded(() => forge()
        .stages()
        .map((s) => ({ id: s.id, title: s.title, command: s.command, outputs: s.outputs, checkpoint: s.checkpoint, gate: s.gate.map((c) => `${c.id}: ${c.description}`) }))));
    server.registerTool("stage_start", {
        description: "Start a stage. Fails if earlier stages are unfinished unless force=true (recorded in the ledger).",
        inputSchema: { stage, force: z.boolean().optional() },
    }, guarded(({ stage: id, force }) => forge().start(id, { force })));
    server.registerTool("stage_complete", {
        description: "Run the stage gate. Returns every check's result; the stage passes only if none fail.",
        inputSchema: { stage },
    }, guarded(({ stage: id }) => forge().complete(id)));
    server.registerTool("stage_skip", { description: "Skip a stage with a reason (recorded).", inputSchema: { stage, reason: z.string().min(1) } }, guarded(({ stage: id, reason }) => forge().skip(id, reason, "agent")));
    server.registerTool("stage_override", {
        description: "Pass a stage despite a failing gate. Only on explicit user instruction; the reason is recorded.",
        inputSchema: { stage, reason: z.string().min(1) },
    }, guarded(({ stage: id, reason }) => forge().override(id, reason, "agent")));
    server.registerTool("stage_approve", {
        description: "Record human approval for a checkpoint stage. Call only after the user explicitly approves.",
        inputSchema: { stage, note: z.string().optional() },
    }, guarded(({ stage: id, note }) => {
        forge().approve(id, "user (via agent)", note);
        return `Approved ${id}`;
    }));
    server.registerTool("stage_reopen", {
        description: "Reopen a stage (cascade=true also reopens every later stage).",
        inputSchema: { stage, reason: z.string().min(1), cascade: z.boolean().optional() },
    }, guarded(({ stage: id, reason, cascade }) => forge().reopen(id, reason, { cascade })));
    server.registerTool("artifact_list", { description: "Every artifact: path, whether it exists and whether it is valid.", inputSchema: {} }, guarded(() => listArtifacts(forge().root)));
    server.registerTool("artifact_read", { description: "Read an artifact (JSON artifacts are returned with schema defaults applied).", inputSchema: { name: artifactName } }, guarded(({ name }) => {
        const root = forge().root;
        const def = ARTIFACTS[name];
        const value = def?.format === "text" ? readArtifactText(root, name) : loadArtifact(root, name);
        return value ?? `${def?.path ?? name} does not exist yet`;
    }));
    server.registerTool("artifact_write", {
        description: "Validate and write an artifact. JSON artifacts take an object (or JSON string); text artifacts take a string.",
        inputSchema: { name: artifactName, data: z.any().describe("Artifact content") },
    }, guarded(({ name, data }) => writeArtifact(forge().root, name, data)));
    server.registerTool("ledger_add", {
        description: "Record a decision in the append-only ledger. Include why and rejected alternatives.",
        inputSchema: {
            summary: z.string().min(1),
            why: z.string().optional(),
            rejected: z.array(z.string()).optional(),
            stage: z.string().optional(),
            kind: LedgerKind.optional(),
            links: z.array(z.string()).optional(),
        },
    }, guarded((args) => appendLedger(forge().root, { ...args, kind: args.kind ?? "decision", by: "agent" })));
    server.registerTool("ledger_list", { description: "Most recent ledger entries.", inputSchema: { limit: z.number().int().positive().optional() } }, guarded(({ limit }) => readLedger(forge().root).slice(-(limit ?? 30))));
    server.registerTool("memory_query", {
        description: "Ask forge memory (state, ledger, artifacts, episodes, learnings, gaps, graphify code graph). Returns cited hits.",
        inputSchema: { question: z.string().min(1), budget: z.number().int().positive().optional().describe("Token budget (default 1500)") },
    }, guarded(async ({ question, budget }) => {
        const answer = await queryMemory(forge().root, question, { budgetTokens: budget });
        return { intent: answer.intent, graph: answer.graph?.error ? `graphify: ${answer.graph.error}` : undefined, answer: answer.text };
    }));
    server.registerTool("memory_save_episode", {
        description: "Save a session summary so the next session (in any tool) can resume.",
        inputSchema: {
            goal: z.string().min(1),
            done: z.array(z.string()).optional(),
            decisions: z.array(z.string()).optional(),
            openThreads: z.array(z.string()).optional(),
            next: z.string().optional(),
            stage: z.string().optional(),
        },
    }, guarded((args) => saveEpisode(forge().root, args)));
    server.registerTool("memory_add_learning", {
        description: "Record a lesson (e.g. a gate that keeps failing for the same reason). scope=global applies across projects.",
        inputSchema: { text: z.string().min(1), source: z.string().optional(), scope: z.enum(["project", "global"]).optional() },
    }, guarded(({ text: lesson, source, scope }) => addLearning(forge().root, lesson, { source, scope })));
    server.registerTool("blocker_add", {
        description: "Record a blocker — a missing key, account, asset or decision. Use instead of faking the dependency.",
        inputSchema: { need: z.string().min(1), stage: z.string().optional() },
    }, guarded(({ need, stage: id }) => forge().addBlocker(need, id)));
    server.registerTool("blocker_resolve", { description: "Resolve a blocker by id (B-n).", inputSchema: { id: z.string(), note: z.string().optional() } }, guarded(({ id, note }) => forge().resolveBlocker(id, note)));
    server.registerTool("trace_link", {
        description: "Link two traceability nodes, e.g. story:S-4 → test:e2e/checkin.spec.ts (verifiedBy).",
        inputSchema: {
            from: z.string().describe("<type>:<name>"),
            to: z.string().describe("<type>:<name>"),
            type: z.enum(["designedBy", "animatedBy", "implementedBy", "calls", "verifiedBy", "releasedIn", "uses"]),
        },
    }, guarded(({ from, to, type }) => {
        const trace = linkTrace(forge().root, from, to, type);
        return `Linked ${from} → ${to} (${type}); trace has ${trace.nodes.length} nodes, ${trace.edges.length} edges`;
    }));
    server.registerTool("trace_gaps", { description: "Traceability gaps: MVP stories missing design, implementation or test links.", inputSchema: {} }, guarded(() => computeGaps(forge().root)));
    server.registerTool("graph_status", { description: "Whether graphify is installed and a code graph exists.", inputSchema: {} }, guarded(() => graphStatus(forge().root)));
    server.registerTool("graph_update", { description: "Incrementally refresh the graphify code graph (no LLM needed).", inputSchema: {} }, guarded(() => graphUpdate(forge().root)));
    server.registerTool("graph_path", { description: "Shortest path between two code-graph nodes.", inputSchema: { from: z.string(), to: z.string() } }, guarded(({ from, to }) => graphPathBetween(forge().root, from, to)));
    server.registerTool("graph_explain", { description: "Plain-language explanation of a code-graph node and its neighbours.", inputSchema: { node: z.string() } }, guarded(({ node }) => graphExplain(forge().root, node)));
    server.registerTool("guide", {
        description: "Read forge's playbooks: skills (how to run a stage, e.g. skills/validate-idea), rubrics (quality checks, e.g. rubrics/validation) and rules. Call without a name to list them. Follow the skill for the stage you are working on.",
        inputSchema: { name: z.string().optional().describe("e.g. skills/validate-idea, rubrics/prd, rules/no-fake-data, skills/security-review") },
    }, guarded(({ name }) => (name ? readGuide(name) : listGuides())));
    server.registerTool("evidence_search", {
        description: "Search a public source for real-world evidence (pain, competitors, demand). Sources: hackernews, github, npm, appstore, reddit. Results carry URL + text; quotes saved from them verify without refetching. Cached 24h.",
        inputSchema: {
            source: z.enum(SOURCES),
            query: z.string().min(1),
            limit: z.number().int().min(1).max(30).optional(),
            fresh: z.boolean().optional().describe("Bypass the 24h cache"),
        },
    }, guarded(({ source, query, limit, fresh }) => searchEvidence(forge().root, source, query, { limit, fresh })));
    server.registerTool("evidence_save", {
        description: "Save a quote as evidence. forge checks that the quote appears in the search result or on the page (use … between fragments). Mismatched quotes are rejected; pages that cannot be fetched are stored as unverifiable. Cite only saved evidence in artifacts.",
        inputSchema: {
            url: z.string().min(1),
            quote: z.string().min(8).describe("The source's exact words"),
            source: z.string().optional(),
            title: z.string().optional(),
            query: z.string().optional(),
        },
    }, guarded((args) => saveEvidence(forge().root, { ...args, savedBy: "agent" })));
    server.registerTool("evidence_list", { description: "All saved evidence with its verification status.", inputSchema: {} }, guarded(() => loadEvidence(forge().root)));
    server.registerTool("validation_template", {
        description: "The standard 12-criteria validation scorecard for an idea (all answers unknown). Fill answers with saved evidence, then write it with artifact_write.",
        inputSchema: { idea: z.string().min(1) },
    }, guarded(({ idea }) => validationTemplate(idea)));
    server.registerTool("validation_score", {
        description: "Compute the weighted score for scorecard criteria (defaults to the saved validation artifact) and a suggested verdict. The score in the artifact must match this.",
        inputSchema: { criteria: z.array(z.any()).optional() },
    }, guarded(({ criteria }) => {
        const root = forge().root;
        const parsed = criteria
            ? z.array(ValidationCriterion).parse(criteria)
            : (loadArtifact(root, "validation")?.criteria ?? (() => { throw new Error("No criteria given and no validation artifact yet"); })());
        return scoreValidation(parsed, forge().config().gates.validate.minScore);
    }));
    server.registerTool("product_adopt", {
        description: "Bring forge into an existing product: init if needed, enable the understand stage, skip greenfield-only stages, and build the product map + graphify code graph.",
        inputSchema: { name: z.string().optional(), graph: z.boolean().optional().describe("Refresh the graphify code graph (default true)") },
    }, guarded(async ({ name, graph }) => {
        const result = await adoptProject(forge().root, { name, graph });
        return { root: result.root, skipped: result.skipped, ...summarizeSync(result.sync) };
    }));
    server.registerTool("product_sync", {
        description: "Re-scan the code: refresh the product map (pages, endpoints, calls, docs), the graphify code graph and the trace links. Reports added/removed surfaces and product-model features that reference removed code.",
        inputSchema: { graph: z.boolean().optional().describe("Refresh the graphify code graph (default true)") },
    }, guarded(async ({ graph }) => summarizeSync(await syncProduct(forge().root, { graph }))));
    server.registerTool("product_map", {
        description: "What forge knows about the product's code: pages and endpoints (with files and graphify nodes), client→endpoint calls, docs, and whether the map is stale.",
        inputSchema: { kind: z.enum(["page", "endpoint"]).optional(), match: z.string().optional().describe("Filter surfaces whose id or file contains this text") },
    }, guarded(({ kind, match }) => {
        const root = forge().root;
        const map = loadProductMap(root);
        if (!map)
            throw new Error("No product map yet — call product_adopt (or product_sync)");
        const surfaces = map.surfaces.filter((s) => (!kind || s.kind === kind) && (!match || `${s.id} ${s.file}`.includes(match)));
        return { check: checkProduct(root), frameworks: map.frameworks, graph: map.graph, surfaces, calls: map.calls.filter((c) => !match || `${c.from} ${c.to}`.includes(match)), docs: map.docs };
    }));
    server.registerTool("page_audit_write", {
        description: "Record a pro-page-complete audit for one page (job, every atom with status/break/fix/must, connections, ideas, robustness, proof). The gap gate fails while audited pages have open must-fix atoms.",
        inputSchema: { slug: z.string().describe("e.g. settings-billing"), data: z.any() },
    }, guarded(({ slug, data }) => savePageAudit(forge().root, slug, data)));
    server.registerTool("page_audit_list", { description: "All page audits with their open must-fix atoms.", inputSchema: {} }, guarded(() => listPageAudits(forge().root)));
    server.registerTool("task_waves", { description: "The task DAG as parallel waves (dependencies + file conflicts), with each task's status.", inputSchema: {} }, guarded(() => {
        const tasks = loadTasks(forge().root);
        return planWaves(tasks).map((wave) => wave.map((id) => ({ id, status: tasks.find((t) => t.id === id)?.status })));
    }));
    server.registerTool("task_next", { description: "Tasks that can start now (todo, dependencies done), from the earliest wave. Dispatch these in parallel — at most workers.maxConcurrent at once.", inputSchema: {} }, guarded(() => nextTasks(loadTasks(forge().root))));
    server.registerTool("task_brief", {
        description: "Self-contained brief for one task: acceptance, linked stories with Given/When/Then, screens, motion specs, API contract, related decisions, learnings and rules. Give it to the builder (subagent or worker) verbatim.",
        inputSchema: { id: z.string() },
    }, guarded(({ id }) => taskBrief(forge().root, id)));
    server.registerTool("task_update", { description: "Set a task's status (todo | doing | done | blocked) with an optional note; recorded in the ledger.", inputSchema: { id: z.string(), status: z.enum(["todo", "doing", "done", "blocked"]), note: z.string().optional() } }, guarded(({ id, status, note }) => updateTask(forge().root, id, status, note)));
    server.registerTool("task_merge", {
        description: "Merge done task worktrees back in wave order: commit leftovers on the task branch, run commands.test in the worktree, merge --no-ff only if green, abort cleanly on conflict (task → blocked), then remove the worktree.",
        inputSchema: { ids: z.array(z.string()).optional() },
    }, guarded(({ ids }) => mergeTasks(forge().root, forge().config(), ids)));
    server.registerTool("contract_drift", { description: "Compare contracts/openapi.yaml with the endpoints the code actually serves (Next.js route handlers, Express/Fastify/Hono, FastAPI/Flask, SvelteKit, node:http): operations missing from the code, endpoints missing from the contract, and matches made under a router prefix. The gap gate fails on any drift.", inputSchema: {} }, guarded(() => contractDrift(forge().root)));
    server.registerTool("platform_parity", { description: "When the project targets web and mobile (forge.config.yaml platforms), list MVP stories without screens on every platform. Deliberate single-platform stories go in gates.gap.parityExempt.", inputSchema: {} }, guarded(() => platformParity(forge().root)));
    server.registerTool("qa_plan", { description: "QA plan: one test case per MVP acceptance criterion, id S-1/AC1, with the tool (Playwright for web screens, Maestro for mobile, API tests otherwise) and a suggested file. Tests claim a case by putting @S-1/AC1 in the test title, a Maestro tags entry or a comment.", inputSchema: {} }, guarded(() => qaPlan(forge().root)));
    server.registerTool("qa_coverage", {
        description: "Which acceptance criteria have a tagged test on disk, which are missing (with the suggested file), and tags that match nothing. link=true adds story → test verifiedBy trace links. The verify gate requires gates.qa.minCoverage (default 100%).",
        inputSchema: { link: z.boolean().optional() },
    }, guarded(({ link }) => qaCoverage(forge().root, { link })));
    server.registerTool("ci_generate", { description: "Write .github/workflows/forge.yml from the configured stacks: one job per stack installing from its lockfile and running the same build/lint/test/audit/e2e commands as the gates, plus forge's security scan. Keeps an existing different file unless force.", inputSchema: { force: z.boolean().optional() } }, guarded(({ force }) => writeWorkflow(forge().root, { force })));
    server.registerTool("deploy_plan", { description: "Deploy targets per configured stack (Vercel, Fly.io, EAS, Supabase) with the exact command and everything missing (CLI not installed, project not linked) with its fix. Read-only.", inputSchema: { env: z.enum(["preview", "production"]).optional() } }, guarded(({ env }) => deployPlan(forge().root, env ?? "preview")));
    server.registerTool("deploy", {
        description: "Deploy with the official CLIs (checks login first; missing login/link → blocked with the fix, never faked), then smoke-test the URL, probe its security headers and run commands.e2e against it, and write the release artifact + notes from those real checks. Defaults to preview; production requires the user's `forge approve ship`. Outward-facing: only call when the user asked to deploy.",
        inputSchema: { env: z.enum(["preview", "production"]).optional(), only: z.array(z.string()).optional() },
    }, guarded(({ env, only }) => deploy(forge().root, { env: env ?? "preview", only })));
    server.registerTool("security_scan", {
        description: "Deterministic security scan of the repo: code/SQL/NoSQL/shell/template injection, XSS sinks, path traversal, SSRF, open redirects, header injection, unsafe deserialization, disabled TLS verification, CORS with credentials, insecure cookies/randomness, committed secrets and env files. Each finding has file:line, CWE and a fix. record=true files new findings in the reviews artifact. The verify gate re-runs this scan; suppress only with an inline `forge-security-ignore <rule> -- <reason>` comment.",
        inputSchema: { record: z.boolean().optional().describe("Add new findings to the reviews artifact") },
    }, guarded(({ record }) => {
        const f = forge();
        const { failOn, ignore } = f.config().security;
        const result = scanSecurity(f.root, { ignore });
        return { ...result, failOn, blocking: blocking(result, failOn).length, ...(record ? { recorded: recordFindings(f.root, result) } : {}) };
    }));
    server.registerTool("security_headers", {
        description: "Live check of a running app (local dev server or preview URL): Content-Security-Policy strength, HSTS, clickjacking protection, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, Set-Cookie flags (HttpOnly/Secure/SameSite), CORS with a foreign probe Origin (reflection, credentials) and X-Powered-By/Server leaks. Start the app first and stop it afterwards.",
        inputSchema: { url: z.string().optional().describe("Defaults to security.url in forge.config.yaml") },
    }, guarded(async ({ url }) => {
        const f = forge();
        const { failOn, url: configured } = f.config().security;
        const target = url ?? configured;
        if (!target)
            throw new Error("Pass url, or set security.url in forge.config.yaml");
        const report = await checkHeaders(target);
        return { ...report, failOn, blocking: blockingHeaders(report, failOn).length };
    }));
    server.registerTool("stack_list", {
        description: "Stack packs (nextjs, expo, fastapi, node-hono, supabase, plus project packs in .forge/stack-packs), the stacks detected in this repo with the gate commands each could run (and how to enable the missing ones), and the stacks configured in forge.config.yaml.",
        inputSchema: {},
    }, guarded(() => {
        const f = forge();
        return {
            packs: listPacks(f.root).map(({ pack, source }) => ({ id: pack.id, name: pack.name, kind: pack.kind, platforms: pack.platforms, depts: pack.depts, source })),
            detected: detectStacks(f.root).map((d) => ({ ...d, ...stackCommands(f.root, d.pack, d.dir) })),
            configured: f.config().stacks,
        };
    }));
    server.registerTool("stack_use", {
        description: "Record the project's stacks in forge.config.yaml (detected ones, or the named pack in dir) and fill empty build/test/e2e/lint gate commands — only with commands whose scripts/dependencies/files exist. Existing commands are kept unless force. Recorded as a decision in the ledger. Use in the architect stage, and again after scaffolding or adding test tooling.",
        inputSchema: {
            pack: z.string().optional().describe("Pack id; omit to use every detected stack"),
            dir: z.string().optional().describe("Directory of that stack, relative to the project root"),
            force: z.boolean().optional().describe("Replace commands that are already configured"),
        },
    }, guarded(({ pack, dir, force }) => useStacks(forge().root, { pack, dir, force })));
    server.registerTool("stack_info", {
        description: "One stack pack: manifest (layout, QA tool, token output), the official scaffold command for this project (run it with your shell, then call stack_use), and the conventions + review lens markdown. Builders follow the Conventions; reviewers check every Review lens item.",
        inputSchema: { pack: z.string(), dir: z.string().optional().describe("Target directory for the scaffold command") },
    }, guarded(({ pack, dir }) => {
        const root = forge().root;
        const loaded = loadPack(pack, root);
        return { ...loaded.pack, source: loaded.source, scaffold: scaffoldPlan(root, pack, { dir }), lens: readLens(pack, root) };
    }));
    server.registerTool("design_build", {
        description: "Build design/tokens (W3C DTCG, themes via *.<theme>.tokens.json) into design/dist: tokens.css (light/dark + prefers-color-scheme), tailwind.css (@theme), theme.ts (typed, incl. springs), tokens.json, tokens.dart (Flutter), ForgeTokens.swift (SwiftUI), ForgeTokens.kt (Compose). Fails on unresolved aliases or invalid types.",
        inputSchema: {},
    }, guarded(() => buildDesign(forge().root)));
    server.registerTool("design_prototype", {
        description: "Generate design/prototype/index.html from the screens artifact: one dependency-free page per screen with an empty/loading/error/success state switcher, styled by the generated tokens. Fill each state; screenshot ?screen=<id>&state=<state> for critique.",
        inputSchema: { force: z.boolean().optional().describe("Regenerate even though a prototype exists (discards designed states)") },
    }, guarded(({ force }) => buildPrototype(forge().root, { force })));
    server.registerTool("design_shots", {
        description: "Screenshot every screen × state × viewport of design/prototype (360/768/1280 px for web, 390 px for mobile apps) — or of a running app's routes with url — using a local headless Chromium, one short process at a time. Returns the manifest (files, blank renders, % changed since the last shots) and what the design gate still needs. Then look at the images (design_shot) and score the rubric.",
        inputSchema: {
            url: z.string().optional().describe("Base URL of a running app; omit to shoot the prototype"),
            viewports: z.array(z.enum(Object.keys(VIEWPORTS))).optional(),
            screens: z.array(z.string()).optional(),
        },
    }, guarded(async ({ url, viewports, screens }) => {
        const root = forge().root;
        const manifest = await captureShots(root, { url, viewports, screens });
        return { ...manifest, gateProblems: manifest.source === "prototype" ? shotProblems(root) : [] };
    }));
    server.registerTool("design_shot", {
        description: "One screenshot from the latest design_shots run, returned as an image so you can critique it: screen id, state (empty/loading/error/success, or rendered for url shots) and viewport.",
        inputSchema: { screen: z.string(), state: z.string().optional(), viewport: z.enum(Object.keys(VIEWPORTS)).optional() },
    }, async ({ screen, state, viewport }) => {
        try {
            const root = forge().root;
            const shot = readManifest(root)?.shots.find((s) => s.screen === screen && (!state || s.state === state) && (!viewport || s.viewport === viewport) && !s.error);
            if (!shot)
                throw new Error(`No screenshot for ${screen}${state ? `/${state}` : ""}${viewport ? `@${viewport}` : ""} — run design_shots first`);
            const data = readFileSync(join(root, shot.file)).toString("base64");
            return {
                content: [
                    { type: "text", text: `${shot.file} (${shot.width ?? "?"}×${shot.height ?? "?"}${shot.blank ? ", BLANK" : ""})` },
                    { type: "image", data, mimeType: "image/png" },
                ],
            };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
        }
    });
    server.registerTool("design_audit", {
        description: "Audit the design system: token validity, WCAG contrast for the pairs in design/contrast.json (every theme), and hard-coded colours in product code (drift) with the token to use instead.",
        inputSchema: {},
    }, guarded(() => {
        const root = forge().root;
        const set = loadTokens(root);
        return {
            tokens: { count: set.base.size, themes: Object.keys(set.themes), errors: set.errors, warnings: set.warnings },
            contrast: auditContrast(root),
            drift: auditDrift(root, forge().config().gates.gap.scanDirs),
        };
    }));
    server.registerTool("process_snapshot", {
        description: "Read-only: processes that belong to this project (cwd inside it, command naming it, or their children) with RSS memory, plus machine memory headroom. Use before starting servers/watchers/test runners and before finishing, to reuse and clean up.",
        inputSchema: {},
    }, guarded(() => {
        const processes = listProjectProcesses(forge().root);
        const rssMb = processes.reduce((sum, p) => sum + p.rssKb, 0) / 1024;
        return { memory: memorySnapshot(), totalRssMb: Math.round(rssMb), processes };
    }));
    return server;
}
/**
 * Serve over stdio and never outlive the host: exit when stdin closes (host
 * disconnected), on SIGINT/SIGTERM/SIGHUP, or if the parent process disappears
 * without closing the pipe — so abandoned MCP servers cannot pile up in RAM.
 */
export async function startStdioServer(root) {
    const server = createForgeServer(root);
    let stopping = false;
    const shutdown = () => {
        if (stopping)
            return;
        stopping = true;
        void server.close().finally(() => process.exit(0));
        setTimeout(() => process.exit(0), 1_000).unref();
    };
    process.stdin.on("end", shutdown);
    process.stdin.on("close", shutdown);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
        process.once(signal, shutdown);
    const parent = process.ppid;
    setInterval(() => {
        if (process.ppid !== parent)
            shutdown(); // re-parented: the host died
    }, 5_000).unref();
    await server.connect(new StdioServerTransport());
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ARTIFACTS, listArtifacts, loadArtifact, readArtifactText, writeArtifact } from "../core/artifacts.js";
import { Forge } from "../core/engine.js";
import { listProjectProcesses, memorySnapshot } from "../core/procs.js";
import { scoreValidation, validationTemplate } from "../core/validation.js";
import { SOURCES, searchEvidence } from "../evidence/connectors.js";
import { loadEvidence, saveEvidence } from "../evidence/store.js";
import { ValidationCriterion, type Validation } from "../schemas/artifacts.js";
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
7. Protect the machine's RAM: call process_snapshot before starting any server, watcher, test runner or browser and reuse what is already running; prefer one-shot commands to watch mode; run one heavy job at a time; stop every process you start (and its children) as soon as it is no longer needed, and verify it exited before you finish. Never kill processes you did not start.`;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function guarded<A>(handler: (args: A) => unknown): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return text(await handler(args));
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

const artifactName = z.enum(Object.keys(ARTIFACTS) as [string, ...string[]]);

/** The installed forge package (dist/mcp/server.js and src/mcp/server.ts are both two levels down). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUIDE_KINDS = ["skills", "rubrics", "rules"] as const;

export function listGuides(): string[] {
  return GUIDE_KINDS.flatMap((kind) => {
    const dir = join(PACKAGE_ROOT, kind);
    if (!existsSync(dir)) return [];
    return kind === "skills"
      ? readdirSync(dir).filter((id) => existsSync(join(dir, id, "SKILL.md"))).map((id) => `skills/${id}`)
      : readdirSync(dir).filter((file) => file.endsWith(".md")).map((file) => `${kind}/${file.slice(0, -3)}`);
  });
}

export function readGuide(name: string): string {
  const [kind, id] = name.replace(/\.md$/, "").replace(/\/SKILL$/, "").split("/");
  if (!kind || !id || !(GUIDE_KINDS as readonly string[]).includes(kind) || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`Unknown guide "${name}". Available: ${listGuides().join(", ")}`);
  }
  const file = kind === "skills" ? join(PACKAGE_ROOT, "skills", id, "SKILL.md") : join(PACKAGE_ROOT, kind, `${id}.md`);
  if (!existsSync(file)) throw new Error(`Unknown guide "${name}". Available: ${listGuides().join(", ")}`);
  return readFileSync(file, "utf8");
}

export function createForgeServer(root?: string): McpServer {
  const server = new McpServer({ name: "forge", version: VERSION }, { instructions: INSTRUCTIONS });
  // A fresh Forge per call: state lives on disk and may change between calls.
  const forge = () => new Forge(root);
  const stage = z.string().describe("Stage id, e.g. validate");

  server.registerTool(
    "project_init",
    {
      description: "Initialise forge in the project (creates forge.config.yaml and .forge/). Safe to call twice.",
      inputSchema: { name: z.string().optional().describe("Project name") },
    },
    guarded(({ name }: { name?: string }) => Forge.init(forge().root, { name })),
  );

  server.registerTool(
    "forge_status",
    { description: "Pipeline dashboard: every stage's status, the next stage and its command, blockers.", inputSchema: {} },
    guarded(() => forge().status()),
  );

  server.registerTool(
    "stage_list",
    { description: "Enabled stages with their outputs and gate checks.", inputSchema: {} },
    guarded(() =>
      forge()
        .stages()
        .map((s) => ({ id: s.id, title: s.title, command: s.command, outputs: s.outputs, checkpoint: s.checkpoint, gate: s.gate.map((c) => `${c.id}: ${c.description}`) })),
    ),
  );

  server.registerTool(
    "stage_start",
    {
      description: "Start a stage. Fails if earlier stages are unfinished unless force=true (recorded in the ledger).",
      inputSchema: { stage, force: z.boolean().optional() },
    },
    guarded(({ stage: id, force }: { stage: string; force?: boolean }) => forge().start(id, { force })),
  );

  server.registerTool(
    "stage_complete",
    {
      description: "Run the stage gate. Returns every check's result; the stage passes only if none fail.",
      inputSchema: { stage },
    },
    guarded(({ stage: id }: { stage: string }) => forge().complete(id)),
  );

  server.registerTool(
    "stage_skip",
    { description: "Skip a stage with a reason (recorded).", inputSchema: { stage, reason: z.string().min(1) } },
    guarded(({ stage: id, reason }: { stage: string; reason: string }) => forge().skip(id, reason, "agent")),
  );

  server.registerTool(
    "stage_override",
    {
      description: "Pass a stage despite a failing gate. Only on explicit user instruction; the reason is recorded.",
      inputSchema: { stage, reason: z.string().min(1) },
    },
    guarded(({ stage: id, reason }: { stage: string; reason: string }) => forge().override(id, reason, "agent")),
  );

  server.registerTool(
    "stage_approve",
    {
      description: "Record human approval for a checkpoint stage. Call only after the user explicitly approves.",
      inputSchema: { stage, note: z.string().optional() },
    },
    guarded(({ stage: id, note }: { stage: string; note?: string }) => {
      forge().approve(id, "user (via agent)", note);
      return `Approved ${id}`;
    }),
  );

  server.registerTool(
    "stage_reopen",
    {
      description: "Reopen a stage (cascade=true also reopens every later stage).",
      inputSchema: { stage, reason: z.string().min(1), cascade: z.boolean().optional() },
    },
    guarded(({ stage: id, reason, cascade }: { stage: string; reason: string; cascade?: boolean }) => forge().reopen(id, reason, { cascade })),
  );

  server.registerTool(
    "artifact_list",
    { description: "Every artifact: path, whether it exists and whether it is valid.", inputSchema: {} },
    guarded(() => listArtifacts(forge().root)),
  );

  server.registerTool(
    "artifact_read",
    { description: "Read an artifact (JSON artifacts are returned with schema defaults applied).", inputSchema: { name: artifactName } },
    guarded(({ name }: { name: string }) => {
      const root = forge().root;
      const def = ARTIFACTS[name];
      const value = def?.format === "text" ? readArtifactText(root, name) : loadArtifact(root, name);
      return value ?? `${def?.path ?? name} does not exist yet`;
    }),
  );

  server.registerTool(
    "artifact_write",
    {
      description: "Validate and write an artifact. JSON artifacts take an object (or JSON string); text artifacts take a string.",
      inputSchema: { name: artifactName, data: z.any().describe("Artifact content") },
    },
    guarded(({ name, data }: { name: string; data: unknown }) => writeArtifact(forge().root, name, data)),
  );

  server.registerTool(
    "ledger_add",
    {
      description: "Record a decision in the append-only ledger. Include why and rejected alternatives.",
      inputSchema: {
        summary: z.string().min(1),
        why: z.string().optional(),
        rejected: z.array(z.string()).optional(),
        stage: z.string().optional(),
        kind: LedgerKind.optional(),
        links: z.array(z.string()).optional(),
      },
    },
    guarded((args: { summary: string; why?: string; rejected?: string[]; stage?: string; kind?: z.infer<typeof LedgerKind>; links?: string[] }) =>
      appendLedger(forge().root, { ...args, kind: args.kind ?? "decision", by: "agent" }),
    ),
  );

  server.registerTool(
    "ledger_list",
    { description: "Most recent ledger entries.", inputSchema: { limit: z.number().int().positive().optional() } },
    guarded(({ limit }: { limit?: number }) => readLedger(forge().root).slice(-(limit ?? 30))),
  );

  server.registerTool(
    "memory_query",
    {
      description: "Ask forge memory (state, ledger, artifacts, episodes, learnings, gaps, graphify code graph). Returns cited hits.",
      inputSchema: { question: z.string().min(1), budget: z.number().int().positive().optional().describe("Token budget (default 1500)") },
    },
    guarded(async ({ question, budget }: { question: string; budget?: number }) => {
      const answer = await queryMemory(forge().root, question, { budgetTokens: budget });
      return { intent: answer.intent, graph: answer.graph?.error ? `graphify: ${answer.graph.error}` : undefined, answer: answer.text };
    }),
  );

  server.registerTool(
    "memory_save_episode",
    {
      description: "Save a session summary so the next session (in any tool) can resume.",
      inputSchema: {
        goal: z.string().min(1),
        done: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        openThreads: z.array(z.string()).optional(),
        next: z.string().optional(),
        stage: z.string().optional(),
      },
    },
    guarded((args: { goal: string; done?: string[]; decisions?: string[]; openThreads?: string[]; next?: string; stage?: string }) =>
      saveEpisode(forge().root, args),
    ),
  );

  server.registerTool(
    "memory_add_learning",
    {
      description: "Record a lesson (e.g. a gate that keeps failing for the same reason). scope=global applies across projects.",
      inputSchema: { text: z.string().min(1), source: z.string().optional(), scope: z.enum(["project", "global"]).optional() },
    },
    guarded(({ text: lesson, source, scope }: { text: string; source?: string; scope?: "project" | "global" }) =>
      addLearning(forge().root, lesson, { source, scope }),
    ),
  );

  server.registerTool(
    "blocker_add",
    {
      description: "Record a blocker — a missing key, account, asset or decision. Use instead of faking the dependency.",
      inputSchema: { need: z.string().min(1), stage: z.string().optional() },
    },
    guarded(({ need, stage: id }: { need: string; stage?: string }) => forge().addBlocker(need, id)),
  );

  server.registerTool(
    "blocker_resolve",
    { description: "Resolve a blocker by id (B-n).", inputSchema: { id: z.string(), note: z.string().optional() } },
    guarded(({ id, note }: { id: string; note?: string }) => forge().resolveBlocker(id, note)),
  );

  server.registerTool(
    "trace_link",
    {
      description: "Link two traceability nodes, e.g. story:S-4 → test:e2e/checkin.spec.ts (verifiedBy).",
      inputSchema: {
        from: z.string().describe("<type>:<name>"),
        to: z.string().describe("<type>:<name>"),
        type: z.enum(["designedBy", "animatedBy", "implementedBy", "calls", "verifiedBy", "releasedIn", "uses"]),
      },
    },
    guarded(({ from, to, type }: { from: string; to: string; type: string }) => {
      const trace = linkTrace(forge().root, from, to, type);
      return `Linked ${from} → ${to} (${type}); trace has ${trace.nodes.length} nodes, ${trace.edges.length} edges`;
    }),
  );

  server.registerTool(
    "trace_gaps",
    { description: "Traceability gaps: MVP stories missing design, implementation or test links.", inputSchema: {} },
    guarded(() => computeGaps(forge().root)),
  );

  server.registerTool(
    "graph_status",
    { description: "Whether graphify is installed and a code graph exists.", inputSchema: {} },
    guarded(() => graphStatus(forge().root)),
  );

  server.registerTool(
    "graph_update",
    { description: "Incrementally refresh the graphify code graph (no LLM needed).", inputSchema: {} },
    guarded(() => graphUpdate(forge().root)),
  );

  server.registerTool(
    "graph_path",
    { description: "Shortest path between two code-graph nodes.", inputSchema: { from: z.string(), to: z.string() } },
    guarded(({ from, to }: { from: string; to: string }) => graphPathBetween(forge().root, from, to)),
  );

  server.registerTool(
    "graph_explain",
    { description: "Plain-language explanation of a code-graph node and its neighbours.", inputSchema: { node: z.string() } },
    guarded(({ node }: { node: string }) => graphExplain(forge().root, node)),
  );

  server.registerTool(
    "guide",
    {
      description:
        "Read forge's playbooks: skills (how to run a stage, e.g. skills/validate-idea), rubrics (quality checks, e.g. rubrics/validation) and rules. Call without a name to list them. Follow the skill for the stage you are working on.",
      inputSchema: { name: z.string().optional().describe("e.g. skills/validate-idea, rubrics/prd, rules/no-fake-data") },
    },
    guarded(({ name }: { name?: string }) => (name ? readGuide(name) : listGuides())),
  );

  server.registerTool(
    "evidence_search",
    {
      description:
        "Search a public source for real-world evidence (pain, competitors, demand). Sources: hackernews, github, npm, appstore, reddit. Results carry URL + text; quotes saved from them verify without refetching. Cached 24h.",
      inputSchema: {
        source: z.enum(SOURCES),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(30).optional(),
        fresh: z.boolean().optional().describe("Bypass the 24h cache"),
      },
    },
    guarded(({ source, query, limit, fresh }: { source: string; query: string; limit?: number; fresh?: boolean }) =>
      searchEvidence(forge().root, source, query, { limit, fresh }),
    ),
  );

  server.registerTool(
    "evidence_save",
    {
      description:
        "Save a quote as evidence. forge checks that the quote appears in the search result or on the page (use … between fragments). Mismatched quotes are rejected; pages that cannot be fetched are stored as unverifiable. Cite only saved evidence in artifacts.",
      inputSchema: {
        url: z.string().min(1),
        quote: z.string().min(8).describe("The source's exact words"),
        source: z.string().optional(),
        title: z.string().optional(),
        query: z.string().optional(),
      },
    },
    guarded((args: { url: string; quote: string; source?: string; title?: string; query?: string }) =>
      saveEvidence(forge().root, { ...args, savedBy: "agent" }),
    ),
  );

  server.registerTool(
    "evidence_list",
    { description: "All saved evidence with its verification status.", inputSchema: {} },
    guarded(() => loadEvidence(forge().root)),
  );

  server.registerTool(
    "validation_template",
    {
      description: "The standard 12-criteria validation scorecard for an idea (all answers unknown). Fill answers with saved evidence, then write it with artifact_write.",
      inputSchema: { idea: z.string().min(1) },
    },
    guarded(({ idea }: { idea: string }) => validationTemplate(idea)),
  );

  server.registerTool(
    "validation_score",
    {
      description:
        "Compute the weighted score for scorecard criteria (defaults to the saved validation artifact) and a suggested verdict. The score in the artifact must match this.",
      inputSchema: { criteria: z.array(z.any()).optional() },
    },
    guarded(({ criteria }: { criteria?: unknown[] }) => {
      const root = forge().root;
      const parsed = criteria
        ? z.array(ValidationCriterion).parse(criteria)
        : (loadArtifact<Validation>(root, "validation")?.criteria ?? (() => { throw new Error("No criteria given and no validation artifact yet"); })());
      return scoreValidation(parsed, forge().config().gates.validate.minScore);
    }),
  );

  server.registerTool(
    "process_snapshot",
    {
      description:
        "Read-only: processes that belong to this project (cwd inside it, command naming it, or their children) with RSS memory, plus machine memory headroom. Use before starting servers/watchers/test runners and before finishing, to reuse and clean up.",
      inputSchema: {},
    },
    guarded(() => {
      const processes = listProjectProcesses(forge().root);
      const rssMb = processes.reduce((sum, p) => sum + p.rssKb, 0) / 1024;
      return { memory: memorySnapshot(), totalRssMb: Math.round(rssMb), processes };
    }),
  );

  return server;
}

/**
 * Serve over stdio and never outlive the host: exit when stdin closes (host
 * disconnected), on SIGINT/SIGTERM/SIGHUP, or if the parent process disappears
 * without closing the pipe — so abandoned MCP servers cannot pile up in RAM.
 */
export async function startStdioServer(root?: string): Promise<void> {
  const server = createForgeServer(root);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, shutdown);
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) shutdown(); // re-parented: the host died
  }, 5_000).unref();
  await server.connect(new StdioServerTransport());
}

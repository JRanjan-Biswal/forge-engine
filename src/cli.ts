#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ARTIFACTS, checkArtifact, listArtifacts, loadArtifact, readArtifactText, writeArtifact } from "./core/artifacts.js";
import { Forge } from "./core/engine.js";
import { gateChecks } from "./core/gates.js";
import { appendLedger, readLedger } from "./core/ledger.js";
import { findRoot } from "./core/paths.js";
import { listProjectProcesses, memorySnapshot, registryTemplate } from "./core/procs.js";
import { adoptProject } from "./product/adopt.js";
import { auditContrast, auditDrift } from "./design/audit.js";
import { buildDesign, loadTokens } from "./design/tokens.js";
import { buildPrototype } from "./design/prototype.js";
import { loadTasks, nextTasks, planWaves, taskBrief, updateTask } from "./build/tasks.js";
import { detectStacks, listPacks, loadPack, readLens, scaffoldPlan, scaffoldStack, stackCommands, useStacks } from "./build/stacks.js";
import { checkHeaders, blockingHeaders } from "./security/headers.js";
import { blocking, recordFindings, scanSecurity } from "./security/scan.js";
import { qaCoverage, qaPlan } from "./qa/coverage.js";
import { writeWorkflow } from "./ship/ci.js";
import { deploy, deployPlan, releaseNotes } from "./ship/deploy.js";
import { createWorktree, listWorktrees, mergeTasks, removeWorktree, runWorkers } from "./build/workers.js";
import { checkProduct, installGitHooks, listPageAudits, loadProductMap, syncProduct } from "./product/sync.js";
import { scoreValidation, validationTemplate } from "./core/validation.js";
import { searchEvidence } from "./evidence/connectors.js";
import { loadEvidence, saveEvidence } from "./evidence/store.js";
import { Validation, type Release } from "./schemas/artifacts.js";
import { errorMessage } from "./core/util.js";
import { saveEpisode, type EpisodeInput } from "./memory/episodes.js";
import { findGraphify, graphExplain, graphPathBetween, graphQuery, graphStatus, graphUpdate, GRAPHIFY_INSTALL_HINT } from "./memory/graphify.js";
import { addLearning } from "./memory/learnings.js";
import { queryMemory } from "./memory/query.js";
import { PUBLISHED_SCHEMAS } from "./schemas/index.js";
import type { GateResult, StageStatus } from "./schemas/runtime.js";
import { computeGaps, linkTrace } from "./trace/trace.js";
import { VERSION } from "./version.js";

const HELP = `forge ${VERSION} — idea → validated → designed → built → verified → shipped

Usage: forge <command> [options]

Project
  init [--name <n>] [--force]          create forge.config.yaml and .forge/ here
  status                               pipeline dashboard
  stages                               enabled stages and their gate checks
  doctor                               check node, memory, config, graphify and agent CLIs
  procs                                processes belonging to this project, with RSS memory
  procs init                           create an AGENT_PROCESSES.md process registry here

Stages
  start <stage> [--force]              begin a stage
  complete <stage>                     run the stage gate (alias: gate)
  approve <stage> [--note <text>]      record human approval for a checkpoint stage
  skip <stage> --reason <text>         skip a stage (recorded in the ledger)
  override <stage> --reason <text>     pass a stage despite its gate (recorded)
  reopen <stage> --reason <text> [--cascade]
  archive --reason <text>              archive the project (e.g. verdict = kill)
  block "<need>" [--stage <s>]         record a blocker instead of faking a dependency
  unblock <B-n> [--note <text>]

Artifacts
  artifact list
  artifact read <name>
  artifact write <name> [--file <path>]   (reads stdin when --file is omitted)
  artifact validate <name>

Existing products (brownfield)
  adopt [--name <n>] [--no-graph]      init + build the product map and code graph; adds the understand stage
  sync [--no-graph] [--quiet]          refresh product map, graphify graph and trace links from the code
  sync --check                         is the product map stale? (exit 1 when stale)
  product [pages|endpoints|calls|docs] what forge knows about the product
  pages [<slug>]                       pro-page-complete audits and open must-fix atoms
  hooks install                        git hooks that run "forge sync" after commit / merge / checkout

Build (Phase 4)
  tasks [waves|next]                   task DAG as parallel waves (deps + file conflicts) / runnable now
  tasks brief <id>                     everything one task needs: stories, acceptance, screens, motion, contract, decisions
  tasks update <id> --status <s>       todo | doing | done | blocked [--note <text>]
  worktree [list|create <id>|remove <id>] [--force]
  workers run [--host claude|codex|gemini|opencode] [--max <n>] [--tasks a,b]
                                       run ready tasks headless, one git worktree each (default max 1)
  merge [<id> …]                       merge done task worktrees in wave order: tests in the worktree, then --no-ff

Ship & QA
  qa plan                              one test case per MVP acceptance criterion (@S-1/AC1) with the tool and file to use
  qa coverage [--link]                 which criteria have a tagged test; --link adds story → test trace links
  ci [--force]                         write .github/workflows/forge.yml from the stacks' gate commands
  deploy --plan [--prod]               targets per stack (Vercel, Fly, EAS, Supabase) and what is missing
  deploy [--prod] [--only a,b]         deploy with the official CLIs, smoke-test, probe headers, run e2e on the URL,
                                       write the release + notes (--prod needs "forge approve ship")
  release notes                        release notes for the latest release

Security
  security scan [--record]             static scan: injection sinks, committed secrets, env files (exit 1 at security.failOn)
                                       --record files new findings into the reviews artifact
  security headers <url>               live check: CSP, HSTS, clickjacking, nosniff, cookies, CORS, info leaks

Stacks
  stack [list]                         stack packs, what this repo has, and what is configured
  stack detect                         stacks found here and the gate commands each could run
  stack use [<pack>] [--dir <d>] [--force]
                                       record stacks in forge.config.yaml and fill empty gate commands
  stack show <pack>                    a pack's manifest, conventions and review lens
  stack scaffold <pack> [--dir <d>] [--pm pnpm|npm|yarn|bun] [--run]
                                       the official generator command (runs it with --run, then "stack use")

Design
  design build                         design/tokens → design/dist (CSS, Tailwind, TS, JSON, Flutter, SwiftUI, Compose)
  design audit                         token validity, WCAG contrast pairs, hard-coded colour drift
  design prototype                     single-file prototype scaffold: every screen × state, on the tokens

Evidence & validation
  evidence search <source> "<query>" [--limit <n>] [--fresh]   sources: hackernews github npm appstore reddit
  evidence save --url <url> --quote "<exact words>" [--source <s>]   checked against the source
  evidence list
  validate template "<idea>"           standard 12-criteria scorecard (JSON)
  validate score [--file <json>]       weighted score + suggested verdict (default: the validation artifact)

Memory
  ledger list [--limit <n>]
  ledger add --summary <text> [--why <text>] [--rejected <a,b>] [--stage <s>]
  memory query "<question>" [--budget <tokens>] [--no-graph]
  memory episode --file <episode.json>
  memory learn "<text>" [--source <s>] [--global]

Traceability & code graph
  trace link <from> <to> <type>        e.g. trace link story:S-4 test:e2e/checkin.spec.ts verifiedBy
  gaps                                 MVP stories missing design / code / test links
  graph status | update | query "<q>" | path <a> <b> | explain <node>

Integration
  mcp                                  run the forge MCP server on stdio
  schemas export [--out <dir>]         write JSON Schemas for every artifact

Global options: --json (machine-readable output), --root <dir> (target another project)`;

const OPTIONS = {
  json: { type: "boolean" },
  force: { type: "boolean" },
  cascade: { type: "boolean" },
  global: { type: "boolean" },
  "no-graph": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  name: { type: "string" },
  reason: { type: "string" },
  note: { type: "string" },
  file: { type: "string" },
  limit: { type: "string" },
  summary: { type: "string" },
  why: { type: "string" },
  rejected: { type: "string" },
  stage: { type: "string" },
  budget: { type: "string" },
  source: { type: "string" },
  out: { type: "string" },
  root: { type: "string" },
  url: { type: "string" },
  quote: { type: "string" },
  fresh: { type: "boolean" },
  status: { type: "string" },
  host: { type: "string" },
  max: { type: "string" },
  tasks: { type: "string" },
  check: { type: "boolean" },
  hook: { type: "boolean" },
  quiet: { type: "boolean" },
  dir: { type: "string" },
  pm: { type: "string" },
  run: { type: "boolean" },
  record: { type: "boolean" },
  link: { type: "boolean" },
  prod: { type: "boolean" },
  plan: { type: "boolean" },
  only: { type: "string" },
} as const;

export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
  stdin?: () => Promise<string>;
}

const defaultIO: CliIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  stdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  },
};

class UsageError extends Error {}

const ICONS: Record<StageStatus, string> = {
  pending: "·",
  active: "▶",
  passed: "✓",
  failed: "✗",
  blocked: "!",
  skipped: "↷",
  overridden: "⚑",
};

function need(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(`Missing ${what}. See \`forge --help\`.`);
  return value;
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`Expected a positive number, got "${value}"`);
  return n;
}

function renderGate(result: GateResult, io: CliIO): void {
  const icon = { pass: "✓", fail: "✗", skip: "–" } as const;
  for (const check of result.checks) {
    const [head, ...rest] = check.message.split("\n");
    io.out(`  ${icon[check.status]} ${check.id.padEnd(22)} ${head}`);
    for (const line of rest) io.out(`      ${line}`);
  }
  io.out("");
  io.out(result.passed ? `PASSED  ${result.stage} (gate run ${result.run})` : `FAILED  ${result.stage} (gate run ${result.run})`);
  if (result.memo) io.out(`\n${result.memo}`);
}

async function readInput(file: string | undefined, io: CliIO): Promise<string> {
  if (file) return readFileSync(resolve(file), "utf8");
  if (!io.stdin) throw new UsageError("Pass --file <path>");
  return io.stdin();
}

export async function run(argv: string[], io: CliIO = defaultIO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    io.err(errorMessage(error));
    return 2;
  }
  const { values: opts, positionals } = parsed;
  const [command, ...args] = positionals;
  const print = (value: unknown, human?: () => void) => {
    if (opts.json || !human) io.out(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    else human();
  };

  if (opts.version) {
    io.out(VERSION);
    return 0;
  }
  if (!command || opts.help || command === "help") {
    io.out(HELP);
    return 0;
  }

  const forge = () => new Forge(opts.root ? resolve(opts.root) : undefined);

  try {
    switch (command) {
      case "init": {
        const result = Forge.init(resolve(opts.root ?? process.cwd()), { name: opts.name, force: opts.force });
        print(result, () => {
          if (result.alreadyInitialized) {
            io.out(`forge is already initialised in ${result.root} (use --force to reset state; the ledger is kept)`);
            return;
          }
          io.out(`Initialised forge in ${result.root}`);
          for (const path of result.created) io.out(`  + ${path}`);
          io.out("\nNext: `forge status`, then `forge start brainstorm` (or /forge in your agent).");
        });
        return 0;
      }

      case "status": {
        const status = forge().status();
        print(status, () => {
          io.out(`forge · ${status.project} · autonomy=${status.autonomy}${status.archived ? ` · ARCHIVED (${status.archived.reason})` : ""}`);
          io.out("");
          for (const stage of status.stages) {
            const runs = stage.gateRuns ? ` (${stage.gateRuns} gate run${stage.gateRuns > 1 ? "s" : ""})` : "";
            io.out(`  ${ICONS[stage.status]} ${stage.id.padEnd(11)} ${stage.status}${runs}`);
            for (const failure of stage.lastFailures.slice(0, 5)) io.out(`      ✗ ${failure}`);
          }
          io.out("");
          io.out(status.next ? `next: ${status.next}  (${status.nextCommand})` : "next: — pipeline complete");
          for (const blocker of status.blockers) io.out(`blocked: ${blocker.id} ${blocker.need}${blocker.stage ? ` [${blocker.stage}]` : ""}`);
        });
        return 0;
      }

      case "stages": {
        const f = forge();
        const config = f.config();
        const stages = f.stages().map((stage) => ({ ...stage, gate: gateChecks(stage, config) }));
        print(stages, () => {
          for (const stage of stages) {
            io.out(`${stage.id} — ${stage.title} (${stage.command})${stage.checkpoint ? " [checkpoint]" : ""}`);
            io.out(`  ${stage.summary}`);
            for (const check of stage.gate) io.out(`    · ${check.description}${check.optional ? " (optional)" : ""}`);
          }
        });
        return 0;
      }

      case "start": {
        const id = need(args[0], "stage");
        const state = forge().start(id, { force: opts.force });
        print(state, () => io.out(`▶ ${id} is active. When its outputs are written, run \`forge complete ${id}\`.`));
        return 0;
      }

      case "complete":
      case "gate": {
        const result = await forge().complete(need(args[0], "stage"));
        print(result, () => renderGate(result, io));
        return result.passed ? 0 : 1;
      }

      case "approve": {
        const id = need(args[0], "stage");
        forge().approve(id, process.env.USER ?? "human", opts.note);
        print({ approved: id }, () => io.out(`Approved ${id}. Run \`forge complete ${id}\` to re-check the gate.`));
        return 0;
      }

      case "skip":
      case "override": {
        const id = need(args[0], "stage");
        const reason = need(opts.reason, "--reason");
        const by = process.env.USER ?? "human";
        const state = command === "skip" ? forge().skip(id, reason, by) : forge().override(id, reason, by);
        print(state, () => io.out(`${command === "skip" ? "↷ Skipped" : "⚑ Overrode"} ${id} — recorded in the ledger.`));
        return 0;
      }

      case "reopen": {
        const reopened = forge().reopen(need(args[0], "stage"), need(opts.reason, "--reason"), { cascade: opts.cascade });
        print(reopened, () => io.out(`Reopened: ${reopened.join(", ")}`));
        return 0;
      }

      case "archive": {
        forge().archive(need(opts.reason, "--reason"));
        print({ archived: true }, () => io.out("Project archived."));
        return 0;
      }

      case "block": {
        const blocker = forge().addBlocker(need(args[0], "what is needed"), opts.stage);
        print(blocker, () => io.out(`Recorded ${blocker.id}: ${blocker.need}`));
        return 0;
      }

      case "unblock": {
        const blocker = forge().resolveBlocker(need(args[0], "blocker id"), opts.note);
        print(blocker, () => io.out(`Resolved ${blocker.id}`));
        return 0;
      }

      case "artifact": {
        const sub = need(args[0], "artifact subcommand (list | read | write | validate)");
        const root = forge().root;
        if (sub === "list") {
          const items = listArtifacts(root);
          print(items, () => {
            for (const item of items) {
              const mark = !item.exists ? "·" : item.valid ? "✓" : "✗";
              io.out(`  ${mark} ${item.name.padEnd(12)} ${item.path}${item.exists && !item.valid ? `  (${item.errors[0]?.trim()})` : ""}`);
            }
          });
          return 0;
        }
        const name = need(args[1], "artifact name");
        if (sub === "read") {
          const content = readArtifactText(root, name);
          if (content === undefined) throw new Error(`${ARTIFACTS[name]?.path ?? name} does not exist yet`);
          io.out(content.trimEnd());
          return 0;
        }
        if (sub === "write") {
          const raw = await readInput(opts.file, io);
          const result = writeArtifact(root, name, raw);
          print(result, () => io.out(`Wrote ${result.path}`));
          return 0;
        }
        if (sub === "validate") {
          const result = checkArtifact(root, name);
          print(result, () => io.out(result.valid ? `✓ ${result.path} is valid` : `✗ ${result.path}: ${result.errors.join("\n")}`));
          return result.valid ? 0 : 1;
        }
        throw new UsageError(`Unknown artifact subcommand "${sub}"`);
      }

      case "ledger": {
        const sub = need(args[0], "ledger subcommand (list | add)");
        const root = forge().root;
        if (sub === "list") {
          const entries = readLedger(root).slice(-toInt(opts.limit, 30));
          print(entries, () => {
            for (const entry of entries) {
              io.out(`${entry.id.padEnd(6)} ${entry.at.slice(0, 16).replace("T", " ")}  ${entry.kind.padEnd(8)} ${entry.stage ? `[${entry.stage}] ` : ""}${entry.summary}`);
              if (entry.why) io.out(`       why: ${entry.why}`);
              if (entry.rejected.length) io.out(`       rejected: ${entry.rejected.join("; ")}`);
            }
          });
          return 0;
        }
        if (sub === "add") {
          const entry = appendLedger(root, {
            kind: "decision",
            summary: need(opts.summary, "--summary"),
            why: opts.why,
            rejected: opts.rejected ? opts.rejected.split(",").map((item) => item.trim()).filter(Boolean) : [],
            stage: opts.stage,
            by: process.env.USER ?? "human",
          });
          print(entry, () => io.out(`Recorded ${entry.id}`));
          return 0;
        }
        throw new UsageError(`Unknown ledger subcommand "${sub}"`);
      }

      case "memory": {
        const sub = need(args[0], "memory subcommand (query | episode | learn)");
        const root = forge().root;
        if (sub === "query") {
          const answer = await queryMemory(root, need(args[1], "question"), {
            budgetTokens: toInt(opts.budget, 1500),
            useGraph: !opts["no-graph"],
          });
          print(answer, () => {
            io.out(`intent: ${answer.intent}${answer.graph?.error ? `  (graphify: ${answer.graph.error})` : ""}\n`);
            io.out(answer.text);
          });
          return 0;
        }
        if (sub === "episode") {
          const input = EpisodeFile.parse(JSON.parse(await readInput(opts.file, io))) as EpisodeInput;
          const episode = saveEpisode(root, input);
          print(episode, () => io.out(`Saved ${episode.file}`));
          return 0;
        }
        if (sub === "learn") {
          const learning = addLearning(root, need(args[1], "lesson text"), { source: opts.source, scope: opts.global ? "global" : "project" });
          print(learning, () => io.out(`Recorded (${learning.scope}): ${learning.text}`));
          return 0;
        }
        throw new UsageError(`Unknown memory subcommand "${sub}"`);
      }

      case "trace": {
        if (args[0] !== "link") throw new UsageError("Usage: forge trace link <from> <to> <type>");
        const trace = linkTrace(forge().root, need(args[1], "from node"), need(args[2], "to node"), need(args[3], "edge type"));
        print(trace, () => io.out(`Linked ${args[1]} → ${args[2]} (${args[3]}); ${trace.edges.length} edges`));
        return 0;
      }

      case "gaps": {
        const report = computeGaps(forge().root);
        print(report, () => {
          io.out(`trace coverage: ${Math.round(report.coverage * 100)}% (${report.satisfied}/${report.required})`);
          for (const gap of report.gaps) io.out(`  ✗ ${gap.message}`);
          for (const note of report.notes) io.out(`  note: ${note}`);
        });
        return report.gaps.length || !report.required ? 1 : 0;
      }

      case "graph": {
        const sub = need(args[0], "graph subcommand (status | update | query | path | explain)");
        const root = forge().root;
        if (sub === "status") {
          const status = graphStatus(root);
          print(status, () =>
            io.out(
              status.installed
                ? `graphify: ${status.binary}\ngraph: ${status.graphExists ? status.graphPath : "not built yet — run `forge graph update`"}`
                : `graphify not installed — ${GRAPHIFY_INSTALL_HINT}`,
            ),
          );
          return 0;
        }
        const result =
          sub === "update" ? await graphUpdate(root)
          : sub === "query" ? await graphQuery(root, need(args[1], "question"), toInt(opts.budget, 1500))
          : sub === "path" ? await graphPathBetween(root, need(args[1], "from"), need(args[2], "to"))
          : sub === "explain" ? await graphExplain(root, need(args[1], "node"))
          : undefined;
        if (!result) throw new UsageError(`Unknown graph subcommand "${sub}"`);
        print(result, () => io.out(result.ok ? result.output : `graphify: ${result.error}`));
        return result.ok ? 0 : 1;
      }

      case "evidence": {
        const sub = need(args[0], "evidence subcommand (search | save | list)");
        const root = forge().root;
        if (sub === "search") {
          const response = await searchEvidence(root, need(args[1], "source"), need(args[2], "query"), {
            limit: opts.limit ? toInt(opts.limit, 10) : undefined,
            fresh: opts.fresh,
          });
          print(response, () => {
            io.out(`${response.source} · "${response.query}" · ${response.results.length} results${response.cached ? " (cached)" : ""}`);
            for (const result of response.results) {
              const metrics = Object.entries(result.metrics).map(([key, value]) => `${key}=${value}`).join(" ");
              io.out(`\n• ${result.title}\n  ${result.url}\n  ${metrics}\n  ${result.text.slice(0, 200)}`);
            }
          });
          return 0;
        }
        if (sub === "save") {
          const item = await saveEvidence(root, {
            url: need(opts.url, "--url"),
            quote: need(opts.quote, "--quote"),
            source: opts.source,
            savedBy: process.env.USER ?? "human",
          });
          print(item, () =>
            io.out(`Saved ${item.id} (${item.verification.status} via ${item.verification.method}${item.verification.note ? `: ${item.verification.note}` : ""})`),
          );
          return 0;
        }
        if (sub === "list") {
          const items = loadEvidence(root);
          print(items, () => {
            for (const item of items) io.out(`${item.id.padEnd(6)} ${item.verification.status.padEnd(12)} ${item.url}\n       "${item.quote.slice(0, 120)}"`);
            const verified = items.filter((i) => i.verification.status === "verified").length;
            io.out(`${items.length} item(s), ${verified} verified`);
          });
          return 0;
        }
        throw new UsageError(`Unknown evidence subcommand "${sub}"`);
      }

      case "validate": {
        const sub = need(args[0], "validate subcommand (template | score)");
        if (sub === "template") {
          io.out(JSON.stringify(validationTemplate(need(args[1], "idea")), null, 2));
          return 0;
        }
        if (sub === "score") {
          const f = forge();
          const criteria = opts.file
            ? Validation.parse(JSON.parse(await readInput(opts.file, io))).criteria
            : (loadArtifact<Validation>(f.root, "validation")?.criteria ?? (() => {
                throw new Error("No validation artifact yet — pass --file");
              })());
          const report = scoreValidation(criteria, f.config().gates.validate.minScore);
          print(report, () => {
            io.out(`score ${report.score} · suggested verdict: ${report.suggestedVerdict} (${report.reason})`);
            io.out(`yes ${report.yes.length} · no ${report.no.length} · unknown ${report.unknown.length}`);
            if (report.unsupportedYes.length) io.out(`'yes' without evidence: ${report.unsupportedYes.join(", ")}`);
          });
          return 0;
        }
        throw new UsageError(`Unknown validate subcommand "${sub}"`);
      }

      case "adopt": {
        const result = await adoptProject(resolve(opts.root ?? process.cwd()), { name: opts.name, graph: !opts["no-graph"] });
        print(result, () => {
          const map = result.sync.map;
          const pages = map.surfaces.filter((s) => s.kind === "page").length;
          io.out(`Adopted ${result.root}${result.initialized ? " (initialised)" : ""}`);
          io.out(`  frameworks: ${map.frameworks.join(", ") || "none detected"}`);
          io.out(`  ${pages} pages · ${map.surfaces.length - pages} endpoints · ${map.calls.length} client→endpoint calls · ${map.docs.length} docs`);
          io.out(`  code graph: ${map.graph.status}${map.graph.note ? ` (${map.graph.note})` : ""}`);
          if (result.skipped.length) io.out(`  skipped greenfield stages: ${result.skipped.join(", ")}`);
          if (result.stacks) {
            io.out(`  stacks: ${result.stacks.stacks.map((st) => `${st.pack} (${st.dir})`).join(", ")}`);
            for (const [key, command] of Object.entries(result.stacks.set)) io.out(`    ✓ commands.${key.padEnd(6)} ${command}`);
          }
          io.out("\nNext: /forge:understand (or follow guide skills/understand-product) to write the product model, then `forge complete understand`.");
        });
        return 0;
      }

      case "sync": {
        const root = forge().root;
        if (opts.check) {
          const check = checkProduct(root);
          if (opts.hook) {
            // SessionStart hook: speak only for adopted projects whose map went stale.
            if (check.mapExists && check.stale) io.out(`forge: the product map is stale — ${check.reason}. Call product_sync before relying on product memory.`);
            return 0;
          }
          print(check, () => io.out(check.stale ? `stale: ${check.reason}` : `fresh: ${check.reason}`));
          return check.stale ? 1 : 0;
        }
        const result = await syncProduct(root, { graph: !opts["no-graph"] });
        if (!opts.quiet) {
          print(result, () => {
            const map = result.map;
            const pages = map.surfaces.filter((s) => s.kind === "page").length;
            io.out(`Synced: ${pages} pages · ${map.surfaces.length - pages} endpoints · ${map.calls.length} calls · graph ${map.graph.status}`);
            if (result.diff.added.length) io.out(`  + ${result.diff.added.join(", ")}`);
            if (result.diff.removed.length) io.out(`  - ${result.diff.removed.join(", ")}`);
            for (const stale of result.staleFeatures) io.out(`  ! ${stale.feature} references removed: ${stale.missing.join(", ")}`);
          });
        }
        return 0;
      }

      case "product": {
        const root = forge().root;
        const map = loadProductMap(root);
        if (!map) throw new Error("No product map yet — run `forge adopt` or `forge sync`");
        const view = args[0] ?? "summary";
        if (view === "pages" || view === "endpoints") {
          const list = map.surfaces.filter((s) => s.kind === (view === "pages" ? "page" : "endpoint"));
          print(list, () => list.forEach((s) => io.out(`  ${s.id.padEnd(48)} ${s.file}${s.graphifyNode ? "  ◆" : ""}`)));
        } else if (view === "calls") {
          print(map.calls, () => map.calls.forEach((c) => io.out(`  ${c.from} → ${c.to}`)));
        } else if (view === "docs") {
          print(map.docs, () => map.docs.forEach((d) => io.out(`  ${d.path} — ${d.title}`)));
        } else {
          const check = checkProduct(root);
          const pages = map.surfaces.filter((s) => s.kind === "page").length;
          print({ ...map, check }, () => {
            io.out(`frameworks: ${map.frameworks.join(", ") || "none detected"} · synced ${map.generatedAt} · ${check.stale ? "STALE" : "fresh"}`);
            io.out(`${pages} pages · ${map.surfaces.length - pages} endpoints · ${map.calls.length} calls · ${map.docs.length} docs · graph ${map.graph.status}`);
          });
        }
        return 0;
      }

      case "pages": {
        const audits = listPageAudits(forge().root);
        const chosen = args[0] ? audits.filter((a) => a.slug === args[0]) : audits;
        if (args[0] && !chosen.length) throw new Error(`No page audit "${args[0]}"`);
        print(chosen, () => {
          if (!chosen.length) io.out("No page audits yet — run /forge:page <route> (pro-page-complete).");
          for (const audit of chosen) {
            const open = audit.atoms.filter((a) => a.must && a.status !== "live");
            io.out(`${audit.slug.padEnd(24)} ${audit.page} · ${audit.atoms.length} atoms · ${open.length} open must-fix`);
            if (args[0]) for (const atom of open) io.out(`    ✗ ${atom.label} — ${atom.break ?? atom.status}${atom.fix ? ` → ${atom.fix}` : ""}`);
          }
        });
        return 0;
      }

      case "hooks": {
        if (args[0] !== "install") throw new UsageError("Usage: forge hooks install");
        const installed = installGitHooks(forge().root);
        print(installed, () => io.out(installed.length ? `Installed: ${installed.join(", ")}` : "forge git hooks already installed"));
        return 0;
      }

      case "tasks": {
        const root = forge().root;
        const view = args[0] ?? "waves";
        if (view === "brief") {
          io.out(taskBrief(root, need(args[1], "task id")));
          return 0;
        }
        if (view === "update") {
          const status = need(opts.status, "--status");
          if (!["todo", "doing", "done", "blocked"].includes(status)) throw new UsageError("--status must be todo, doing, done or blocked");
          const task = updateTask(root, need(args[1], "task id"), status as "todo", opts.note);
          print(task, () => io.out(`${task.id} → ${task.status}`));
          return 0;
        }
        const tasks = loadTasks(root);
        if (view === "next") {
          const ready = nextTasks(tasks);
          print(ready, () => io.out(ready.length ? ready.map((t) => `${t.id}  ${t.title}`).join("\n") : "No runnable tasks (all done, blocked, or waiting on dependencies)."));
          return 0;
        }
        const waves = planWaves(tasks);
        print(waves, () =>
          waves.forEach((wave, i) =>
            io.out(`wave ${i + 1}: ${wave.map((id) => `${id} [${tasks.find((t) => t.id === id)?.status}]`).join("  ")}`),
          ),
        );
        return 0;
      }

      case "worktree": {
        const root = forge().root;
        const view = args[0] ?? "list";
        if (view === "create") {
          const wt = createWorktree(root, need(args[1], "task id"));
          print(wt, () => io.out(`${wt.path} on ${wt.branch}`));
          return 0;
        }
        if (view === "remove") {
          removeWorktree(root, need(args[1], "task id"), opts.force);
          print({ removed: args[1] }, () => io.out(`Removed worktree for ${args[1]}`));
          return 0;
        }
        const list = listWorktrees(root);
        print(list, () => io.out(list.length ? list.map((w) => `${w.branch}  ${w.path}`).join("\n") : "No forge task worktrees."));
        return 0;
      }

      case "merge": {
        const f = forge();
        const results = await mergeTasks(f.root, f.config(), args.length ? args : undefined);
        print(results, () => {
          if (!results.length) io.out("Nothing to merge (no done tasks with a worktree).");
          for (const r of results) io.out(`${r.status === "merged" ? "✓ merged" : "✗ blocked"} ${r.task}${r.reason ? ` — ${r.reason}` : ""}`);
        });
        return results.every((r) => r.status === "merged") ? 0 : 1;
      }

      case "workers": {
        if (args[0] !== "run") throw new UsageError("Usage: forge workers run [--host h] [--max n] [--tasks a,b]");
        const f = forge();
        const results = await runWorkers(f.root, f.config(), {
          host: opts.host,
          max: opts.max ? toInt(opts.max, 1) : undefined,
          tasks: opts.tasks ? opts.tasks.split(",").map((t) => t.trim()) : undefined,
        });
        print(results, () => {
          if (!results.length) io.out("No runnable tasks.");
          for (const r of results) io.out(`${r.status === "done" ? "✓" : "✗"} ${r.task} (${r.seconds}s${r.timedOut ? ", timed out" : ""}) → ${r.worktree}`);
        });
        return results.every((r) => r.status === "done") ? 0 : 1;
      }

      case "qa": {
        const root = forge().root;
        if (args[0] === "plan") {
          const cases = qaPlan(root);
          print(cases, () => {
            for (const c of cases) io.out(`@${c.id.padEnd(12)} ${c.tool.padEnd(10)} ${c.suggestedFile}\n    ${c.text}`);
            io.out(`\n${cases.length} case(s). Put the tag in the test title (test("checks in @S-1/AC1", …)), a Maestro tags: entry, or a comment.`);
          });
          return 0;
        }
        if (args[0] === "coverage") {
          const report = qaCoverage(root, { link: opts.link });
          const min = forge().config().gates.qa.minCoverage;
          print(report, () => {
            for (const c of report.covered) io.out(`  ✓ ${c.id.padEnd(12)} ${c.files.join(", ")}`);
            for (const m of report.missing) io.out(`  ✗ ${m.id.padEnd(12)} ${m.text}\n      → ${m.tool} in ${m.suggestedFile}`);
            for (const u of report.unknownTags) io.out(`  ? @${u.tag} in ${u.file} matches no acceptance criterion`);
            io.out(`\n${report.required - report.missing.length}/${report.required} covered (${Math.round(report.ratio * 100)}%, needs ${Math.round(min * 100)}%) across ${report.testFiles} test files${opts.link ? " · trace links added" : ""}`);
          });
          return report.ratio >= min ? 0 : 1;
        }
        throw new UsageError("Usage: forge qa plan | forge qa coverage [--link]");
      }

      case "ci": {
        const result = writeWorkflow(forge().root, { force: opts.force });
        print(result, () => {
          io.out(result.written ? `Wrote ${result.path} — jobs: ${result.jobs.join(", ")}` : `${result.path} unchanged — jobs: ${result.jobs.join(", ")}`);
          for (const n of result.notes) io.out(`  ! ${n}`);
        });
        return 0;
      }

      case "deploy": {
        const root = forge().root;
        const env = opts.prod ? "production" : "preview";
        const only = opts.only ? opts.only.split(",").map((s) => s.trim()) : undefined;
        if (opts.plan) {
          const plan = deployPlan(root, env, only);
          print(plan, () => {
            for (const p of plan) {
              io.out(`${p.problems.length ? "✗" : "✓"} ${p.pack} (${p.dir}) → ${p.target?.name ?? "no target"}: ${p.command ?? `no ${env} deploy`}`);
              for (const problem of p.problems) io.out(`    ${problem}`);
            }
          });
          return plan.every((p) => !p.problems.length) ? 0 : 1;
        }
        const result = await deploy(root, { env, only, onWait: () => io.err("forge: waiting for a free command slot…") });
        print(result, () => {
          for (const s of result.steps) io.out(`${s.status === "deployed" ? "✓" : s.status === "skipped" ? "–" : "✗"} ${s.pack} ${s.status}${s.url ? ` → ${s.url}` : ""}${s.status === "deployed" ? "" : `: ${s.detail.split("\n")[0]}`}`);
          for (const c of result.checks) io.out(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.detail && !c.pass ? ` — ${c.detail.split("\n")[0]}` : ""}`);
          if (result.release) io.out(`\nRelease ${result.release.version} (${result.env}) recorded · notes: ${result.notesFile}`);
          io.out(result.ok ? "PASSED" : "FAILED");
        });
        return result.ok ? 0 : 1;
      }

      case "release": {
        if (args[0] !== "notes") throw new UsageError("Usage: forge release notes");
        const root = forge().root;
        const release = loadArtifact<Release>(root, "release");
        if (!release) throw new Error("No release yet — run `forge deploy`");
        io.out(releaseNotes(root, release));
        return 0;
      }

      case "security": {
        const f = forge();
        const { failOn, ignore } = f.config().security;
        if (args[0] === "scan") {
          const result = scanSecurity(f.root, { ignore });
          const recorded = opts.record ? recordFindings(f.root, result) : undefined;
          const blockers = blocking(result, failOn);
          print({ ...result, failOn, blocking: blockers.length, ...(recorded ? { recorded } : {}) }, () => {
            for (const x of result.findings) {
              io.out(`${x.severity.toUpperCase().padEnd(8)} ${x.rule.padEnd(28)} ${x.file}:${x.line}  ${x.title} [${x.cwe}]`);
              io.out(`         ${x.snippet}`);
              io.out(`         fix: ${x.fix}`);
            }
            for (const s of result.invalidSuppressions) io.out(`! ${s.file}:${s.line} ${s.text}`);
            const c = result.counts;
            io.out(`\n${result.filesScanned} files · ${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.low} low · ${result.suppressed.length} suppressed with a reason`);
            if (recorded) io.out(`Recorded ${recorded.added} new finding(s) in the reviews artifact (${recorded.total} total).`);
            io.out(blockers.length ? `FAIL — ${blockers.length} at ${failOn} or above (security.failOn)` : `PASS — nothing at ${failOn} or above`);
          });
          return blockers.length ? 1 : 0;
        }
        if (args[0] === "headers") {
          const url = need(args[1] ?? f.config().security.url, "URL (or security.url in forge.config.yaml)");
          const report = await checkHeaders(url);
          const blockers = blockingHeaders(report, failOn);
          print({ ...report, failOn, blocking: blockers.length }, () => {
            io.out(`${report.url} → ${report.status} ${report.contentType || "(no content-type)"} [${report.kind}]`);
            const icon = { pass: "✓", fail: "✗", warn: "!", info: "–" } as const;
            for (const c of report.checks) io.out(`  ${icon[c.status]} ${c.id.padEnd(20)} ${c.status === "pass" || c.status === "info" ? "" : `${c.severity} — `}${c.detail}${c.fix && c.status !== "pass" ? `\n      fix: ${c.fix}` : ""}`);
            io.out(blockers.length ? `\nFAIL — ${blockers.length} check(s) at ${failOn} or above` : `\nPASS — nothing failing at ${failOn} or above`);
          });
          return blockers.length ? 1 : 0;
        }
        throw new UsageError("Usage: forge security scan [--record] | forge security headers <url>");
      }

      case "stack": {
        const f = forge();
        const root = f.root;
        const view = args[0] ?? "list";
        if (view === "list") {
          const packs = listPacks(root);
          const detected = detectStacks(root);
          const configured = f.config().stacks;
          print({ packs: packs.map((p) => ({ ...p.pack, source: p.source })), detected, configured }, () => {
            for (const { pack, source } of packs) io.out(`${pack.id.padEnd(12)} ${pack.kind.padEnd(8)} ${pack.platforms.join("/").padEnd(16)} ${pack.name}${source === "project" ? " (project pack)" : ""}`);
            io.out("");
            io.out(`detected:   ${detected.map((d) => `${d.pack} (${d.dir})`).join(", ") || "none"}`);
            io.out(`configured: ${configured.map((s) => `${s.pack} (${s.dir})`).join(", ") || "none — run `forge stack use`"}`);
          });
          return 0;
        }
        if (view === "detect") {
          const results = detectStacks(root).map((d) => ({ ...d, ...stackCommands(root, d.pack, d.dir) }));
          print(results, () => {
            if (!results.length) io.out("No known stack found. `forge stack list` shows the packs; `forge stack scaffold <pack>` starts one.");
            for (const r of results) {
              io.out(`${r.pack} in ${r.dir} (${r.packageManager}) — ${r.evidence.join(", ")}`);
              for (const [key, command] of Object.entries(r.commands)) io.out(`  ✓ ${key.padEnd(6)} ${command}`);
              for (const m of r.missing) io.out(`  – ${m.key.padEnd(6)} ${m.why}${m.fix ? `\n           fix: ${m.fix}` : ""}`);
            }
          });
          return 0;
        }
        if (view === "use") {
          const result = useStacks(root, { pack: args[1], dir: opts.dir, force: opts.force });
          print(result, () => {
            io.out(`Stacks: ${result.stacks.map((s) => `${s.pack} (${s.dir})`).join(", ")}`);
            for (const [key, command] of Object.entries(result.set)) io.out(`  ✓ commands.${key.padEnd(6)} ${command}`);
            for (const [key, k] of Object.entries(result.kept)) io.out(`  = commands.${key.padEnd(6)} kept "${k.current}" (suggested "${k.suggested}"; --force replaces)`);
            for (const s of result.stacks) for (const m of s.missing) io.out(`  – ${s.pack} ${m.key}: ${m.why}${m.fix ? ` — ${m.fix}` : ""}`);
          });
          return 0;
        }
        if (view === "show") {
          const id = need(args[1], "pack id");
          const { pack, dir, source } = loadPack(id, root);
          const lens = readLens(id, root);
          print({ ...pack, source, dir, lens }, () => {
            io.out(`${pack.name} — ${pack.summary}`);
            io.out(`kind ${pack.kind} · platforms ${pack.platforms.join(", ")} · depts ${pack.depts.join(", ")} · tokens ${pack.tokens}`);
            io.out(`scaffold: ${pack.scaffold.command} (${pack.scaffold.docs})`);
            io.out("");
            io.out(lens || "(no review-lens.md)");
          });
          return 0;
        }
        if (view === "scaffold") {
          const id = need(args[1], "pack id");
          if (!opts.run) {
            const plan = scaffoldPlan(root, id, { dir: opts.dir, pm: opts.pm });
            print(plan, () => {
              io.out(`# ${plan.pack} into ${plan.dir}/ (${plan.docs})`);
              io.out(plan.command);
              for (const step of plan.then) io.out(`(cd ${plan.dir} && ${step})`);
              io.out("");
              io.out("Re-run with --run to execute it (network + dependency install), then forge records the stack.");
            });
            return 0;
          }
          const result = await scaffoldStack(root, id, {
            dir: opts.dir,
            pm: opts.pm,
            onWait: () => io.err("forge: waiting for a free command slot…"),
          });
          print(result, () => {
            io.out(result.output.trim());
            io.out(result.ok ? `\n✓ ${result.pack} scaffolded in ${result.dir}/ and recorded in forge.config.yaml` : `\n✗ failed at: ${result.failedStep}`);
            if (result.use) for (const [key, command] of Object.entries(result.use.set)) io.out(`  ✓ commands.${key.padEnd(6)} ${command}`);
          });
          return result.ok ? 0 : 1;
        }
        throw new UsageError("Usage: forge stack [list|detect|use [<pack>]|show <pack>|scaffold <pack>]");
      }

      case "design": {
        const root = forge().root;
        if (args[0] === "build") {
          const result = buildDesign(root);
          print(result, () => {
            if (result.errors.length) for (const e of result.errors) io.err(`  ✗ ${e}`);
            else io.out(`Built ${result.tokens} tokens${result.themes.length ? ` (themes: ${result.themes.join(", ")})` : ""} → ${result.files.join(", ")}`);
            for (const w of result.warnings) io.out(`  ! ${w}`);
          });
          return result.errors.length ? 1 : 0;
        }
        if (args[0] === "audit") {
          const set = loadTokens(root);
          const contrast = auditContrast(root);
          const drift = auditDrift(root, forge().config().gates.gap.scanDirs);
          const ok = !set.errors.length && contrast.declared && !contrast.errors.length && contrast.results.every((r) => r.pass) && !drift.length;
          print({ tokens: { count: set.base.size, errors: set.errors, warnings: set.warnings }, contrast, drift }, () => {
            io.out(`tokens: ${set.base.size}${set.errors.length ? ` — ${set.errors.length} error(s)` : " ✓"}`);
            for (const e of set.errors.slice(0, 10)) io.out(`  ✗ ${e}`);
            io.out(`contrast: ${contrast.declared ? `${contrast.results.filter((r) => r.pass).length}/${contrast.results.length} pass` : "no pairs declared"}`);
            for (const r of contrast.results.filter((x) => !x.pass)) io.out(`  ✗ ${r.theme}: ${r.fg} on ${r.bg} = ${r.ratio ?? "?"} (min ${r.min})${r.note ? ` — ${r.note}` : ""}`);
            for (const e of contrast.errors) io.out(`  ✗ ${e}`);
            io.out(`drift: ${drift.length} hard-coded colour(s)`);
            for (const h of drift.slice(0, 20)) io.out(`  ✗ ${h.file}:${h.line} ${h.value}${h.suggest ? ` → use ${h.suggest}` : ""}`);
          });
          return ok ? 0 : 1;
        }
        if (args[0] === "prototype") {
          const result = buildPrototype(root);
          print(result, () => io.out(`Wrote ${result.path} (${result.screens} screens · ?screen=<id>&state=empty|loading|error|success)`));
          return 0;
        }
        throw new UsageError("Usage: forge design build | audit | prototype");
      }

      case "procs": {
        const root = forge().root;
        if (args[0] === "init") {
          const file = join(root, "AGENT_PROCESSES.md");
          if (existsSync(file)) {
            print({ created: false, file }, () => io.out(`${file} already exists — left unchanged`));
            return 0;
          }
          writeFileSync(file, registryTemplate(root));
          print({ created: true, file }, () => {
            io.out(`Created ${file}`);
            io.out("Keep it out of version control: add AGENT_PROCESSES.md and .agent-runtime/ to .gitignore.");
          });
          return 0;
        }
        if (args[0]) throw new UsageError(`Unknown procs subcommand "${args[0]}"`);
        const processes = listProjectProcesses(root);
        const memory = memorySnapshot();
        const totalMb = processes.reduce((sum, p) => sum + p.rssKb, 0) / 1024;
        print({ root, memory, totalRssMb: Math.round(totalMb), processes }, () => {
          io.out(`machine: ${memory.totalGb.toFixed(1)} GB RAM, ${memory.freePercent}% free (${memory.source})`);
          if (!processes.length) {
            io.out(`no processes belong to ${root}`);
            return;
          }
          io.out(`${"PID".padEnd(8)}${"PPID".padEnd(8)}${"PGID".padEnd(8)}${"RSS".padStart(9)}  ${"WHY".padEnd(11)}COMMAND`);
          for (const p of processes) {
            const rss = `${(p.rssKb / 1024).toFixed(1)} MB`;
            io.out(`${String(p.pid).padEnd(8)}${String(p.ppid).padEnd(8)}${String(p.pgid).padEnd(8)}${rss.padStart(9)}  ${p.reason.padEnd(11)}${p.command.slice(0, 110)}`);
          }
          io.out(`${processes.length} process(es) · ${totalMb.toFixed(1)} MB resident (RSS)`);
        });
        return 0;
      }

      case "doctor": {
        const report = doctor(opts.root);
        print(report, () => {
          for (const item of report) io.out(`  ${item.ok ? "✓" : "·"} ${item.name.padEnd(14)} ${item.detail}`);
        });
        return 0;
      }

      case "schemas": {
        if (args[0] !== "export") throw new UsageError("Usage: forge schemas export [--out <dir>]");
        const out = resolve(opts.out ?? "schemas");
        mkdirSync(out, { recursive: true });
        const written = Object.entries(PUBLISHED_SCHEMAS).map(([name, schema]) => {
          const file = join(out, `${name}.schema.json`);
          writeFileSync(file, `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`);
          return file;
        });
        print(written, () => io.out(`Wrote ${written.length} schemas to ${out}`));
        return 0;
      }

      case "mcp": {
        const { startStdioServer } = await import("./mcp/server.js");
        await startStdioServer(opts.root ? resolve(opts.root) : undefined);
        return -1; // keep the process alive; the transport owns stdio now
      }

      default:
        throw new UsageError(`Unknown command "${command}". See \`forge --help\`.`);
    }
  } catch (error) {
    io.err(`forge: ${errorMessage(error)}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

const EpisodeFile = z.object({
  goal: z.string().min(1),
  done: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional(),
  openThreads: z.array(z.string()).optional(),
  next: z.string().optional(),
  stage: z.string().optional(),
});

function onPath(binary: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    if (dir && existsSync(join(dir, binary))) return join(dir, binary);
  }
  return null;
}

function doctor(rootOption?: string): { name: string; ok: boolean; detail: string }[] {
  const root = findRoot(rootOption ? resolve(rootOption) : undefined);
  const items: { name: string; ok: boolean; detail: string }[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  items.push({ name: "node", ok: major >= 20, detail: `v${process.versions.node}${major >= 20 ? "" : " (forge needs ≥ 20)"}` });
  const memory = memorySnapshot();
  items.push({
    name: "memory",
    ok: memory.freePercent >= 20,
    detail: `${memory.totalGb.toFixed(1)} GB, ${memory.freePercent}% free (${memory.source})${memory.freePercent < 20 ? " — low: avoid heavy jobs" : ""}`,
  });
  const f = new Forge(root);
  items.push({ name: "project", ok: f.initialized, detail: f.initialized ? root : `not initialised in ${root} — run \`forge init\`` });
  try {
    const config = f.config();
    items.push({ name: "config", ok: true, detail: `autonomy=${config.autonomy}, packs=[${config.packs.join(", ")}]` });
  } catch (error) {
    items.push({ name: "config", ok: false, detail: errorMessage(error) });
  }
  const graphify = findGraphify();
  items.push({ name: "graphify", ok: graphify !== null, detail: graphify ?? `optional — ${GRAPHIFY_INSTALL_HINT}` });
  for (const [name, binary] of [["claude", "claude"], ["codex", "codex"], ["gemini", "gemini"], ["opencode", "opencode"], ["cursor-agent", "cursor-agent"]] as const) {
    const path = onPath(binary);
    items.push({ name, ok: path !== null, detail: path ?? "not found (optional headless worker)" });
  }
  return items;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  // `forge status | head` closes stdout early; that is not an error.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  run(process.argv.slice(2)).then((code) => {
    if (code >= 0) process.exitCode = code;
  });
}

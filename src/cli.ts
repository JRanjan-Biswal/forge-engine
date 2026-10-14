#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ARTIFACTS, checkArtifact, listArtifacts, readArtifactText, writeArtifact } from "./core/artifacts.js";
import { Forge } from "./core/engine.js";
import { gateChecks } from "./core/gates.js";
import { appendLedger, readLedger } from "./core/ledger.js";
import { findRoot } from "./core/paths.js";
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
  doctor                               check node, config, graphify and agent CLIs

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

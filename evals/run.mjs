#!/usr/bin/env node
// forge-bench — Validate track.
// Runs `/forge:validate` headless in Claude Code for each task, ONE AT A TIME (RAM protocol),
// and scores what ended up on disk — not what the agent claims.
//
// Usage (from the forge repo root, after pnpm build):
//   node evals/run.mjs                              # all tasks
//   node evals/run.mjs --tasks habit-tracker,port-reaper --budget 2 --model sonnet
//
// Writes evals/results/validate-<stamp>.{json,md} (no local paths) and keeps raw runs in evals/runs/ (gitignored).
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CLI, FORGE, STAMP, readJson, sh, shAsync, writeJson, writeText } from "../e2e/lib.mjs";

const EVALS = dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    tasks: { type: "string" },
    budget: { type: "string", default: "2" },
    model: { type: "string", default: "sonnet" },
  },
});

const allTasks = readJson(join(EVALS, "validate", "tasks.json")).tasks;
const selected = opts.tasks ? opts.tasks.split(",").map((id) => id.trim()) : null;
const tasks = selected ? allTasks.filter((task) => selected.includes(task.id)) : allTasks;
if (!tasks.length) throw new Error(`No tasks match ${opts.tasks}`);

const runDir = join(EVALS, "runs", `${STAMP}-validate`);
mkdirSync(runDir, { recursive: true });
const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const readIf = (file, fallback) => (existsSync(file) ? readJson(file) : fallback);

/** A known competitor counts as found when its name appears in a competitor's name or URL. */
function knownRecall(known, competitors) {
  const haystacks = competitors.map((c) => `${normalize(c.name)} ${normalize(c.url)}`);
  const found = known.filter((name) => haystacks.some((h) => h.includes(normalize(name))));
  return { found, missed: known.filter((name) => !found.includes(name)), recall: known.length ? found.length / known.length : 0 };
}

const results = [];
for (const task of tasks) {
  const dir = join(runDir, task.id);
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, FORGE_ROOT: dir, FORGE_HOME: join(runDir, "forge-home") };
  const forge = (...args) => sh(process.execPath, [CLI, ...args], { cwd: dir, env });
  forge("init", "--name", task.id);
  forge("skip", "brainstorm", "--reason", "forge-bench: idea supplied by the task");
  forge("skip", "vision", "--reason", "forge-bench: validate track");

  console.log(`▶ ${task.id} — ${task.idea}`);
  const started = Date.now();
  const run = await shAsync(
    "claude",
    [
      "-p", `/forge:validate ${task.idea}`,
      "--plugin-dir", FORGE,
      "--model", opts.model,
      "--max-budget-usd", opts.budget,
      "--allowedTools", "mcp__plugin_forge_forge,WebSearch,WebFetch,Task,Agent",
      "--output-format", "json",
    ],
    { cwd: dir, env, timeoutMs: 1_800_000 },
  );
  writeText(join(dir, "claude-output.json"), run.all);
  let claude = null;
  try {
    claude = JSON.parse(run.out);
  } catch {
    // reported below as missing cost
  }

  const state = readIf(join(dir, ".forge/state.json"), { stages: {} });
  const gateRuns = state.stages.validate?.gateRuns ?? 0;
  const gate = gateRuns ? readIf(join(dir, `.forge/gates/validate-${gateRuns}.json`), null) : null;
  const gateFailing = (gate?.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
  const validation = readIf(join(dir, ".forge/artifacts/validation.json"), null);
  const competitors = readIf(join(dir, ".forge/artifacts/competitors.json"), { competitors: [] }).competitors;
  const evidence = readIf(join(dir, ".forge/evidence/evidence.json"), { items: [] }).items;
  const verified = evidence.filter((e) => e.verification.status === "verified").length;
  const recall = knownRecall(task.knownCompetitors, competitors);
  const answers = (validation?.criteria ?? []).reduce((acc, c) => ({ ...acc, [c.answer]: (acc[c.answer] ?? 0) + 1 }), {});

  const result = {
    id: task.id,
    verdict: validation?.verdict ?? "none",
    score: validation?.score ?? null,
    answers,
    gateRuns,
    gateFailing,
    // Evidence, schema and scoring all passed; only the verdict decision (go, min score) / human approval remain.
    decisionOnly: gateRuns > 0 && gateFailing.every((id) => ["human-approval", "validation-verdictGo", "min-score"].includes(id)),
    validationValid: forge("artifact", "validate", "validation").code === 0,
    competitorsValid: forge("artifact", "validate", "competitors").code === 0,
    evidence: evidence.length,
    verifiedShare: evidence.length ? verified / evidence.length : 0,
    competitors: competitors.length,
    knownRecall: recall.recall,
    knownFound: recall.found,
    knownMissed: recall.missed,
    costUsd: claude?.total_cost_usd ?? null,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  results.push(result);
  console.log(
    `  verdict ${result.verdict} · checks ${result.decisionOnly ? "ok" : `FAIL [${gateFailing.join(", ")}]`} · ` +
      `evidence ${result.evidence} (${Math.round(result.verifiedShare * 100)}% verified) · ` +
      `known competitors ${recall.found.length}/${task.knownCompetitors.length} · $${result.costUsd?.toFixed(2) ?? "?"} · ${result.seconds}s`,
  );
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const pct = (value) => `${Math.round(value * 100)}%`;
const summary = {
  track: "validate",
  stamp: STAMP,
  forge: readJson(join(FORGE, "package.json")).version,
  model: opts.model,
  budgetPerTaskUsd: Number(opts.budget),
  tasks: results.length,
  checksPassRate: mean(results.map((r) => (r.decisionOnly ? 1 : 0))),
  meanVerifiedShare: mean(results.map((r) => r.verifiedShare)),
  meanKnownRecall: mean(results.map((r) => r.knownRecall)),
  meanCompetitors: mean(results.map((r) => r.competitors)),
  totalCostUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  meanSeconds: mean(results.map((r) => r.seconds)),
  verdicts: results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {}),
};

const md = [
  `# forge-bench — Validate track (${STAMP})`,
  "",
  `forge ${summary.forge} · model \`${summary.model}\` · budget $${summary.budgetPerTaskUsd}/task · ${summary.tasks} task(s), run one at a time`,
  "",
  "| Metric | Value |",
  "|---|---|",
  `| Evidence, schema & scoring checks passed | ${pct(summary.checksPassRate)} |`,
  `| Mean verified-evidence share | ${pct(summary.meanVerifiedShare)} |`,
  `| Mean recall of well-known competitors | ${pct(summary.meanKnownRecall)} |`,
  `| Mean competitors analysed | ${summary.meanCompetitors.toFixed(1)} |`,
  `| Total cost | $${summary.totalCostUsd.toFixed(2)} |`,
  `| Mean wall time | ${Math.round(summary.meanSeconds)} s |`,
  `| Verdicts | ${Object.entries(summary.verdicts).map(([v, n]) => `${v} × ${n}`).join(", ")} |`,
  "",
  "| Task | Verdict (score) | Checks | Evidence (verified) | Competitors | Known found | Missed | Cost | Time |",
  "|---|---|---|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.verdict} (${r.score ?? "–"}) | ${r.decisionOnly ? "✅" : `❌ ${r.gateFailing.join(", ")}`} | ${r.evidence} (${pct(r.verifiedShare)}) | ${r.competitors} | ${r.knownFound.length}/${r.knownFound.length + r.knownMissed.length} | ${r.knownMissed.join(", ") || "—"} | $${r.costUsd?.toFixed(2) ?? "?"} | ${r.seconds}s |`,
  ),
  "",
  "Verdicts are reported, not graded. \"Checks\" = every evidence, schema and scoring check of the validate gate passed (an honest non-go verdict still stops the gate at the verdict decision, by design).",
  "",
].join("\n");

mkdirSync(join(EVALS, "results"), { recursive: true });
writeJson(join(EVALS, "results", `validate-${STAMP}.json`), { summary, results });
writeText(join(EVALS, "results", `validate-${STAMP}.md`), md);
console.log(`\n${md}`);

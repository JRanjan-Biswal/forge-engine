import { runCommand, withCommandSlot } from "./proc.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  RubricResult,
  type Brainstorm,
  type Competitors,
  type Motion,
  type Prd,
  type Release,
  type Reviews,
  type Screens,
  type Tasks,
  type Validation,
} from "../schemas/artifacts.js";
import type { CheckResult, GateCheck, GateResult, NumberOrConfig, State } from "../schemas/runtime.js";
import { auditContrast, auditDrift } from "../design/audit.js";
import { loadTokens, tokensDir } from "../design/tokens.js";
import { findEvidence, loadEvidence } from "../evidence/store.js";
import { checkProduct, listPageAudits, loadProductMap } from "../product/sync.js";
import type { ProductModel } from "../schemas/product.js";
import { listEpisodes } from "../memory/episodes.js";
import { redactSecrets } from "../memory/secrets.js";
import { computeGaps, scanPlaceholders } from "../trace/trace.js";
import { blockingHeaders, checkHeaders } from "../security/headers.js";
import { blocking, scanSecurity } from "../security/scan.js";
import { shotProblems } from "../design/shots.js";
import { contractDrift, platformParity } from "../trace/drift.js";
import { qaCoverage } from "../qa/coverage.js";
import { answered, bypassHeaders, describeHttp, httpStatus } from "../ship/deploy.js";
import { ARTIFACTS, checkArtifact, loadArtifact } from "./artifacts.js";
import type { ForgeConfig } from "./config.js";
import { layout, nowIso, readJson } from "./paths.js";
import { HUMAN_CHECK, type StageDef } from "./stages.js";
import { errorMessage, formatIssues, getPath, tail } from "./util.js";

export interface GateContext {
  root: string;
  config: ForgeConfig;
  stage: StageDef;
  state: State;
}

interface Outcome {
  status: CheckResult["status"];
  message: string;
}

const pass = (message: string): Outcome => ({ status: "pass", message });
const fail = (message: string): Outcome => ({ status: "fail", message });
const skip = (message: string): Outcome => ({ status: "skip", message });

/** Checks for a stage, adding a human approval check to every stage when autonomy=strict. */
export function gateChecks(stage: StageDef, config: ForgeConfig): GateCheck[] {
  const checks = [...stage.gate];
  if (config.autonomy === "strict" && !checks.some((check) => check.type === "human")) checks.push(HUMAN_CHECK);
  return checks;
}

export async function runGate(ctx: GateContext, run: number): Promise<GateResult> {
  const checks: CheckResult[] = [];
  for (const check of gateChecks(ctx.stage, ctx.config)) {
    let outcome: Outcome;
    try {
      outcome = await runCheck(check, ctx);
    } catch (error) {
      outcome = fail(errorMessage(error));
    }
    checks.push({ id: check.id, type: check.type, status: outcome.status, message: redactSecrets(outcome.message) });
  }
  const passed = checks.every((check) => check.status !== "fail");
  const escalate = !passed && run >= ctx.config.maxIterations;
  return {
    stage: ctx.stage.id,
    run,
    passed,
    at: nowIso(),
    checks,
    escalate,
    memo: escalate ? decisionMemo(ctx.stage, checks, run) : undefined,
  };
}

function decisionMemo(stage: StageDef, checks: CheckResult[], run: number): string {
  const failing = checks.filter((check) => check.status === "fail");
  return [
    `Stage "${stage.id}" has failed its gate ${run} times and needs a human decision.`,
    "",
    "Failing checks:",
    ...failing.map((check) => `- ${check.id}: ${check.message.split("\n", 1)[0]}`),
    "",
    "Options:",
    `1. Fix the failing checks and run \`forge complete ${stage.id}\` again.`,
    `2. Accept the risk: \`forge override ${stage.id} --reason "<why>"\` (recorded in the ledger).`,
    "3. If the root cause is upstream, reopen that stage: `forge reopen <stage> --reason \"<why>\"`.",
  ].join("\n");
}

function resolveNumber(value: NumberOrConfig, config: ForgeConfig): number {
  if (typeof value === "number") return value;
  const resolved = getPath(config, value.config);
  if (typeof resolved !== "number") throw new Error(`forge.config.yaml ${value.config} is not a number`);
  return resolved;
}

function compare(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    case ">": return actual > expected;
    case "<": return actual < expected;
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    default: throw new Error(`unknown operator ${op}`);
  }
}

/** Load a required artifact for a check, failing the check with a clear message if absent. */
function need<T>(ctx: GateContext, name: string): T {
  const value = loadArtifact<T>(ctx.root, name);
  if (value === undefined) throw new Error(`${ARTIFACTS[name]?.path ?? name} is missing`);
  return value;
}

async function runCheck(check: GateCheck, ctx: GateContext): Promise<Outcome> {
  switch (check.type) {
    case "artifact": {
      const result = checkArtifact(ctx.root, check.artifact);
      if (!result.exists) return fail(`${result.path} is missing`);
      return result.valid ? pass(`${result.path} is valid`) : fail(`${result.path} is invalid:\n${result.errors.join("\n")}`);
    }
    case "file": {
      const file = join(ctx.root, check.path);
      if (!existsSync(file)) return fail(`${check.path} is missing`);
      if (check.nonEmpty) {
        const stat = statSync(file);
        const empty = stat.isDirectory()
          ? readdirSync(file).filter((name) => !name.startsWith(".")).length === 0
          : stat.size === 0;
        if (empty) return fail(`${check.path} is empty`);
      }
      return pass(`${check.path} exists`);
    }
    case "metric": {
      const data = need<unknown>(ctx, check.artifact);
      const actual = getPath(data, check.pointer);
      if (typeof actual !== "number") {
        return fail(`${check.artifact}.${check.pointer} is not a number (got ${JSON.stringify(actual)})`);
      }
      const expected = resolveNumber(check.value, ctx.config);
      return compare(actual, check.op, expected)
        ? pass(`${check.pointer} = ${actual} (${check.op} ${expected})`)
        : fail(`${check.pointer} = ${actual}, needs ${check.op} ${expected}`);
    }
    case "command":
      return runCommandCheck(check, ctx);
    case "builtin": {
      const builtinCheck = BUILTINS[check.name];
      return builtinCheck ? builtinCheck(ctx) : fail(`unknown builtin check "${check.name}"`);
    }
    case "rubric":
      return rubricCheck(check.minPassRatio, ctx);
    case "human":
      return humanCheck(ctx);
  }
}

// ── command ──────────────────────────────────────────────────────────────────

async function runCommandCheck(check: Extract<GateCheck, { type: "command" }>, ctx: GateContext): Promise<Outcome> {
  const configured = check.configKey ? getPath(ctx.config, check.configKey) : undefined;
  const command = check.command ?? (typeof configured === "string" ? configured : undefined);
  if (!command) {
    const where = check.configKey ? `${check.configKey} in forge.config.yaml` : "command";
    return check.optional
      ? skip(`${where} is not configured`)
      : fail(`${where} is not configured — set it; forge never assumes a command passes`);
  }
  const { maxConcurrentCommands, commandWaitMs } = ctx.config.resources;
  // Heavy commands share a per-project slot so parallel agents cannot stack test suites in RAM.
  const result = await withCommandSlot(
    ctx.root,
    {
      max: maxConcurrentCommands,
      waitMs: commandWaitMs,
      task: `forge gate ${ctx.stage.id}/${check.id}`,
      onWait: () => process.stderr.write(`forge: waiting for a free command slot to run \`${command}\`…\n`),
    },
    () => runCommand(command, ctx.root, { timeoutMs: check.timeoutMs }),
  );
  const cleanup = result.leftovers
    ? ` — stopped ${result.leftovers} background process(es) it left running`
    : "";
  if (result.code === 0 && !result.timedOut) return pass(`\`${command}\` exited 0${cleanup}`);
  const how = result.timedOut ? `timed out after ${check.timeoutMs}ms (process group stopped)` : `exited ${result.code ?? "on a signal"}`;
  return fail(`\`${command}\` ${how}${cleanup}\n${tail(result.output.trim(), 1500)}`);
}

// ── rubric & human ───────────────────────────────────────────────────────────

function rubricCheck(minPassRatio: NumberOrConfig, ctx: GateContext): Outcome {
  const relativePath = `.forge/gates/${ctx.stage.id}.rubric.json`;
  const file = join(layout(ctx.root).gates, `${ctx.stage.id}.rubric.json`);
  if (!existsSync(file)) return fail(`no rubric result at ${relativePath} — a judge agent must score this stage`);
  const parsed = RubricResult.safeParse(readJson(file));
  if (!parsed.success) return fail(`${relativePath} is invalid:\n${formatIssues(parsed.error)}`);
  const startedAt = ctx.state.stages[ctx.stage.id]?.startedAt;
  if (startedAt && statSync(file).mtime.toISOString() < startedAt) {
    return fail(`${relativePath} predates the current run of this stage — re-score it`);
  }
  const { criteria, judge, producer } = parsed.data;
  const passed = criteria.filter((criterion) => criterion.pass).length;
  const ratio = passed / criteria.length;
  const min = resolveNumber(minPassRatio, ctx.config);
  const warning = judge && producer && judge === producer ? " (warning: judge and producer are the same model)" : "";
  const failing = criteria.filter((criterion) => !criterion.pass).map((criterion) => criterion.id);
  return ratio >= min
    ? pass(`rubric ${passed}/${criteria.length} passed${warning}`)
    : fail(`rubric ${passed}/${criteria.length} passed, needs ${Math.round(min * 100)}% — failing: ${failing.join(", ")}${warning}`);
}

function humanCheck(ctx: GateContext): Outcome {
  const { autonomy } = ctx.config;
  const required = autonomy === "strict" || (autonomy === "checkpoint" && ctx.stage.checkpoint);
  if (!required) return skip(`approval not required (autonomy=${autonomy})`);
  const approval = ctx.state.approvals[ctx.stage.id];
  if (!approval) return fail(`waiting for human approval — run \`forge approve ${ctx.stage.id}\``);
  const startedAt = ctx.state.stages[ctx.stage.id]?.startedAt;
  if (startedAt && approval.at < startedAt) {
    return fail(`approval predates the current run of this stage — approve again`);
  }
  return pass(`approved by ${approval.by}${approval.note ? `: ${approval.note}` : ""}`);
}

// ── builtins ─────────────────────────────────────────────────────────────────

export function validationScore(validation: Validation): number {
  let yes = 0;
  let decided = 0;
  for (const criterion of validation.criteria) {
    if (criterion.answer === "yes") yes += criterion.weight;
    if (criterion.answer !== "unknown") decided += criterion.weight;
  }
  return decided === 0 ? 0 : Math.round((100 * yes) / decided);
}

const REQUIRED_STATES = ["empty", "loading", "error", "success"] as const;

function listOrPass(problems: string[], ok: string, prefix: string): Outcome {
  return problems.length ? fail(`${prefix}: ${problems.join(", ")}`) : pass(ok);
}

function hasCycle(tasks: Tasks["tasks"]): string | null {
  const deps = new Map(tasks.map((task) => [task.id, task.deps]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): string | null => {
    if (done.has(id)) return null;
    if (visiting.has(id)) return [...path, id].join(" → ");
    visiting.add(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep, [...path, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.id, []);
    if (cycle) return cycle;
  }
  return null;
}

type Builtin = (ctx: GateContext) => Outcome | Promise<Outcome>;

/** Every (url, quote) pair cited by the validation scorecard and the competitor teardown. */
function citedEvidence(ctx: GateContext): { url: string; quote: string; where: string }[] {
  const validation = need<Validation>(ctx, "validation");
  const competitors = loadArtifact<Competitors>(ctx.root, "competitors");
  return [
    ...validation.criteria.flatMap((c) => c.evidence.map((e) => ({ url: e.url, quote: e.quote, where: c.id }))),
    ...(competitors?.competitors ?? []).flatMap((c) => [
      ...c.evidence.map((e) => ({ url: e.url, quote: e.quote, where: c.name })),
      ...c.reviewComplaints.map((r) => ({ url: r.source, quote: r.quote, where: `${c.name} review` })),
    ]),
  ];
}

export const BUILTINS: Record<string, Builtin> = {
  "brainstorm.chosen": (ctx) => {
    const brainstorm = need<Brainstorm>(ctx, "brainstorm");
    if (!brainstorm.chosenId) return fail("no chosenId — pick one idea to take forward");
    return brainstorm.ideas.some((idea) => idea.id === brainstorm.chosenId)
      ? pass(`chose ${brainstorm.chosenId}`)
      : fail(`chosenId "${brainstorm.chosenId}" is not one of the ideas`);
  },

  "validation.evidenceRule": (ctx) => {
    const validation = need<Validation>(ctx, "validation");
    const unsupported = validation.criteria
      .filter((criterion) => criterion.answer === "yes" && criterion.evidence.length === 0)
      .map((criterion) => criterion.id);
    return listOrPass(unsupported, "every 'yes' cites evidence", "'yes' answers without evidence (cite a source or answer unknown)");
  },

  "validation.scoreConsistent": (ctx) => {
    const validation = need<Validation>(ctx, "validation");
    const expected = validationScore(validation);
    return Math.abs(expected - validation.score) <= 1
      ? pass(`score ${validation.score} matches the answers`)
      : fail(`score is ${validation.score} but the weighted answers give ${expected}`);
  },

  "validation.minEvidence": (ctx) => {
    const validation = need<Validation>(ctx, "validation");
    const competitors = loadArtifact<Competitors>(ctx.root, "competitors");
    const urls = new Set([
      ...validation.criteria.flatMap((criterion) => criterion.evidence.map((item) => item.url)),
      ...(competitors?.competitors.flatMap((competitor) => competitor.evidence.map((item) => item.url)) ?? []),
    ]);
    const min = ctx.config.gates.validate.minEvidence;
    return urls.size >= min
      ? pass(`${urls.size} distinct evidence sources`)
      : fail(`${urls.size} distinct evidence sources, need ${min}`);
  },

  "evidence.registered": (ctx) => {
    if (!ctx.config.gates.validate.requireEvidenceStore) return skip("gates.validate.requireEvidenceStore is off");
    const items = loadEvidence(ctx.root);
    const missing = citedEvidence(ctx).filter((cited) => !findEvidence(items, cited.url, cited.quote));
    const shown = missing.slice(0, 8).map((m) => `${m.where} → ${m.url}`);
    if (missing.length > 8) shown.push(`…and ${missing.length - 8} more`);
    return listOrPass(shown, "every cited quote was saved and checked through the evidence store", "cited quotes never saved via evidence_save (unchecked)");
  },

  "evidence.verifiedShare": (ctx) => {
    if (!ctx.config.gates.validate.requireEvidenceStore) return skip("gates.validate.requireEvidenceStore is off");
    const items = loadEvidence(ctx.root);
    const cited = citedEvidence(ctx);
    if (!cited.length) return fail("no evidence is cited");
    const verified = cited.filter((c) => findEvidence(items, c.url, c.quote)?.verification.status === "verified").length;
    const share = verified / cited.length;
    const min = ctx.config.gates.validate.minVerifiedShare;
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    return share >= min
      ? pass(`${verified}/${cited.length} cited quotes verified against their source (${pct(share)})`)
      : fail(`only ${verified}/${cited.length} cited quotes verified (${pct(share)}), needs ${pct(min)} — prefer sources whose pages can be fetched`);
  },

  "design.tokensValid": (ctx) => {
    const set = loadTokens(ctx.root);
    if (set.errors.length) return fail(set.errors.slice(0, 8).join("; "));
    const themes = Object.keys(set.themes);
    return pass(`${set.base.size} tokens resolve and validate${themes.length ? `; themes: ${themes.join(", ")}` : ""}`);
  },

  "design.contrast": (ctx) => {
    const report = auditContrast(ctx.root);
    if (!report.declared) return fail(report.errors.join("; "));
    const failing = report.results
      .filter((r) => !r.pass)
      .map((r) => `${r.theme}: ${r.fg} on ${r.bg} = ${r.ratio ?? "?"}${r.note ? ` (${r.note})` : ` < ${r.min}`}`);
    return listOrPass([...report.errors, ...failing], `${report.results.length} contrast checks pass (WCAG)`, "contrast failures");
  },

  "design.noDrift": (ctx) => {
    if (!existsSync(tokensDir(ctx.root))) return skip("no design tokens in this project");
    const hits = auditDrift(ctx.root, ctx.config.gates.gap.scanDirs, 20);
    return listOrPass(
      hits.map((h) => `${h.file}:${h.line} ${h.value}${h.suggest ? ` → ${h.suggest}` : ""}`),
      "no hard-coded colours outside the design tokens",
      "hard-coded colours (use design tokens)",
    );
  },

  "product.mapFresh": (ctx) => {
    const check = checkProduct(ctx.root);
    return check.stale ? fail(check.reason) : pass(`product map ${check.reason}`);
  },

  "product.coverage": (ctx) => {
    const model = need<ProductModel>(ctx, "product");
    const map = loadProductMap(ctx.root);
    if (!map) return fail("no product map — run `forge sync`");
    const known = new Set(map.surfaces.map((s) => s.id));
    const covered = new Set([...model.features.flatMap((f) => f.surfaces), ...model.ignoredSurfaces.map((i) => i.surface)]);
    const unknown = [...covered].filter((id) => !known.has(id));
    if (unknown.length) return fail(`the model references surfaces not in the product map: ${unknown.slice(0, 8).join(", ")}`);
    const missing = map.surfaces.filter((s) => !covered.has(s.id)).map((s) => s.id);
    const shown = missing.slice(0, 10).concat(missing.length > 10 ? [`…and ${missing.length - 10} more`] : []);
    return listOrPass(shown, `all ${map.surfaces.length} pages/endpoints are accounted for`, "surfaces not yet in any feature (or ignored with a reason)");
  },

  "pages.noMustFix": (ctx) => {
    const audits = listPageAudits(ctx.root);
    if (!audits.length) return pass("no page audits recorded");
    const open = audits.flatMap((audit) =>
      audit.atoms.filter((atom) => atom.must && atom.status !== "live").map((atom) => `${audit.page} → ${atom.label} (${atom.status})`),
    );
    return listOrPass(open.slice(0, 10), `${audits.length} audited page(s), no open must-fix atoms`, "open must-fix atoms");
  },

  "validation.verdictGo": (ctx) => {
    const validation = need<Validation>(ctx, "validation");
    switch (validation.verdict) {
      case "go":
        return pass("verdict is go");
      case "pivot":
        return fail("verdict is pivot — revise the idea and re-validate, or override with a reason");
      case "kill":
        return fail("verdict is kill — archive the project (`forge archive`) or override with a reason");
      case "needs-experiment": {
        const experiments = validation.experiments.map((experiment) => experiment.name).join("; ");
        return fail(`verdict is needs-experiment — run ${experiments || "the cheapest experiment"} first`);
      }
    }
  },

  "prd.acceptance": (ctx) => {
    const prd = need<Prd>(ctx, "prd");
    const missing = prd.stories
      .filter((story) => story.priority !== "wont" && story.acceptance.length === 0)
      .map((story) => story.id);
    return listOrPass(missing, "every story has acceptance criteria", "stories without acceptance criteria");
  },

  "prd.mvpCut": (ctx) => {
    const mvp = need<Prd>(ctx, "prd").stories.filter((story) => story.mvp).length;
    return mvp ? pass(`${mvp} MVP stories`) : fail("no story is marked mvp: true — set the MVP cut line");
  },

  "design.storyCoverage": (ctx) => {
    const prd = need<Prd>(ctx, "prd");
    const covered = new Set(need<Screens>(ctx, "screens").screens.flatMap((screen) => screen.storyIds));
    const missing = prd.stories.filter((story) => story.mvp && !covered.has(story.id)).map((story) => story.id);
    return listOrPass(missing, "every MVP story has a screen", "MVP stories without a screen");
  },

  "design.shotsFresh": (ctx) => {
    if (!ctx.config.gates.design.screenshots) return skip("gates.design.screenshots is off");
    const problems = shotProblems(ctx.root);
    return problems.length ? fail(problems.join("; ")) : pass("every screen × state designed, freshly screenshotted and critiqued after the shots");
  },

  "design.states": (ctx) => {
    const problems = need<Screens>(ctx, "screens")
      .screens.filter((screen) => !screen.stateless)
      .map((screen) => {
        const missing = REQUIRED_STATES.filter((state) => !screen.states.includes(state));
        return missing.length ? `${screen.id} (${missing.join("/")})` : null;
      })
      .filter((problem): problem is string => problem !== null);
    return listOrPass(problems, "every screen designs all four states", "screens missing states");
  },

  "motion.reducedMotion": (ctx) => {
    const missing = need<Motion>(ctx, "motion").specs.filter((spec) => !spec.reducedMotion).map((spec) => spec.id);
    return listOrPass(missing, "every motion spec has a reduced-motion fallback", "motion specs without reducedMotion");
  },

  "tasks.dag": (ctx) => {
    const { tasks } = need<Tasks>(ctx, "tasks");
    const ids = new Set<string>();
    const duplicates = tasks.filter((task) => (ids.has(task.id) ? true : (ids.add(task.id), false))).map((task) => task.id);
    if (duplicates.length) return fail(`duplicate task ids: ${duplicates.join(", ")}`);
    const unknown = tasks.flatMap((task) => task.deps.filter((dep) => !ids.has(dep)).map((dep) => `${task.id}→${dep}`));
    if (unknown.length) return fail(`dependencies on unknown tasks: ${unknown.join(", ")}`);
    const cycle = hasCycle(tasks);
    return cycle ? fail(`dependency cycle: ${cycle}`) : pass(`${tasks.length} tasks form a DAG`);
  },

  "tasks.storyCoverage": (ctx) => {
    const prd = need<Prd>(ctx, "prd");
    const covered = new Set(need<Tasks>(ctx, "tasks").tasks.flatMap((task) => task.storyIds));
    const missing = prd.stories.filter((story) => story.mvp && !covered.has(story.id)).map((story) => story.id);
    return listOrPass(missing, "every MVP story has a task", "MVP stories without a task");
  },

  "review.noBlocking": (ctx) => {
    const blocking = need<Reviews>(ctx, "reviews")
      .findings.filter((finding) => (finding.severity === "critical" || finding.severity === "high") && finding.status === "open")
      .map((finding) => `${finding.id} (${finding.severity}, ${finding.file})`);
    return listOrPass(blocking, "no open critical/high findings", "open blocking findings");
  },

  "security.scan": (ctx) => {
    const { failOn, ignore } = ctx.config.security;
    const result = scanSecurity(ctx.root, { ignore });
    const blockers = blocking(result, failOn);
    const extra = [
      result.suppressed.length ? `${result.suppressed.length} suppressed with a reason` : "",
      result.invalidSuppressions.length ? `${result.invalidSuppressions.length} suppression(s) ignored for lacking a reason` : "",
    ].filter(Boolean);
    const note = extra.length ? ` (${extra.join("; ")})` : "";
    return blockers.length
      ? fail(
          `${blockers.length} finding(s) at ${failOn} or above${note} — run \`forge security scan\`:\n${blockers
            .slice(0, 15)
            .map((f) => `${f.severity} ${f.rule} ${f.file}:${f.line} — ${f.title}`)
            .join("\n")}`,
        )
      : pass(`${result.filesScanned} files, nothing at ${failOn} or above (${result.counts.medium} medium, ${result.counts.low} low)${note}`);
  },

  "security.headers": async (ctx) => {
    const { url, failOn } = ctx.config.security;
    if (!url) return skip("security.url is not configured — set it to the running app (local or preview) to check headers, cookies and CORS");
    let report;
    try {
      report = await checkHeaders(url);
    } catch (error) {
      return fail(`${errorMessage(error)} — start the app (and stop it afterwards) or point security.url at a preview deployment`);
    }
    const blockers = blockingHeaders(report, failOn);
    return blockers.length
      ? fail(`${url}: ${blockers.map((c) => `${c.id} (${c.severity}): ${c.detail}`).join("; ")}`)
      : pass(`${url}: ${report.checks.filter((c) => c.status === "pass").length}/${report.checks.length} header checks pass, nothing failing at ${failOn} or above`);
  },

  "trace.coverage": (ctx) => {
    const report = computeGaps(ctx.root);
    const min = ctx.config.gates.gap.minCoverage;
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    if (report.coverage >= min) return pass(`trace coverage ${pct(report.coverage)} (${report.satisfied}/${report.required})`);
    const sample = report.gaps.slice(0, 8).map((gap) => `${gap.story}:${gap.missing}`);
    const notes = report.notes.length ? ` — ${report.notes.join("; ")}` : "";
    return fail(`trace coverage ${pct(report.coverage)}, needs ${pct(min)}; missing ${sample.join(", ")}${report.gaps.length > 8 ? ", …" : ""}${notes}`);
  },

  "gap.contractDrift": (ctx) => {
    const report = contractDrift(ctx.root);
    if (!report.contract) return skip("no contracts/openapi.yaml — nothing to compare the code with");
    const problems = [
      ...report.missing.map((op) => `missing ${op.method} ${op.path}`),
      ...report.undocumented.map((e) => `undocumented ${e.method} ${e.route} (${e.file})`),
    ];
    return problems.length
      ? fail(`${report.contract} vs code: ${problems.slice(0, 15).join("; ")}${problems.length > 15 ? "; …" : ""} — implement or remove from the contract; allow infrastructure routes with gates.gap.contractIgnore`)
      : pass(`${report.operations} contract operations all implemented, ${report.endpoints} endpoints all documented${report.suffixMatches.length ? ` (${report.suffixMatches.length} matched under a router prefix)` : ""}`);
  },

  "gap.parity": (ctx) => {
    const report = platformParity(ctx.root);
    if (report.groups.length < 2) return skip(`one UI platform targeted (${report.groups.join(", ") || "none"}) — nothing to compare`);
    if (!report.stories.length) return skip("no PRD or screens to compare");
    return report.gaps.length
      ? fail(`stories without screens on every platform: ${report.gaps.map((g) => `${g.id} (no ${g.missing.join(", ")})`).join("; ")} — design them, or list deliberate single-platform stories in gates.gap.parityExempt`)
      : pass(`${report.stories.length} MVP stories have ${report.groups.join(" + ")} screens${report.stories.some((s) => s.exempt) ? ` (${report.stories.filter((s) => s.exempt).length} exempt)` : ""}`);
  },

  "gap.noPlaceholders": (ctx) => {
    const hits = scanPlaceholders(ctx.root, ctx.config.gates.gap.scanDirs, 20);
    return listOrPass(
      hits.map((hit) => `${hit.file}:${hit.line}`),
      `no placeholder data in ${ctx.config.gates.gap.scanDirs.join(", ")}`,
      "placeholder/fake data found",
    );
  },

  "release.checksPass": (ctx) => {
    const failing = need<Release>(ctx, "release").checks.filter((check) => !check.pass).map((check) => check.name);
    return listOrPass(failing, "all release checks passed", "failing release checks");
  },

  "release.live": async (ctx) => {
    const release = need<Release>(ctx, "release");
    if (!release.url) return pass(`no URL to check (${release.target ?? "release"} without a web endpoint)`);
    const health = new URL(ctx.config.deploy.healthPath, release.url).href;
    const result = await httpStatus(health, bypassHeaders(ctx.root, release.target));
    const detail = describeHttp(result);
    if (answered(result)) return pass(`${health} → ${detail}`);
    return fail(`${health} → ${detail}${result.status === 401 || result.status === 403 || result.offsite ? " — if the deployment is protected, set the target's bypass env var" : ""}`);
  },

  "qa.coverage": (ctx) => {
    const report = qaCoverage(ctx.root);
    const min = ctx.config.gates.qa.minCoverage;
    const pct = Math.round(report.ratio * 100);
    const typos = report.unknownTags.length ? ` (${report.unknownTags.length} tag(s) match no criterion: ${report.unknownTags.slice(0, 5).map((u) => `${u.tag} in ${u.file}`).join(", ")})` : "";
    return report.ratio >= min
      ? pass(`${report.required - report.missing.length}/${report.required} MVP acceptance criteria have a tagged test${typos}`)
      : fail(
          `${pct}% of MVP acceptance criteria have a tagged test, needs ${Math.round(min * 100)}% — missing: ${report.missing
            .slice(0, 12)
            .map((m) => m.id)
            .join(", ")}${report.missing.length > 12 ? ", …" : ""}. Tag the test title with @<story>/AC<n> (forge qa plan)${typos}`,
        );
  },

  "memory.episodeSinceStart": (ctx) => {
    const startedAt = ctx.state.stages[ctx.stage.id]?.startedAt ?? "";
    const episode = listEpisodes(ctx.root).find((item) => item.at >= startedAt);
    return episode ? pass(`episode ${episode.file}`) : fail("no episode saved since this stage started — run `forge memory episode`");
  },
};

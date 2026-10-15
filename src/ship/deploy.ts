import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listPacks, loadPack, onPath } from "../build/stacks.js";
import { loadArtifact, writeArtifact } from "../core/artifacts.js";
import { loadConfig } from "../core/config.js";
import { appendLedger, readLedger } from "../core/ledger.js";
import { layout, nowIso, readJson } from "../core/paths.js";
import { runCommand, withCommandSlot } from "../core/proc.js";
import { tail } from "../core/util.js";
import { redactSecrets } from "../memory/secrets.js";
import type { Prd, Release, Tasks } from "../schemas/artifacts.js";
import { State } from "../schemas/runtime.js";
import type { DeployTarget, StackPack } from "../schemas/stack.js";
import { blockingHeaders, checkHeaders } from "../security/headers.js";

/**
 * Ship: deploy each configured stack with its official CLI, then prove the result —
 * smoke-test the live URL, probe its security headers, run the e2e suite against it —
 * and write the release record and notes from what actually happened. Nothing is
 * faked: a missing CLI, login or project link stops the deploy with the fix.
 */

export type DeployEnv = "preview" | "production";

export interface DeployPlanItem {
  pack: string;
  dir: string;
  kind: StackPack["kind"];
  target?: DeployTarget;
  /** The command that would run (undefined when the target has no command for this env). */
  command?: string;
  /** Why it cannot deploy yet, each with the fix. */
  problems: string[];
}

const KIND_ORDER: Record<StackPack["kind"], number> = { data: 0, service: 1, app: 2 };

/** Which target each configured stack deploys to, and what is missing — without running anything slow. */
export function deployPlan(root: string, env: DeployEnv, only?: string[]): DeployPlanItem[] {
  const config = loadConfig(root);
  if (!config.stacks.length) throw new Error("No stacks configured — run `forge stack use` first");
  const items = config.stacks
    .filter((s) => !only?.length || only.includes(s.pack))
    .map(({ pack: id, dir }): DeployPlanItem => {
      const { pack } = loadPack(id, root);
      const wanted = config.deploy.targets[id];
      const target = wanted ? pack.deploy.find((t) => t.id === wanted) : (pack.deploy.find((t) => onPath(t.bin)) ?? pack.deploy[0]);
      const problems: string[] = [];
      if (!target) {
        problems.push(wanted ? `deploy.targets.${id} = ${wanted}, but ${id} knows: ${pack.deploy.map((t) => t.id).join(", ") || "none"}` : `the ${id} pack has no deploy target`);
        return { pack: id, dir, kind: pack.kind, problems };
      }
      const command = env === "preview" ? target.preview : target.production;
      if (!onPath(target.bin)) problems.push(`${target.bin} is not installed — ${target.login}`);
      for (const req of target.requires) {
        if (!existsSync(resolve(root, dir, req.file))) problems.push(`${dir === "." ? "" : `${dir}/`}${req.file} is missing — ${req.create}`);
      }
      return { pack: id, dir, kind: pack.kind, target, ...(command ? { command } : {}), problems };
    });
  return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export interface DeployStep {
  pack: string;
  target?: string;
  status: "deployed" | "skipped" | "failed" | "blocked";
  url?: string;
  detail: string;
}

export interface DeployResult {
  env: DeployEnv;
  ok: boolean;
  steps: DeployStep[];
  checks: Release["checks"];
  release?: Release;
  notesFile?: string;
}

const AUTH_TIMEOUT = 30_000;

export async function deploy(
  root: string,
  options: { env?: DeployEnv; only?: string[]; timeoutMs?: number; onWait?: () => void } = {},
): Promise<DeployResult> {
  const env = options.env ?? "preview";
  const config = loadConfig(root);
  if (env === "production") {
    const statePath = layout(root).state;
    const approval = existsSync(statePath) ? State.parse(readJson(statePath)).approvals.ship : undefined;
    if (!approval && config.autonomy !== "auto") {
      throw new Error("Production deploys need a human decision first: review the preview release, then run `forge approve ship` (or set autonomy: auto)");
    }
  }
  const plan = deployPlan(root, env, options.only);
  const steps: DeployStep[] = [];
  const checks: Release["checks"] = [];
  const slot = { max: config.resources.maxConcurrentCommands, waitMs: config.resources.commandWaitMs, onWait: options.onWait };

  for (const item of plan) {
    const target = item.target;
    if (!target || item.problems.length) {
      steps.push({ pack: item.pack, ...(target ? { target: target.id } : {}), status: "blocked", detail: item.problems.join("; ") });
      checks.push({ name: `deploy ${item.pack}`, pass: false, detail: item.problems.join("; ") });
      continue;
    }
    if (!item.command) {
      steps.push({ pack: item.pack, target: target.id, status: "skipped", detail: `${target.name} has no ${env} deploy (production only)` });
      continue;
    }
    const cwd = resolve(root, item.dir);
    const auth = await runCommand(target.auth, cwd, { timeoutMs: AUTH_TIMEOUT });
    if (auth.code !== 0 || auth.timedOut) {
      const detail = `not logged in to ${target.name} (\`${target.auth}\` failed) — run \`${target.login}\``;
      steps.push({ pack: item.pack, target: target.id, status: "blocked", detail });
      checks.push({ name: `deploy ${item.pack}`, pass: false, detail });
      continue;
    }
    const command = item.command;
    const result = await withCommandSlot(root, { ...slot, task: `forge deploy ${item.pack}` }, () =>
      runCommand(command, cwd, { timeoutMs: options.timeoutMs ?? 1_200_000 }),
    );
    const output = redactSecrets(result.output);
    const url = target.url ? [...output.matchAll(new RegExp(target.url, "g"))].map((m) => m[0]).at(-1) : undefined;
    const ok = result.code === 0 && !result.timedOut;
    steps.push({
      pack: item.pack,
      target: target.id,
      status: ok ? "deployed" : "failed",
      ...(url ? { url } : {}),
      detail: ok ? `\`${command}\` exited 0` : `\`${command}\` ${result.timedOut ? "timed out" : `exited ${result.code}`}\n${tail(output.trim(), 1_500)}`,
    });
    checks.push({ name: `deploy ${item.pack} (${target.name}, ${env})`, pass: ok, detail: ok ? (url ?? "deployed") : tail(output.trim(), 500) });
    if (ok && target.url && !url) checks.push({ name: `deploy ${item.pack}: URL`, pass: false, detail: "deploy succeeded but no URL was found in its output" });
    if (ok && url) checks.push(...(await verifyDeployment(root, url, target, slot)));
  }

  const ok = steps.length > 0 && steps.every((s) => s.status === "deployed" || s.status === "skipped") && checks.every((c) => c.pass);
  const deployed = steps.filter((s) => s.status === "deployed");
  if (!deployed.length) return { env, ok: false, steps, checks };

  const withUrl = plan.filter((p) => steps.some((s) => s.pack === p.pack && s.url)).sort((a, b) => KIND_ORDER[b.kind] - KIND_ORDER[a.kind]);
  const primaryUrl = steps.find((s) => s.pack === withUrl[0]?.pack)?.url;
  const commit = gitCommit(root);
  const release: Release = {
    version: projectVersion(root),
    ...(commit ? { commit } : {}),
    env,
    ...(primaryUrl ? { url: primaryUrl } : {}),
    at: nowIso(),
    checks,
    rollback: plan
      .filter((p) => p.target && deployed.some((s) => s.pack === p.pack))
      .map((p) => `${p.pack}: ${p.target?.rollback}`)
      .join(" · "),
    target: deployed.map((s) => s.target).join(","),
    source: "forge-deploy",
  };
  release.notes = writeReleaseNotes(root, release, steps);
  writeArtifact(root, "release", release);
  appendLedger(root, {
    kind: "decision",
    stage: "ship",
    summary: `Deployed ${release.version} to ${env}${release.url ? ` at ${release.url}` : ""} — ${ok ? "all checks passed" : "checks failing"}`,
    why: steps.map((s) => `${s.pack}: ${s.status}${s.url ? ` ${s.url}` : ""}`).join("; "),
  });
  return { env, ok, steps, checks, release, notesFile: release.notes };
}

/** Smoke test, security headers and the e2e suite against the live URL. */
async function verifyDeployment(
  root: string,
  url: string,
  target: DeployTarget,
  slot: { max: number; waitMs: number; onWait?: () => void },
): Promise<Release["checks"]> {
  const config = loadConfig(root);
  const bypassValue = target.bypass ? process.env[target.bypass.env] : undefined;
  const headers: Record<string, string> = target.bypass && bypassValue ? { [target.bypass.header]: bypassValue } : {};
  const healthUrl = new URL(config.deploy.healthPath, url).href;
  const checks: Release["checks"] = [];

  const smoke = await httpStatus(healthUrl, headers);
  const protectedHint =
    (smoke.status === 401 || smoke.status === 403) && target.bypass && !bypassValue
      ? ` — the deployment is protected; set ${target.bypass.env} so forge can send ${target.bypass.header}`
      : "";
  const up = smoke.status !== undefined && smoke.status < 400;
  checks.push({ name: `smoke GET ${healthUrl}`, pass: up, detail: smoke.status ? `HTTP ${smoke.status}${protectedHint}` : (smoke.error ?? "no response") });
  if (!up) return checks;

  try {
    const report = await checkHeaders(healthUrl, { headers });
    const blockers = blockingHeaders(report, config.security.failOn);
    checks.push({
      name: "security headers",
      pass: !blockers.length,
      detail: blockers.length ? blockers.map((b) => `${b.id} (${b.severity}): ${b.detail}`).join("; ") : `${report.checks.filter((c) => c.status === "pass").length}/${report.checks.length} pass`,
    });
  } catch (error) {
    checks.push({ name: "security headers", pass: false, detail: (error as Error).message });
  }

  const e2e = config.commands.e2e;
  if (config.deploy.e2e && e2e) {
    const e2eEnv = { ...process.env, BASE_URL: url, PLAYWRIGHT_BASE_URL: url, ...(bypassValue && target.bypass ? { [target.bypass.env]: bypassValue } : {}) };
    const result = await withCommandSlot(root, { ...slot, task: "forge deploy e2e" }, () => runCommand(e2e, root, { timeoutMs: 1_800_000, env: e2eEnv }));
    checks.push({ name: `e2e against ${url}`, pass: result.code === 0 && !result.timedOut, detail: tail(redactSecrets(result.output).trim(), 800) });
  }
  return checks;
}

export async function httpStatus(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<{ status?: number; error?: string }> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "forge-deploy-smoke/1", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status };
  } catch (error) {
    const cause = (error as Error).cause;
    return { error: `unreachable: ${cause instanceof Error ? cause.message : (error as Error).message}` };
  }
}

/** Bypass header for a release's targets, when the env var is set (the ship gate's live check uses it). */
export function bypassHeaders(root: string, targetIds: string | undefined): Record<string, string> {
  if (!targetIds) return {};
  const ids = targetIds.split(",");
  for (const { pack } of listPacks(root)) {
    for (const target of pack.deploy) {
      const value = target.bypass ? process.env[target.bypass.env] : undefined;
      if (ids.includes(target.id) && target.bypass && value) return { [target.bypass.header]: value };
    }
  }
  return {};
}

// ── Release notes ────────────────────────────────────────────────────────────

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitCommit(root: string): string {
  return git(root, "rev-parse", "--short", "HEAD");
}

export function projectVersion(root: string): string {
  try {
    const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version;
    if (version) return version;
  } catch {
    // no root package.json
  }
  const pyproject = existsSync(join(root, "pyproject.toml")) ? readFileSync(join(root, "pyproject.toml"), "utf8") : "";
  const py = /^version\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1];
  if (py) return py;
  return git(root, "describe", "--tags", "--always") || "0.0.0";
}

/** Markdown release notes from what shipped: stories done, decisions since the last release, commits. */
export function releaseNotes(root: string, release: Release, steps: DeployStep[] = []): string {
  const tasks = safe(() => loadArtifact<Tasks>(root, "tasks"))?.tasks ?? [];
  const prd = safe(() => loadArtifact<Prd>(root, "prd"));
  const doneStories = new Set(tasks.filter((t) => t.status === "done").flatMap((t) => t.storyIds));
  const stories = (prd?.stories ?? []).filter((s) => doneStories.has(s.id));
  const ledger = readLedger(root);
  const lastRelease = [...ledger].reverse().find((e) => e.stage === "ship" && /^Deployed /.test(e.summary));
  const decisions = ledger.filter((e) => e.kind === "decision" && e.stage !== "ship" && (!lastRelease || e.at > lastRelease.at)).slice(-15);
  const lastTag = git(root, "describe", "--tags", "--abbrev=0");
  const commits = git(root, "log", "--no-merges", "--pretty=format:- %s (%h)", "-n", "40", ...(lastTag ? [`${lastTag}..HEAD`] : []))
    .split("\n")
    .filter(Boolean);
  return [
    `# Release ${release.version} — ${release.env}`,
    "",
    `- When: ${release.at}${release.commit ? ` · commit ${release.commit}` : ""}`,
    ...(release.url ? [`- URL: ${release.url}`] : []),
    ...steps.filter((s) => s.url && s.url !== release.url).map((s) => `- ${s.pack}: ${s.url}`),
    `- Rollback: ${release.rollback}`,
    "",
    "## Checks",
    ...release.checks.map((c) => `- ${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail.split("\n")[0]}` : ""}`),
    ...(stories.length ? ["", "## What's new", ...stories.map((s) => `- ${s.id}: as ${s.as}, ${s.iWant} — so that ${s.soThat}`)] : []),
    ...(decisions.length ? ["", "## Decisions", ...decisions.map((d) => `- ${d.summary}${d.why ? ` — ${d.why.split(";")[0]}` : ""}`)] : []),
    ...(commits.length ? ["", `## Commits${lastTag ? ` since ${lastTag}` : ""}`, ...commits] : []),
    "",
  ].join("\n");
}

function writeReleaseNotes(root: string, release: Release, steps: DeployStep[]): string {
  const dir = layout(root).releases;
  mkdirSync(dir, { recursive: true });
  const name = `${release.version}-${release.env}-${release.at.replace(/[:.]/g, "-")}.md`.replace(/[^\w.-]/g, "_");
  writeFileSync(join(dir, name), redactSecrets(releaseNotes(root, release, steps)));
  return `.forge/releases/${name}`;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

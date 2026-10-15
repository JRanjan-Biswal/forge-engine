import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ForgeConfig } from "../core/config.js";
import { setting } from "../core/env.js";
import { layout } from "../core/paths.js";
import { runCommand } from "../core/proc.js";
import { loadTasks, nextTasks, planWaves, taskBrief, updateTask } from "./tasks.js";
import { withCommandSlot } from "../core/proc.js";

/**
 * Git worktrees per task, and headless workers that run one task per worktree
 * through an agent CLI — bounded by `workers.maxConcurrent` (default 1, RAM rules),
 * each in its own process group with a timeout. Merging back is left to review.
 */

export function worktreesDir(root: string): string {
  return join(layout(root).forge, "worktrees");
}

function git(root: string, args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

export function createWorktree(root: string, id: string): { path: string; branch: string } {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid task id "${id}"`);
  const path = join(worktreesDir(root), id);
  const branch = `forge/task-${id}`;
  if (existsSync(path)) return { path, branch };
  mkdirSync(worktreesDir(root), { recursive: true });
  const ignore = join(layout(root).forge, ".gitignore");
  const current = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  if (!/^worktrees\/$/m.test(current)) writeFileSync(ignore, `${current}${current.endsWith("\n") || !current ? "" : "\n"}worktrees/\n`);
  const exists = spawnSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", branch]).status === 0;
  git(root, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

export function removeWorktree(root: string, id: string, force = false): void {
  git(root, ["worktree", "remove", ...(force ? ["--force"] : []), join(worktreesDir(root), id)]);
}

export function listWorktrees(root: string): { path: string; branch: string }[] {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  return out
    .split("\n\n")
    .map((block) => ({
      path: /^worktree (.+)$/m.exec(block)?.[1] ?? "",
      branch: (/^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? "").trim(),
    }))
    .filter((w) => w.branch.startsWith("forge/task-"));
}

const HOST_COMMANDS: Record<string, (briefFile: string, extra: string) => string> = {
  claude: (f, extra) => `claude -p "$(cat '${f}')" --output-format json ${extra || "--permission-mode acceptEdits"}`,
  codex: (f, extra) => `codex exec --skip-git-repo-check ${extra || "-s workspace-write"} "$(cat '${f}')"`,
  gemini: (f, extra) => `gemini ${extra} -p "$(cat '${f}')"`,
  opencode: (f, extra) => `opencode run ${extra} "$(cat '${f}')"`,
};

export interface WorkerResult {
  task: string;
  status: "done" | "blocked";
  code: number | null;
  timedOut: boolean;
  worktree: string;
  log: string;
  seconds: number;
}

/**
 * Run the next wave of ready tasks through headless agent workers. A worker that
 * exits 0 marks its task done (review and merge still follow); anything else marks it
 * blocked with the log path. FORGE_WORKER_COMMAND overrides the command template
 * ({brief} is replaced by the brief file) — used in tests and for custom hosts.
 */
export async function runWorkers(
  root: string,
  config: ForgeConfig,
  options: { host?: string; max?: number; tasks?: string[] } = {},
): Promise<WorkerResult[]> {
  const host = options.host ?? config.workers.host;
  const template = setting("FORGE_WORKER_COMMAND");
  if (!template && !HOST_COMMANDS[host]) throw new Error(`Unknown worker host "${host}". Hosts: ${Object.keys(HOST_COMMANDS).join(", ")}`);
  const max = Math.max(1, options.max ?? config.workers.maxConcurrent);
  const all = loadTasks(root);
  const queue = options.tasks ? all.filter((t) => options.tasks?.includes(t.id)) : nextTasks(all);
  const results: WorkerResult[] = [];

  const runOne = async (id: string) => {
    const started = Date.now();
    const { path } = createWorktree(root, id);
    const briefFile = join(worktreesDir(root), `${id}.brief.md`);
    writeFileSync(briefFile, taskBrief(root, id));
    updateTask(root, id, "doing", `worker (${template ? "custom" : host}) started in .forge/worktrees/${id}`);
    const command = template ? template.replaceAll("{brief}", briefFile) : (HOST_COMMANDS[host] as (f: string, e: string) => string)(briefFile, config.workers.args);
    const result = await runCommand(command, path, { timeoutMs: config.workers.timeoutMs });
    const log = join(worktreesDir(root), `${id}.log`);
    writeFileSync(log, result.output);
    const ok = result.code === 0 && !result.timedOut;
    updateTask(root, id, ok ? "done" : "blocked", ok ? "worker finished — review and merge next" : `worker ${result.timedOut ? "timed out" : `exited ${result.code}`}; see .forge/worktrees/${id}.log`);
    results.push({ task: id, status: ok ? "done" : "blocked", code: result.code, timedOut: result.timedOut, worktree: path, log, seconds: Math.round((Date.now() - started) / 1000) });
  };

  // Bounded pool: at most `max` workers alive at once.
  const pending = queue.map((t) => t.id);
  await Promise.all(
    Array.from({ length: Math.min(max, pending.length) }, async () => {
      for (let id = pending.shift(); id; id = pending.shift()) await runOne(id);
    }),
  );
  return results;
}

// ── Merge queue ──────────────────────────────────────────────────────────────

export interface MergeResult {
  task: string;
  status: "merged" | "blocked";
  reason?: string;
}

/**
 * Merge finished task worktrees back, one at a time in wave order: commit leftovers
 * on the task branch, run commands.test inside the worktree (under the command slot),
 * merge --no-ff only if tests pass, abort cleanly on conflict, then remove the worktree.
 */
export async function mergeTasks(root: string, config: ForgeConfig, ids?: string[]): Promise<MergeResult[]> {
  const order = planWaves(loadTasks(root)).flat();
  const candidates = (ids ?? loadTasks(root).filter((t) => t.status === "done").map((t) => t.id))
    .filter((id) => existsSync(join(worktreesDir(root), id)))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const results: MergeResult[] = [];
  for (const id of candidates) {
    const path = join(worktreesDir(root), id);
    const branch = `forge/task-${id}`;
    const block = (reason: string) => {
      updateTask(root, id, "blocked", `merge: ${reason}`);
      results.push({ task: id, status: "blocked", reason });
    };
    const inTree = (args: string[]) => spawnSync("git", ["-C", path, "-c", "user.email=forge@localhost", "-c", "user.name=forge", ...args], { encoding: "utf8" });
    if (inTree(["status", "--porcelain"]).stdout.trim()) {
      inTree(["add", "-A"]);
      inTree(["commit", "-qm", `forge: task ${id}`]);
    }
    const test = config.commands.test;
    if (test) {
      const run = await withCommandSlot(root, { max: config.resources.maxConcurrentCommands, waitMs: config.resources.commandWaitMs, task: `forge merge ${id}` }, () =>
        runCommand(test, path, { timeoutMs: 600_000 }),
      );
      if (run.code !== 0 || run.timedOut) {
        block(`tests failed in the worktree (${run.timedOut ? "timeout" : `exit ${run.code}`}); not merged`);
        continue;
      }
    }
    const merge = spawnSync("git", ["-C", root, "-c", "user.email=forge@localhost", "-c", "user.name=forge", "merge", "--no-ff", "-m", `forge: merge task ${id}`, branch], { encoding: "utf8" });
    if (merge.status !== 0) {
      spawnSync("git", ["-C", root, "merge", "--abort"]);
      block(`merge conflict with the current branch — resolve in .forge/worktrees/${id}, then retry (${(merge.stdout + merge.stderr).trim().split("\n")[0]})`);
      continue;
    }
    removeWorktree(root, id, true);
    spawnSync("git", ["-C", root, "branch", "-D", branch]);
    updateTask(root, id, "done", "merged into the current branch");
    results.push({ task: id, status: "merged" });
  }
  return results;
}

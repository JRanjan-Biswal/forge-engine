import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTasks, nextTasks, planWaves, taskBrief, updateTask } from "../src/build/tasks.js";
import { createWorktree, listWorktrees, mergeTasks, removeWorktree, runWorkers } from "../src/build/workers.js";
import { writeArtifact } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { appendLedger } from "../src/core/ledger.js";
import { isolate, prd, tmpProject } from "./helpers.js";

isolate();
afterEach(() => {
  delete process.env.FORGE_WORKER_COMMAND;
});

const TASKS = {
  tasks: [
    { id: "T-1", title: "Streak store", dept: "backend", storyIds: ["S-1"], files: ["src/store.ts"], acceptance: ["check-ins persist"] },
    { id: "T-2", title: "Check-in API", dept: "backend", storyIds: ["S-1"], deps: ["T-1"], files: ["src/api.ts"] },
    { id: "T-3", title: "Streaks API", dept: "backend", storyIds: ["S-2"], deps: ["T-1"], files: ["src/api.ts"] },
    { id: "T-4", title: "Web screens", dept: "frontend", storyIds: ["S-1", "S-2"], deps: ["T-2"], files: ["app/page.tsx"] },
  ],
};

/** Same DAG, but T-3 owns its own file — so T-2 and T-3 may run in parallel. */
const PARALLEL = { tasks: TASKS.tasks.map((task) => (task.id === "T-3" ? { ...task, files: ["src/streaks.ts"] } : task)) };

function gitProject(): string {
  const root = tmpProject({ autonomy: "auto" });
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@forge.local", "-c", "user.name=t", ...args], { cwd: root });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "init");
  return root;
}

describe("task scheduling", () => {
  it("plans waves from dependencies and keeps file conflicts apart", () => {
    const root = tmpProject();
    writeArtifact(root, "tasks", TASKS);
    expect(planWaves(loadTasks(root))).toEqual([["T-1"], ["T-2"], ["T-3", "T-4"]]);
    expect(() => planWaves([{ ...loadTasks(root)[0]!, deps: ["T-1"] }])).toThrow(/cycle/);
  });

  it("returns runnable tasks and updates status under the lock", () => {
    const root = tmpProject();
    writeArtifact(root, "tasks", TASKS);
    expect(nextTasks(loadTasks(root)).map((t) => t.id)).toEqual(["T-1"]);
    updateTask(root, "T-1", "done");
    expect(nextTasks(loadTasks(root)).map((t) => t.id)).toEqual(["T-2"]); // T-3 shares src/api.ts → later wave
    writeArtifact(root, "tasks", PARALLEL);
    updateTask(root, "T-1", "done", "merged");
    expect(nextTasks(loadTasks(root)).map((t) => t.id)).toEqual(["T-2", "T-3"]);
  });

  it("builds a self-contained brief from stories, contract and decisions", () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "tasks", TASKS);
    writeArtifact(root, "openapi", "openapi: 3.1.0\npaths:\n  /checkins: {}\n");
    appendLedger(root, { kind: "decision", summary: "Streak store uses SQLite", why: "single-file deploys" });
    const brief = taskBrief(root, "T-1");
    expect(brief).toContain("# Task T-1: Streak store");
    expect(brief).toContain("- check-ins persist");
    expect(brief).toMatch(/Given a habit, when I tap check in, then the streak increments/);
    expect(brief).toContain("/checkins");
    expect(brief).toContain("Streak store uses SQLite");
    expect(brief).toMatch(/TDD/);
  });
});

describe("worktrees and headless workers", () => {
  it("creates, lists and removes a git worktree per task", () => {
    const root = gitProject();
    const wt = createWorktree(root, "T-1");
    expect(existsSync(join(wt.path, "forge.config.yaml"))).toBe(true);
    expect(listWorktrees(root).map((w) => w.branch)).toEqual(["forge/task-T-1"]);
    expect(readFileSync(join(root, ".forge", ".gitignore"), "utf8")).toMatch(/^worktrees\/$/m);
    removeWorktree(root, "T-1", true);
    expect(listWorktrees(root)).toEqual([]);
  });

  it("runs ready tasks one at a time, marking success done and failure blocked", async () => {
    const root = gitProject();
    writeArtifact(root, "tasks", PARALLEL);
    updateTask(root, "T-1", "done");
    // T-2 and T-3 are ready; T-3's worker fails.
    process.env.FORGE_WORKER_COMMAND = [
      `node -e "const fs=require('fs');fs.writeFileSync('start',String(Date.now()));`,
      `const brief=fs.readFileSync(process.argv[1],'utf8');setTimeout(()=>{fs.writeFileSync('end',String(Date.now()));`,
      `process.exit(brief.includes('Streaks API')?1:0)},150)" "{brief}"`,
    ].join("");
    const results = await runWorkers(root, loadConfig(root), { max: 1 });
    expect(results.map((r) => [r.task, r.status])).toEqual([
      ["T-2", "done"],
      ["T-3", "blocked"],
    ]);
    const time = (id: string, file: string) => Number(readFileSync(join(root, ".forge/worktrees", id, file), "utf8"));
    expect(time("T-3", "start")).toBeGreaterThanOrEqual(time("T-2", "end")); // max 1 → sequential
    expect(loadTasks(root).find((t) => t.id === "T-3")?.status).toBe("blocked");
    expect(existsSync(join(root, ".forge/worktrees/T-2.brief.md"))).toBe(true);
    writeFileSync(join(root, "noop"), "");
  });

  it("merges green task branches, blocks on failing tests and on conflicts without touching the main branch", async () => {
    const root = gitProject();
    writeArtifact(root, "tasks", PARALLEL);
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@forge.local", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
    git("add", "-A");
    git("commit", "-qm", "tasks");
    for (const id of ["T-1", "T-2", "T-3"]) createWorktree(root, id);
    writeFileSync(join(root, ".forge/worktrees/T-1/store.txt"), "store\n");
    writeFileSync(join(root, ".forge/worktrees/T-2/api.txt"), "from worktree\n");
    writeFileSync(join(root, "api.txt"), "from main\n"); // conflicting file on the main branch
    git("add", "api.txt");
    git("commit", "-qm", "main change");
    writeFileSync(join(root, ".forge/worktrees/T-3/fail.txt"), "x\n");
    for (const id of ["T-1", "T-2", "T-3"]) updateTask(root, id, "done");

    const config = loadConfig(root);
    config.commands.test = `node -e "process.exit(require('fs').existsSync('fail.txt') ? 1 : 0)"`;
    const results = await mergeTasks(root, config);
    expect(results.map((r) => [r.task, r.status])).toEqual([
      ["T-1", "merged"],
      ["T-2", "blocked"],
      ["T-3", "blocked"],
    ]);
    expect(readFileSync(join(root, "store.txt"), "utf8")).toBe("store\n");
    expect(readFileSync(join(root, "api.txt"), "utf8")).toBe("from main\n"); // conflict aborted cleanly
    expect(existsSync(join(root, "fail.txt"))).toBe(false); // failing tests → not merged
    expect(results[1]?.reason).toMatch(/merge conflict/);
    expect(results[2]?.reason).toMatch(/tests failed/);
    expect(listWorktrees(root).map((w) => w.branch).sort()).toEqual(["forge/task-T-2", "forge/task-T-3"]);
    expect(git("status", "--porcelain").stdout).not.toMatch(/^UU/m);
  });
});

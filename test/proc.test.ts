import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pidAlive } from "../src/core/lock.js";
import { runCommand, withCommandSlot } from "../src/core/proc.js";
import { listProjectProcesses } from "../src/core/procs.js";
import { isolate, tempDir } from "./helpers.js";

isolate();

const posix = process.platform !== "win32";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readPid = (file: string) => Number(readFileSync(file, "utf8").trim());

describe.runIf(posix)("runCommand (process-group cleanup)", () => {
  it("captures output and exit codes without leftovers", async () => {
    const result = await runCommand("echo hello; exit 3", tempDir(), { timeoutMs: 5_000 });
    expect(result).toMatchObject({ code: 3, timedOut: false, leftovers: 0 });
    expect(result.output).toContain("hello");
  });

  it("stops background jobs a command leaves running", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "bg.pid");
    const started = Date.now();
    const result = await runCommand(`sleep 30 & echo $! > ${pidFile}`, dir, { timeoutMs: 10_000, graceMs: 500 });
    expect(result.code).toBe(0);
    expect(result.leftovers).toBe(1);
    expect(existsSync(pidFile)).toBe(true);
    expect(pidAlive(readPid(pidFile))).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000); // did not wait for the background job
  });

  it("kills the whole tree on timeout, not just the shell", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "bg.pid");
    const started = Date.now();
    const result = await runCommand(`sleep 30 & echo $! > ${pidFile}; sleep 30`, dir, { timeoutMs: 500, graceMs: 500 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(pidAlive(readPid(pidFile))).toBe(false);
  });
});

describe("withCommandSlot (heavy-job bound)", () => {
  const job = (root: string, max: number, name: string, events: string[], holdMs = 150) =>
    withCommandSlot(root, { max, waitMs: 5_000, task: name }, async () => {
      events.push(`${name}:start`);
      await sleep(holdMs);
      events.push(`${name}:end`);
    });

  it("serialises heavy commands with one slot", async () => {
    const root = tempDir();
    const events: string[] = [];
    await Promise.all([job(root, 1, "a", events), job(root, 1, "b", events)]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs commands in parallel when two slots are configured", async () => {
    const root = tempDir();
    const events: string[] = [];
    await Promise.all([job(root, 2, "a", events), job(root, 2, "b", events)]);
    expect(events.slice(0, 2).sort()).toEqual(["a:start", "b:start"]);
  });

  it("fails with a clear message when slots stay busy", async () => {
    const root = tempDir();
    const holder = job(root, 1, "holder", [], 1_000);
    await sleep(50);
    await expect(withCommandSlot(root, { max: 1, waitMs: 300, task: "late" }, async () => "never")).rejects.toThrow(/command slot/);
    await holder;
  });
});

describe.runIf(posix)("listProjectProcesses", () => {
  it("finds a process running inside the project, with its memory", async () => {
    const dir = tempDir();
    const child = spawn("sleep", ["30"], { cwd: dir, stdio: "ignore" });
    try {
      await sleep(200);
      const found = listProjectProcesses(dir).find((p) => p.pid === child.pid);
      expect(found?.reason).toBe("cwd");
      expect(found?.rssKb).toBeGreaterThan(0);
      expect(found?.command).toContain("sleep");
    } finally {
      child.kill();
    }
  });
});

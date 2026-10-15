import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { layout } from "./paths.js";

/**
 * A cross-process lock for read-modify-write of .forge/ files. The CLI, the MCP
 * server and parallel headless workers can all touch the same project at once;
 * without this, concurrent writers duplicate ledger ids and lose state updates.
 *
 * - Exclusive create (O_EXCL) of the lock file, holding owner metadata.
 * - Reentrant within a process, so locked helpers can call each other.
 * - A lock is reclaimed only when its owner is verifiably gone (dead pid, or the
 *   pid now belongs to a different process). Age alone never reclaims a lock.
 */

export interface LockOwner {
  pid: number;
  host: string;
  /** OS start time of the owning process, used to detect pid reuse. */
  processStartMs?: number;
  acquiredAt: string;
  task: string;
}

const TIMEOUT_MS = 20_000;
/** An unreadable lock (crash mid-write) is reclaimed only after this long. */
const UNREADABLE_GRACE_MS = 30_000;
const depthByFile = new Map<string, number>();
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const HOST = hostname();
const SELF_START_MS = Date.now() - process.uptime() * 1000;

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** OS start time of a process, or undefined where it cannot be read. */
export function processStartMs(pid: number): number | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  const parsed = Date.parse(result.stdout.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function lockOwner(task: string): LockOwner {
  return { pid: process.pid, host: HOST, processStartMs: SELF_START_MS, acquiredAt: new Date().toISOString(), task };
}

function readOwner(file: string): LockOwner | null {
  const text = readFileSync(file, "utf8").trim();
  if (/^\d+$/.test(text)) return { pid: Number(text), host: HOST, acquiredAt: "", task: "legacy" };
  try {
    return JSON.parse(text) as LockOwner;
  } catch {
    return null;
  }
}

/** True only when the lock's owner is verifiably gone. */
export function isStale(file: string): boolean {
  try {
    const owner = readOwner(file);
    if (!owner) return Date.now() - statSync(file).mtimeMs > UNREADABLE_GRACE_MS;
    if (owner.host !== HOST) return false; // cannot verify a process on another machine
    if (!pidAlive(owner.pid)) return true;
    if (owner.processStartMs !== undefined) {
      const actual = processStartMs(owner.pid);
      // ps reports whole seconds; a different start time means the pid was reused.
      if (actual !== undefined && Math.abs(actual - owner.processStartMs) > 2_000) return true;
    }
    return false;
  } catch {
    return false; // released between our checks — just retry
  }
}

/** Try once to create `file` exclusively; reclaims it if its owner is gone. */
export function tryAcquire(file: string, task: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify(lockOwner(task)));
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!isStale(file)) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

export class LockTimeoutError extends Error {
  override name = "LockTimeoutError";
}

/** Lock a project's .forge/ directory. */
export function withLock<T>(root: string, fn: () => T): T {
  return withLockAt(layout(root).forge, fn);
}

/** Lock an arbitrary forge-owned directory (e.g. ~/.forge/global). */
export function withLockAt<T>(dir: string, fn: () => T): T {
  const file = join(dir, ".lock");
  const depth = depthByFile.get(file) ?? 0;
  if (depth > 0) {
    depthByFile.set(file, depth + 1);
    try {
      return fn();
    } finally {
      depthByFile.set(file, depth);
    }
  }

  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + TIMEOUT_MS;
  let delay = 2;
  while (!tryAcquire(file, `forge ${process.argv.slice(2, 4).join(" ")}`.trim())) {
    if (Date.now() > deadline) {
      const owner = (() => {
        try {
          return readOwner(file);
        } catch {
          return null;
        }
      })();
      throw new LockTimeoutError(
        `Timed out waiting for ${file}, held by pid ${owner?.pid ?? "?"} on ${owner?.host ?? "?"} (${owner?.task ?? "unknown task"}). ` +
          "If that process is not running, delete the file.",
      );
    }
    Atomics.wait(sleeper, 0, 0, delay);
    delay = Math.min(delay * 2, 50);
  }

  depthByFile.set(file, 1);
  try {
    return fn();
  } finally {
    depthByFile.delete(file);
    rmSync(file, { force: true });
  }
}

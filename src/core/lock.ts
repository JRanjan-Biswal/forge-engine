import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { layout } from "./paths.js";

/**
 * A cross-process lock for read-modify-write of .forge/ files. The CLI, the MCP
 * server and parallel headless workers can all touch the same project at once;
 * without this, concurrent writers duplicate ledger ids and lose state updates.
 *
 * - Exclusive create (O_EXCL) of .forge/.lock holding the owner's pid.
 * - Reentrant within a process, so locked helpers can call each other.
 * - Locks left by crashed processes (dead pid, or older than STALE_MS) are broken.
 */

const STALE_MS = 30_000;
const TIMEOUT_MS = 20_000;
const depthByFile = new Map<string, number>();
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(file: string): boolean {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) return true;
    return Date.now() - statSync(file).mtimeMs > STALE_MS;
  } catch {
    return false; // released between our checks — just retry
  }
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
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (isStale(file)) {
        rmSync(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new LockTimeoutError(
          `Timed out waiting for ${file} — another forge process is writing. If none is running, delete the file.`,
        );
      }
      Atomics.wait(sleeper, 0, 0, delay);
      delay = Math.min(delay * 2, 50);
    }
  }

  depthByFile.set(file, 1);
  try {
    return fn();
  } finally {
    depthByFile.delete(file);
    rmSync(file, { force: true });
  }
}

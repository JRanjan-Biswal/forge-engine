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
export declare function pidAlive(pid: number): boolean;
/** OS start time of a process, or undefined where it cannot be read. */
export declare function processStartMs(pid: number): number | undefined;
export declare function lockOwner(task: string): LockOwner;
/** True only when the lock's owner is verifiably gone. */
export declare function isStale(file: string): boolean;
/** Try once to create `file` exclusively; reclaims it if its owner is gone. */
export declare function tryAcquire(file: string, task: string): boolean;
export declare class LockTimeoutError extends Error {
    name: string;
}
/** Lock a project's .forge/ directory. */
export declare function withLock<T>(root: string, fn: () => T): T;
/** Lock an arbitrary forge-owned directory (e.g. ~/.forge/global). */
export declare function withLockAt<T>(dir: string, fn: () => T): T;

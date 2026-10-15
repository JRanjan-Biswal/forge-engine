import type { ForgeConfig } from "../core/config.js";
/**
 * Git worktrees per task, and headless workers that run one task per worktree
 * through an agent CLI — bounded by `workers.maxConcurrent` (default 1, RAM rules),
 * each in its own process group with a timeout. Merging back is left to review.
 */
export declare function worktreesDir(root: string): string;
export declare function createWorktree(root: string, id: string): {
    path: string;
    branch: string;
};
export declare function removeWorktree(root: string, id: string, force?: boolean): void;
export declare function listWorktrees(root: string): {
    path: string;
    branch: string;
}[];
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
export declare function runWorkers(root: string, config: ForgeConfig, options?: {
    host?: string;
    max?: number;
    tasks?: string[];
}): Promise<WorkerResult[]>;
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
export declare function mergeTasks(root: string, config: ForgeConfig, ids?: string[]): Promise<MergeResult[]>;

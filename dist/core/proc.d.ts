export interface CommandResult {
    code: number | null;
    output: string;
    timedOut: boolean;
    /** Processes still alive in the command's group after it exited; forge stopped them. */
    leftovers: number;
}
/** PIDs currently in a process group (POSIX). */
export declare function groupMembers(pgid: number): number[];
export declare function runCommand(command: string, cwd: string, options: {
    timeoutMs: number;
    graceMs?: number;
    maxOutputChars?: number;
    env?: NodeJS.ProcessEnv;
}): Promise<CommandResult>;
/**
 * Run `fn` while holding one of `max` per-project command slots. Waits (bounded by
 * waitMs) while every slot is held by a live process; reclaims slots whose owner died.
 */
export declare function withCommandSlot<T>(root: string, options: {
    max: number;
    waitMs: number;
    task: string;
    onWait?: () => void;
}, fn: () => Promise<T>): Promise<T>;

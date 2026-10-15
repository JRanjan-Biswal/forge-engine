/**
 * Read-only process inspection for the process-lifecycle protocol
 * (rules/process-lifecycle.md): what is running for this project, and how much
 * memory it holds. Never starts or stops anything.
 */
export interface ProcessInfo {
    pid: number;
    ppid: number;
    pgid: number;
    user: string;
    /** Resident set size in KB (physical memory currently mapped; not virtual size). */
    rssKb: number;
    started: string;
    command: string;
    cwd: string | null;
    /** Why it belongs to the project: its cwd is inside the root, its command names the root, or it descends from one that does. */
    reason: "cwd" | "command" | "descendant";
}
export declare function listProjectProcesses(root: string): ProcessInfo[];
export interface MemorySnapshot {
    totalGb: number;
    /** Share of memory the OS reports as available. On macOS this comes from memory_pressure. */
    freePercent: number;
    source: "memory_pressure" | "os.freemem";
}
export declare function memorySnapshot(): MemorySnapshot;
/** Starter AGENT_PROCESSES.md for a project (see rules/process-lifecycle.md). */
export declare function registryTemplate(root: string, at?: string): string;

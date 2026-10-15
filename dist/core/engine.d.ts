import { State, StageState, type Blocker, type GateResult, type StageStatus } from "../schemas/runtime.js";
import { type ForgeConfig } from "./config.js";
import { type InitOptions, type InitResult } from "./init.js";
import { type Layout } from "./paths.js";
import { type StageDef } from "./stages.js";
export declare class ForgeError extends Error {
    name: string;
}
export interface StageStatusRow {
    id: string;
    title: string;
    command: string;
    status: StageStatus;
    gateRuns: number;
    lastFailures: string[];
}
export interface StatusReport {
    root: string;
    project: string;
    autonomy: ForgeConfig["autonomy"];
    current: string | null;
    next: string | null;
    nextCommand: string | null;
    archived: State["archived"] | null;
    blockers: Blocker[];
    stages: StageStatusRow[];
}
/**
 * The deterministic spine of forge. Agents decide *how* to do a stage;
 * this class decides *whether* a stage is done, and what comes next.
 * State is re-read from disk on every call and every mutation runs under a
 * cross-process lock, so the CLI, the MCP server and parallel workers can
 * share one project safely.
 */
export declare class Forge {
    readonly root: string;
    readonly paths: Layout;
    constructor(root?: string);
    static init(root: string, options?: InitOptions): InitResult;
    get initialized(): boolean;
    config(): ForgeConfig;
    stages(): StageDef[];
    stage(id: string): StageDef;
    readState(): State;
    private writeState;
    /** Read state, apply `change`, write it back — all under the project lock. */
    private mutate;
    private stageState;
    private assertOpen;
    /** Earlier enabled stages that are not yet passed, skipped or overridden. */
    unfinishedBefore(state: State, id: string): string[];
    next(state?: State): StageDef | null;
    status(): StatusReport;
    start(id: string, options?: {
        force?: boolean;
    }): StageState;
    private assertCompletable;
    /**
     * Run the stage gate. The stage passes only if no check fails. Gate commands
     * (builds, test suites) run outside the lock; the result is then applied to
     * freshly read state under the lock.
     */
    complete(id: string): Promise<GateResult>;
    skip(id: string, reason: string, by?: string): StageState;
    /** Mark a stage done despite its gate. Always recorded with the reason. */
    override(id: string, reason: string, by?: string): StageState;
    private settle;
    approve(id: string, by?: string, note?: string): void;
    /** Re-open a stage (and optionally every later stage) for another iteration. */
    reopen(id: string, reason: string, options?: {
        cascade?: boolean;
    }): string[];
    archive(reason: string): void;
    addBlocker(need: string, stage?: string): Blocker;
    resolveBlocker(id: string, note?: string): Blocker;
}

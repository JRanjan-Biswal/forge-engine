import type { Tasks } from "../schemas/artifacts.js";
import { StackPack, type CommandKey } from "../schemas/stack.js";
export interface LoadedPack {
    pack: StackPack;
    dir: string;
    source: "builtin" | "project";
}
/** Project packs (`.forge/stack-packs/<id>/pack.yaml`) override built-ins with the same id. */
export declare function listPacks(root?: string): LoadedPack[];
export declare function loadPack(id: string, root?: string): LoadedPack;
/** The pack's conventions and review lens (markdown). */
export declare function readLens(id: string, root?: string): string;
/** One `## Heading` section of a markdown document, without the heading. */
export declare function lensSection(markdown: string, heading: string): string;
export interface Detection {
    pack: string;
    dir: string;
    /** Why it matched, e.g. "dependency next", "file supabase/config.toml". */
    evidence: string[];
}
export declare function detectStacks(root: string): Detection[];
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export declare function onPath(bin: string): boolean;
/** Lockfile in the stack directory or any parent up to the root, then `packageManager`, then what is installed. */
export declare function packageManager(root: string, dir?: string): PackageManager;
export interface StackCommands {
    pack: string;
    dir: string;
    packageManager: PackageManager;
    /** Commands to run from the stack directory. */
    commands: Partial<Record<CommandKey, string>>;
    /** Commands the pack knows but the repo cannot run yet, with how to enable them. */
    missing: {
        key: CommandKey;
        why: string;
        fix?: string;
    }[];
}
export declare function stackCommands(root: string, packId: string, dir?: string): StackCommands;
/** One root-level command per gate key across all stacks (each runs in its own directory). */
export declare function combineCommands(stacks: StackCommands[]): Partial<Record<CommandKey, string>>;
export interface StackUseResult {
    stacks: StackCommands[];
    /** Commands written to forge.config.yaml. */
    set: Partial<Record<CommandKey, string>>;
    /** Already-configured commands that were left as they are (pass force to replace). */
    kept: Partial<Record<CommandKey, {
        current: string;
        suggested: string;
    }>>;
    detected: Detection[];
}
/**
 * Record stacks in forge.config.yaml and fill empty gate commands from them. Without
 * `pack`, uses what `detectStacks` finds. Existing commands are kept unless `force`.
 */
export declare function useStacks(root: string, options?: {
    pack?: string;
    dir?: string;
    force?: boolean;
}): StackUseResult;
type TaskShape = Pick<Tasks["tasks"][number], "dept" | "files">;
/** Configured stacks that a task touches: by file paths first, then by department, else the only one. */
export declare function stacksForTask(root: string, task: TaskShape): {
    pack: string;
    dir: string;
}[];
/** Markdown for the "Stack" part of a task brief. */
export declare function stackBrief(root: string, task: TaskShape): string[];
export interface ScaffoldPlan {
    pack: string;
    dir: string;
    packageManager: PackageManager;
    /** Run from the project root. */
    command: string;
    /** Run inside `dir` afterwards. */
    then: string[];
    docs: string;
}
export declare function scaffoldPlan(root: string, packId: string, options?: {
    dir?: string;
    pm?: string;
}): ScaffoldPlan;
export interface ScaffoldResult extends ScaffoldPlan {
    ok: boolean;
    failedStep?: string;
    output: string;
    use?: StackUseResult;
}
/**
 * Run the official generator (network, installs dependencies — one heavy job, in its
 * own process group, holding the project's command slot), then record the stack.
 */
export declare function scaffoldStack(root: string, packId: string, options?: {
    dir?: string;
    pm?: string;
    timeoutMs?: number;
    onWait?: () => void;
}): Promise<ScaffoldResult>;
export {};

import { type StackUseResult } from "../build/stacks.js";
import { type SyncResult } from "./sync.js";
export interface AdoptResult {
    root: string;
    initialized: boolean;
    skipped: string[];
    /** Stack packs found in the repo and the gate commands filled from them (absent when none matched). */
    stacks?: StackUseResult;
    sync: SyncResult;
}
export declare function adoptProject(rootInput: string, options?: {
    name?: string;
    graph?: boolean;
}): Promise<AdoptResult>;

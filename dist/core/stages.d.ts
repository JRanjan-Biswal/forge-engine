import { GateCheck } from "../schemas/runtime.js";
import type { ForgeConfig } from "./config.js";
export interface StageDef {
    id: string;
    title: string;
    department: string;
    /** Slash command that runs this stage's team. */
    command: string;
    /** Only enabled when this pack is listed in forge.config.yaml `packs`. */
    pack?: string;
    outputs: string[];
    /** In autonomy=checkpoint, stages marked checkpoint need human approval. */
    checkpoint: boolean;
    summary: string;
    gate: GateCheck[];
}
export declare const STAGES: readonly StageDef[];
export declare function findStage(id: string): StageDef | undefined;
/** Stages in pipeline order, minus packs that are not enabled and stages listed in stages.skip. */
export declare function enabledStages(config: ForgeConfig): StageDef[];
export declare const HUMAN_CHECK: GateCheck;

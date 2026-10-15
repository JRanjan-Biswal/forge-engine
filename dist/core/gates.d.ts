import { type Validation } from "../schemas/artifacts.js";
import type { CheckResult, GateCheck, GateResult, State } from "../schemas/runtime.js";
import type { ForgeConfig } from "./config.js";
import { type StageDef } from "./stages.js";
export interface GateContext {
    root: string;
    config: ForgeConfig;
    stage: StageDef;
    state: State;
}
interface Outcome {
    status: CheckResult["status"];
    message: string;
}
/** Checks for a stage, adding a human approval check to every stage when autonomy=strict. */
export declare function gateChecks(stage: StageDef, config: ForgeConfig): GateCheck[];
export declare function runGate(ctx: GateContext, run: number): Promise<GateResult>;
export declare function validationScore(validation: Validation): number;
type Builtin = (ctx: GateContext) => Outcome | Promise<Outcome>;
export declare const BUILTINS: Record<string, Builtin>;
export {};

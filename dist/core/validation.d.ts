import type { z } from "zod";
import type { Validation, ValidationCriterion } from "../schemas/artifacts.js";
type CriterionInput = z.input<typeof ValidationCriterion>;
/**
 * The standard binary scorecard. Each question is answered yes / no / unknown,
 * and every "yes" must cite saved evidence. Weights reflect how much each
 * criterion predicts whether the idea is worth building.
 */
export declare const STANDARD_CRITERIA: Omit<CriterionInput, "answer">[];
export declare function validationTemplate(idea: string): z.input<typeof Validation>;
export interface ScoreReport {
    score: number;
    yes: string[];
    no: string[];
    unknown: string[];
    unsupportedYes: string[];
    /** A suggestion only — the verdict is a judgement for the scorer agent and the human. */
    suggestedVerdict: Validation["verdict"];
    reason: string;
}
export declare function scoreValidation(criteria: Validation["criteria"], minScore?: number): ScoreReport;
export {};

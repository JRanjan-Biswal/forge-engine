export type LearningScope = "project" | "global";
export interface Learning {
    scope: LearningScope;
    text: string;
}
/** Append a lesson. Project lessons live in the repo; global ones in ~/.forge/global. */
export declare function addLearning(root: string, text: string, options?: {
    source?: string;
    scope?: LearningScope;
}): Learning;
export declare function listLearnings(root: string, scope?: LearningScope | "all"): Learning[];

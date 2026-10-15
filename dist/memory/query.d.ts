import { type GraphResult } from "./graphify.js";
export type Intent = "status" | "why" | "coverage" | "code" | "history" | "spec";
export type MemorySource = "state" | "ledger" | "episode" | "learning" | "artifact" | "gaps" | "graph" | "product";
export declare function classifyIntent(question: string): Intent;
export declare function terms(question: string): string[];
interface Doc {
    source: MemorySource;
    ref: string;
    text: string;
}
export interface MemoryHit extends Doc {
    score: number;
}
export interface MemoryAnswer {
    question: string;
    intent: Intent;
    hits: MemoryHit[];
    graph?: GraphResult;
    /** Hits rendered as cited lines, trimmed to the token budget. */
    text: string;
}
/**
 * Answer "what has been built, why, and what's left" from every memory layer,
 * with a citation per hit. graphify is consulted for code questions (or when
 * nothing else matched) if it is installed and a graph exists.
 */
export declare function queryMemory(root: string, question: string, options?: {
    budgetTokens?: number;
    useGraph?: boolean;
}): Promise<MemoryAnswer>;
export {};

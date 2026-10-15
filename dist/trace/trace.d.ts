import { type Trace } from "../schemas/artifacts.js";
/** What every MVP story needs before it can ship. */
export declare const STORY_REQUIREMENTS: readonly ["designedBy", "implementedBy", "verifiedBy"];
export type StoryRequirement = (typeof STORY_REQUIREMENTS)[number];
export interface Gap {
    story: string;
    missing: StoryRequirement;
    message: string;
}
export interface GapReport {
    coverage: number;
    required: number;
    satisfied: number;
    gaps: Gap[];
    notes: string[];
}
/** Compare the PRD's MVP stories against the traceability graph and screen inventory. */
export declare function computeGaps(root: string): GapReport;
/** Add a typed edge (and its nodes) to .forge/graph/trace.json. Node ids are "<type>:<name>". */
export declare function linkTrace(root: string, from: string, to: string, type: string): Trace;
export interface PlaceholderHit {
    file: string;
    line: number;
    text: string;
}
export declare function scanPlaceholders(root: string, dirs: string[], limit?: number): PlaceholderHit[];

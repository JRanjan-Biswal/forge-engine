/**
 * QA plan and coverage: every acceptance criterion of an MVP story is a test case
 * with a stable id (`S-1/AC1`). Tests claim a case by carrying the tag `@S-1/AC1` in
 * their title, tag list or a comment (Playwright, Vitest/Jest, pytest, Maestro).
 * Coverage is computed from the test files on disk; the e2e/test commands prove the
 * tagged tests actually pass.
 */
export interface QaCase {
    id: string;
    story: string;
    text: string;
    /** Where the story's screens live: web → Playwright, ios/android → Maestro, none → API tests. */
    tool: "playwright" | "maestro" | "api";
    suggestedFile: string;
}
export interface QaCoverage {
    required: number;
    covered: {
        id: string;
        files: string[];
    }[];
    missing: QaCase[];
    ratio: number;
    /** Tags in tests that match no acceptance criterion (typos or removed stories). */
    unknownTags: {
        tag: string;
        file: string;
    }[];
    testFiles: number;
}
export declare function qaPlan(root: string): QaCase[];
export declare function qaCoverage(root: string, options?: {
    link?: boolean;
}): QaCoverage;

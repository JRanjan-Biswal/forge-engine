/**
 * CI checks for any repository (used by the forge review-action and gap-action):
 * the same deterministic checks as the verify and gap gates, reported as GitHub
 * annotations (inline on the PR diff) and a job summary. No LLM involved.
 */
export type CheckKind = "review" | "gap";
type Level = "error" | "warning" | "notice";
export interface Annotation {
    level: Level;
    title: string;
    message: string;
    file?: string;
    line?: number;
}
export interface CheckSection {
    name: string;
    status: "pass" | "fail" | "skip";
    summary: string;
    annotations: Annotation[];
}
export interface CiCheckResult {
    kind: CheckKind;
    ok: boolean;
    sections: CheckSection[];
}
export declare function runCiCheck(root: string, kind: CheckKind): CiCheckResult;
/** Workflow commands that GitHub turns into annotations (inline on the PR diff when file/line are set). */
export declare function githubAnnotations(result: CiCheckResult, max?: number): string[];
export declare function markdownSummary(result: CiCheckResult): string;
/** Print annotations and append the job summary when running in GitHub Actions. */
export declare function reportToGithub(result: CiCheckResult, out: (line: string) => void): void;
export {};

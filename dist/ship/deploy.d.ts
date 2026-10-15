import type { Release } from "../schemas/artifacts.js";
import type { DeployTarget, StackPack } from "../schemas/stack.js";
/**
 * Ship: deploy each configured stack with its official CLI, then prove the result —
 * smoke-test the live URL, probe its security headers, run the e2e suite against it —
 * and write the release record and notes from what actually happened. Nothing is
 * faked: a missing CLI, login or project link stops the deploy with the fix.
 */
export type DeployEnv = "preview" | "production";
export interface DeployPlanItem {
    pack: string;
    dir: string;
    kind: StackPack["kind"];
    target?: DeployTarget;
    /** The command that would run (undefined when the target has no command for this env). */
    command?: string;
    /** Why it cannot deploy yet, each with the fix. */
    problems: string[];
}
/** Which target each configured stack deploys to, and what is missing — without running anything slow. */
export declare function deployPlan(root: string, env: DeployEnv, only?: string[]): DeployPlanItem[];
export interface DeployStep {
    pack: string;
    target?: string;
    status: "deployed" | "skipped" | "failed" | "blocked";
    url?: string;
    detail: string;
}
export interface DeployResult {
    env: DeployEnv;
    ok: boolean;
    steps: DeployStep[];
    checks: Release["checks"];
    release?: Release;
    notesFile?: string;
}
export declare function deploy(root: string, options?: {
    env?: DeployEnv;
    only?: string[];
    timeoutMs?: number;
    onWait?: () => void;
}): Promise<DeployResult>;
export interface HttpCheck {
    status?: number;
    /** The same-origin URL that finally answered (after following same-origin redirects). */
    finalUrl?: string;
    /** Set when the app redirected to another site (login wall, deployment protection, parked domain). */
    offsite?: string;
    error?: string;
}
/**
 * GET a deployed URL, following redirects only within its own origin. A redirect to
 * another host (e.g. a protected preview bouncing to the platform's login) is NOT the
 * app answering — following it would turn a login page into a passing smoke test.
 */
export declare function httpStatus(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<HttpCheck>;
/** Did the app itself answer successfully? */
export declare const answered: (check: HttpCheck) => boolean;
export declare function describeHttp(check: HttpCheck, target?: DeployTarget, bypassSet?: boolean): string;
/** Bypass header for a release's targets, when the env var is set (the ship gate's live check uses it). */
export declare function bypassHeaders(root: string, targetIds: string | undefined): Record<string, string>;
export declare function projectVersion(root: string): string;
/** Markdown release notes from what shipped: stories done, decisions since the last release, commits. */
export declare function releaseNotes(root: string, release: Release, steps?: DeployStep[]): string;

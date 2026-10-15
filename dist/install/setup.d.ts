/**
 * `forge-engine setup`: install (or remove) the forge-engine plugin in the agent
 * hosts found on this machine, with their own plugin CLIs — Claude Code
 * (`claude plugin …`) and Codex (`codex plugin …`). Shows the exact commands first;
 * runs nothing without confirmation. Commands run as argument arrays (no shell).
 */
export declare const PLUGIN = "forge-engine";
export declare const REPO = "JRanjan-Biswal/forge-engine";
export type Host = "claude" | "codex";
export type Scope = "user" | "project" | "local";
export interface SetupStep {
    host: Host;
    label: string;
    argv: string[];
}
export interface SetupPlan {
    action: "install" | "remove";
    hosts: {
        host: Host;
        found: boolean;
    }[];
    steps: SetupStep[];
    notes: string[];
}
export interface SetupOptions {
    hosts?: Host[];
    /** Marketplace source: a local path or owner/repo (default: the GitHub repo, for both hosts). */
    source?: string;
    scope?: Scope;
    remove?: boolean;
}
export declare function setupPlan(options?: SetupOptions): SetupPlan;
export interface StepResult extends SetupStep {
    ok: boolean;
    output: string;
}
export interface SetupResult {
    plan: SetupPlan;
    results: StepResult[];
    verified: {
        host: Host;
        installed: boolean;
        detail: string;
    }[];
}
/** Is the plugin installed (and enabled) according to the host's own CLI? */
export declare function verifyHost(host: Host): {
    installed: boolean;
    detail: string;
};
/** Run every step in order; a failed step stops that host's remaining steps. Then verify each host. */
export declare function runSetup(plan: SetupPlan, onStep?: (step: SetupStep) => void): SetupResult;
export declare const quoteArgv: (argv: string[]) => string;

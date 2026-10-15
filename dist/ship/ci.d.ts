/**
 * GitHub Actions workflow generated from the configured stacks: one job per stack
 * that installs with its lockfile and runs exactly the gate commands forge would run
 * (build, lint, test, audit, e2e), plus a job running forge's security scan.
 */
export declare const WORKFLOW_PATH = ".github/workflows/forge.yml";
export interface CiResult {
    path: string;
    written: boolean;
    jobs: string[];
    notes: string[];
    yaml: string;
}
export declare function generateWorkflow(root: string): {
    yaml: string;
    jobs: string[];
    notes: string[];
};
export declare function writeWorkflow(root: string, options?: {
    force?: boolean;
}): CiResult;

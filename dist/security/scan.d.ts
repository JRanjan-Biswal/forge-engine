import { type Severity } from "./rules.js";
/**
 * Deterministic security scan of the repository: dangerous sinks fed by input
 * (rules.ts), committed credentials, and environment files that are not ignored.
 *
 * Suppress a finding only with a reason, on the same line or the line above:
 *   // forge-security-ignore js.eval -- evaluates a constant expression built at compile time
 * A whole file: `forge-security-ignore-file -- <reason>` in its first 10 lines.
 * Suppressions without a reason (at least 3 words) are ignored and reported.
 */
export interface SecurityFinding {
    rule: string;
    title: string;
    severity: Severity;
    cwe: string;
    file: string;
    line: number;
    snippet: string;
    fix: string;
}
export interface Suppression {
    rule: string;
    file: string;
    line: number;
    reason: string;
}
export interface ScanResult {
    findings: SecurityFinding[];
    suppressed: Suppression[];
    /** Suppression comments that were ignored because they gave no reason. */
    invalidSuppressions: {
        file: string;
        line: number;
        text: string;
    }[];
    filesScanned: number;
    counts: Record<Severity, number>;
}
export declare const severityRank: (s: Severity) => number;
export declare function scanSecurity(root: string, options?: {
    ignore?: string[];
    includeTests?: boolean;
}): ScanResult;
/** Findings at or above `failOn` block the gate. */
export declare function blocking(result: ScanResult, failOn: Severity): SecurityFinding[];
/**
 * File scan findings into the `reviews` artifact (category `security:<rule>`), once
 * per rule+file+line, so the review → fix → verify loop tracks them. The verify gate
 * still re-runs the scan itself — editing a finding's status cannot hide a sink.
 */
export declare function recordFindings(root: string, result: ScanResult): {
    added: number;
    total: number;
};

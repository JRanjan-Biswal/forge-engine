import type { Severity } from "./rules.js";
/**
 * Live check of a running app's HTTP response: security headers (CSP, HSTS,
 * clickjacking, nosniff, referrer, permissions, isolation), cookie flags, CORS
 * behaviour for a foreign Origin, and information leaks. One GET, no redirects
 * followed, short timeout — safe to point at a local dev server or a preview URL.
 */
export interface HeaderCheck {
    id: string;
    status: "pass" | "fail" | "warn" | "info";
    /** Severity when the check fails or warns. */
    severity: Severity;
    detail: string;
    fix?: string;
}
export interface HeaderReport {
    url: string;
    status: number;
    contentType: string;
    kind: "html" | "api";
    https: boolean;
    checks: HeaderCheck[];
}
/** An origin no app allow-lists; if it is echoed back, the policy reflects any origin. */
export declare const PROBE_ORIGIN = "https://forge-cors-probe.invalid";
export declare function checkHeaders(url: string, options?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
}): Promise<HeaderReport>;
/** Pure analysis — exported for tests and for headers captured elsewhere. */
export declare function analyzeHeaders(url: string, status: number, headers: Headers): HeaderReport;
/** Failing checks at or above `failOn`. */
export declare function blockingHeaders(report: HeaderReport, failOn: Severity): HeaderCheck[];

/**
 * Static security rules: line patterns for dangerous sinks fed by dynamic input
 * (injection, XSS, traversal, SSRF, deserialization, TLS, CORS). They aim for few
 * false positives — a match means "a human or the security-reviewer must look", and
 * the gate fails only on critical/high matches that are not suppressed with a reason.
 */
export type Severity = "critical" | "high" | "medium" | "low";
export type Lang = "js" | "py" | "template";
export interface Rule {
    id: string;
    title: string;
    severity: Severity;
    cwe: string;
    langs: Lang[];
    pattern: RegExp;
    /** The line is fine when this also matches (e.g. a sanitizer or a safe loader). */
    unless?: RegExp;
    /** Only report when the whole file also matches (multi-line configurations). */
    fileAlso?: RegExp;
    fix: string;
}
export declare const RULES: Rule[];

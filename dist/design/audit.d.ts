export declare function contrastRatio(fg: string, bg: string): number | null;
export interface ContrastResult {
    theme: string;
    fg: string;
    bg: string;
    ratio: number | null;
    min: number;
    pass: boolean;
    note?: string;
}
export interface ContrastReport {
    declared: boolean;
    results: ContrastResult[];
    errors: string[];
}
/** Check every pair in design/contrast.json in the base theme and every override theme. */
export declare function auditContrast(root: string): ContrastReport;
export interface DriftHit {
    file: string;
    line: number;
    value: string;
    /** A token with exactly this value, if one exists. */
    suggest?: string;
}
export declare function auditDrift(root: string, dirs: string[], limit?: number): DriftHit[];

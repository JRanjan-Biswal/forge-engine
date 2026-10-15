export interface Operation {
    method: string;
    path: string;
    key: string;
}
export interface DriftReport {
    contract?: string;
    operations: number;
    endpoints: number;
    /** In the contract, not found in the code. */
    missing: Operation[];
    /** Served by the code, not in the contract. */
    undocumented: {
        method: string;
        route: string;
        file: string;
    }[];
    /** Matched only by path suffix (a router mounted under a prefix forge cannot see). */
    suffixMatches: {
        operation: string;
        route: string;
        file: string;
    }[];
}
export declare function findContract(root: string): string | undefined;
/** Operations from an OpenAPI document, with the servers[0] base path applied and {params} normalised. */
export declare function contractOperations(root: string, file: string): Operation[];
export declare function contractDrift(root: string): DriftReport;
export interface ParityReport {
    /** UI platform groups the project targets (web, mobile). */
    groups: string[];
    stories: {
        id: string;
        has: string[];
        missing: string[];
        exempt: boolean;
    }[];
    gaps: {
        id: string;
        missing: string[];
    }[];
}
export declare function platformParity(root: string): ParityReport;

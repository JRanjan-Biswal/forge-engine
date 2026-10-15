import type { Surface } from "../schemas/product.js";
/** Project files relative to root; uses `git ls-files` (honours .gitignore) when possible. */
export declare function listProjectFiles(root: string): string[];
/** Cheap staleness fingerprint: paths, sizes and mtimes of code, docs and manifests. */
export declare function fingerprint(root: string, files: string[]): {
    files: number;
    hash: string;
};
export interface Extraction {
    surfaces: Surface[];
    frameworks: string[];
    calls: {
        from: string;
        to: string;
        literal: string;
    }[];
    docs: {
        path: string;
        title: string;
        bytes: number;
    }[];
}
/** Normalise a route or a client-side URL literal for matching: params → ":p". */
export declare function routeKey(route: string): string;
export declare function extractProduct(root: string, files: string[]): Extraction;

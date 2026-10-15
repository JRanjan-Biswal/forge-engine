import { PageAudit, ProductMap } from "../schemas/product.js";
/**
 * Keeps forge's understanding of an existing product in sync with its code:
 * product map (pages, endpoints, calls, docs) + graphify code graph + traceability
 * graph, all regenerated from the code — never edited by hand.
 */
export declare const MAP_ORIGIN = "product-map";
export declare function loadProductMap(root: string): ProductMap | undefined;
export interface ProductCheck {
    mapExists: boolean;
    stale: boolean;
    reason: string;
    files: number;
}
/** Fast staleness check (no extraction): has any code, doc or manifest changed since the last sync? */
export declare function checkProduct(root: string): ProductCheck;
export interface SyncDiff {
    firstSync: boolean;
    added: string[];
    removed: string[];
    changed: boolean;
}
export interface SyncResult {
    map: ProductMap;
    diff: SyncDiff;
    /** Product-model features that reference surfaces or files that no longer exist. */
    staleFeatures: {
        feature: string;
        missing: string[];
    }[];
}
/** Rebuild the product map (and the code graph, unless graph=false) and connect it into the trace graph. */
export declare function syncProduct(root: string, options?: {
    graph?: boolean;
}): Promise<SyncResult>;
export declare function savePageAudit(root: string, slug: string, data: unknown): {
    path: string;
    open: number;
};
export declare function listPageAudits(root: string): (PageAudit & {
    slug: string;
})[];
export declare function installGitHooks(root: string): string[];

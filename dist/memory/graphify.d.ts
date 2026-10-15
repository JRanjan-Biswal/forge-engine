/**
 * Bridge to graphify (https://pypi.org/project/graphifyy/), the code knowledge graph.
 * graphify is optional: every function degrades to a clear "not available" result.
 */
export declare const GRAPHIFY_INSTALL_HINT = "install graphify with `uv tool install graphifyy` (or `pip install graphifyy`)";
export declare function findGraphify(): string | null;
export interface GraphStatus {
    installed: boolean;
    binary: string | null;
    graphPath: string;
    graphExists: boolean;
}
export declare function graphStatus(root: string): GraphStatus;
export interface GraphResult {
    ok: boolean;
    output: string;
    error?: string;
}
export declare function graphQuery(root: string, question: string, budget?: number): Promise<GraphResult>;
export declare function graphPathBetween(root: string, from: string, to: string): Promise<GraphResult>;
export declare function graphExplain(root: string, node: string): Promise<GraphResult>;
/** Incremental, LLM-free re-extraction of code files (`graphify update <root>`). */
export declare function graphUpdate(root: string): Promise<GraphResult>;

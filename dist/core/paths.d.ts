export declare const FORGE_DIR = ".forge";
export declare const CONFIG_FILE = "forge.config.yaml";
/**
 * Resolve the project root: FORGE_ROOT if set, otherwise the nearest ancestor of
 * `start` (default: cwd) containing .forge/ or forge.config.yaml, otherwise `start`.
 */
export declare function findRoot(start?: string): string;
export declare function layout(root: string): {
    root: string;
    forge: string;
    config: string;
    state: string;
    ledger: string;
    artifacts: string;
    gates: string;
    episodes: string;
    learnings: string;
    graphDir: string;
    trace: string;
    reviews: string;
    releases: string;
    adr: string;
    graphifyGraph: string;
};
export type Layout = ReturnType<typeof layout>;
/** User-level forge directory (~/.forge), overridable with FORGE_HOME. */
export declare function forgeHome(): string;
export declare function nowIso(): string;
export declare function readJson(path: string): unknown;
/** Write via a temp file + rename so a crash never leaves half-written state. */
export declare function writeTextAtomic(path: string, text: string): void;
export declare function writeJsonAtomic(path: string, data: unknown): void;

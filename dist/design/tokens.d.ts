/**
 * Design-token pipeline (W3C DTCG): load design/tokens/*.tokens.json, apply theme
 * overrides (*.<theme>.tokens.json, e.g. semantic.dark.tokens.json), resolve
 * {alias.references}, validate types, and export CSS custom properties, a Tailwind
 * v4 @theme block, a typed TS theme and flat JSON — one source for every platform.
 */
export interface Token {
    path: string;
    type: string;
    value: unknown;
    description?: string;
    file: string;
}
export interface TokenSet {
    /** Resolved base tokens. */
    base: Map<string, Token>;
    /** Resolved full token set per theme (base + overrides). */
    themes: Record<string, Map<string, Token>>;
    errors: string[];
    warnings: string[];
    files: string[];
}
export declare function tokensDir(root: string): string;
export declare function loadTokens(root: string): TokenSet;
export interface BuildResult {
    tokens: number;
    themes: string[];
    files: string[];
    errors: string[];
    warnings: string[];
}
export declare function buildDesign(root: string, outDir?: string): BuildResult;

export declare const USER_AGENT: string;
export declare function decodeEntities(text: string): string;
export declare function htmlToText(html: string): string;
/** Lower-case, unify quotes/dashes, collapse whitespace — for tolerant quote matching. */
export declare function normalizeText(text: string): string;
/**
 * True when `quote` appears in `text`. A quote may skip text with "..." or "…";
 * its fragments must then appear in order.
 */
export declare function quoteAppears(quote: string, text: string): boolean;
export declare function sameUrl(a: string, b: string): boolean;
export type PageText = {
    ok: true;
    text: string;
} | {
    ok: false;
    reason: string;
};
/** Fetch a page and reduce it to plain text (HTML stripped, JSON string values joined). */
export declare function fetchPageText(url: string, options?: {
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
}): Promise<PageText>;

/**
 * Evidence connectors: public sources an agent can search for real-world signal
 * (pain, competitors, demand). Every result keeps its URL and the text it came
 * with, so quotes saved from it can be verified later (see store.ts).
 *
 * Not included: PyPI (no search API) and Product Hunt (API requires OAuth and has
 * no full-text search). Agents use their host's web search for everything else
 * and still save the evidence through forge, which verifies it against the page.
 */
export declare const SOURCES: readonly ["hackernews", "github", "npm", "appstore", "reddit"];
export type EvidenceSource = (typeof SOURCES)[number];
export interface SearchResult {
    source: EvidenceSource;
    title: string;
    url: string;
    /** Plain text the result came with — what saved quotes are checked against. */
    text: string;
    metrics: Record<string, number | string>;
    publishedAt?: string;
}
export interface SearchResponse {
    source: EvidenceSource;
    query: string;
    limit: number;
    fetchedAt: string;
    cached: boolean;
    results: SearchResult[];
}
export interface ConnectorOptions {
    limit?: number;
    /** Override the API origin (tests, proxies). */
    baseUrl?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** Skip the 24h cache. */
    fresh?: boolean;
}
export declare class EvidenceSourceError extends Error {
    name: string;
}
export declare function isSource(value: string): value is EvidenceSource;
/** Search a source (24h on-disk cache per source+query+limit). */
export declare function searchEvidence(root: string, source: string, query: string, options?: ConnectorOptions): Promise<SearchResponse>;
/** Every result seen by recent searches — used to verify quotes without refetching. */
export declare function cachedResults(root: string): SearchResult[];

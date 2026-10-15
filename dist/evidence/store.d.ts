import { z } from "zod";
/**
 * The evidence store makes "evidence or unknown" enforceable: a quote is only
 * stored after forge has checked it appears in the search result it came from,
 * or on the page itself. Mismatched quotes are rejected; pages that cannot be
 * fetched (blocked, paywalled) are stored as `unverifiable` and reported as such.
 */
export declare const EvidenceItem: z.ZodObject<{
    id: z.ZodString;
    url: z.ZodURL;
    quote: z.ZodString;
    source: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    retrievedAt: z.ZodISODateTime;
    verification: z.ZodObject<{
        status: z.ZodEnum<{
            unverifiable: "unverifiable";
            verified: "verified";
        }>;
        method: z.ZodEnum<{
            "page-fetch": "page-fetch";
            "search-result": "search-result";
        }>;
        checkedAt: z.ZodISODateTime;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    savedBy: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EvidenceItem = z.infer<typeof EvidenceItem>;
export declare const EvidenceStore: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        url: z.ZodURL;
        quote: z.ZodString;
        source: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        query: z.ZodOptional<z.ZodString>;
        retrievedAt: z.ZodISODateTime;
        verification: z.ZodObject<{
            status: z.ZodEnum<{
                unverifiable: "unverifiable";
                verified: "verified";
            }>;
            method: z.ZodEnum<{
                "page-fetch": "page-fetch";
                "search-result": "search-result";
            }>;
            checkedAt: z.ZodISODateTime;
            note: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        savedBy: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare class EvidenceMismatchError extends Error {
    name: string;
}
export declare function loadEvidence(root: string): EvidenceItem[];
export interface SaveEvidenceInput {
    url: string;
    quote: string;
    source?: string;
    title?: string;
    query?: string;
    savedBy?: string;
}
export declare function saveEvidence(root: string, input: SaveEvidenceInput, options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<EvidenceItem>;
/** The stored item backing a (url, quote) pair cited in an artifact, if any. */
export declare function findEvidence(items: EvidenceItem[], url: string, quote: string): EvidenceItem | undefined;

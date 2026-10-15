import { z } from "zod";
/** ISO-8601 timestamp, e.g. 2026-10-14T09:30:00.000Z */
export declare const IsoDate: z.ZodISODateTime;
export declare const Id: z.ZodString;
/**
 * A cited piece of evidence. The evidence-or-unknown rule: any research claim
 * that is not backed by one of these must be recorded as "unknown".
 */
export declare const Evidence: z.ZodObject<{
    url: z.ZodURL;
    quote: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
    retrievedAt: z.ZodISODateTime;
}, z.core.$strip>;
export type Evidence = z.infer<typeof Evidence>;

import { z } from "zod";
/** ISO-8601 timestamp, e.g. 2026-10-14T09:30:00.000Z */
export const IsoDate = z.iso.datetime({ offset: true });
export const Id = z.string().min(1).max(120);
/**
 * A cited piece of evidence. The evidence-or-unknown rule: any research claim
 * that is not backed by one of these must be recorded as "unknown".
 */
export const Evidence = z.object({
    url: z.url(),
    quote: z.string().min(1),
    source: z.string().min(1).optional(),
    retrievedAt: IsoDate,
});

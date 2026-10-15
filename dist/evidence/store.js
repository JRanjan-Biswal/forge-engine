import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "../vendor/zod.js";
import { withLock } from "../core/lock.js";
import { layout, nowIso, readJson, writeJsonAtomic } from "../core/paths.js";
import { formatIssues } from "../core/util.js";
import { assertNoSecrets } from "../memory/secrets.js";
import { IsoDate } from "../schemas/common.js";
import { cachedResults } from "./connectors.js";
import { fetchPageText, normalizeText, quoteAppears, sameUrl } from "./text.js";
/**
 * The evidence store makes "evidence or unknown" enforceable: a quote is only
 * stored after forge has checked it appears in the search result it came from,
 * or on the page itself. Mismatched quotes are rejected; pages that cannot be
 * fetched (blocked, paywalled) are stored as `unverifiable` and reported as such.
 */
export const EvidenceItem = z.object({
    id: z.string().regex(/^E-\d+$/),
    url: z.url(),
    quote: z.string().min(8),
    source: z.string().min(1),
    title: z.string().optional(),
    query: z.string().optional(),
    retrievedAt: IsoDate,
    verification: z.object({
        status: z.enum(["verified", "unverifiable"]),
        method: z.enum(["search-result", "page-fetch"]),
        checkedAt: IsoDate,
        note: z.string().optional(),
    }),
    savedBy: z.string().optional(),
});
export const EvidenceStore = z.object({ items: z.array(EvidenceItem) });
export class EvidenceMismatchError extends Error {
    name = "EvidenceMismatchError";
}
function storeFile(root) {
    return join(layout(root).forge, "evidence", "evidence.json");
}
export function loadEvidence(root) {
    const file = storeFile(root);
    if (!existsSync(file))
        return [];
    const parsed = EvidenceStore.safeParse(readJson(file));
    if (!parsed.success)
        throw new Error(`.forge/evidence/evidence.json is invalid:\n${formatIssues(parsed.error)}`);
    return parsed.data.items;
}
export async function saveEvidence(root, input, options = {}) {
    const url = z.url().parse(input.url);
    const quote = input.quote.trim();
    if (quote.replace(/\s|…|\./g, "").length < 8) {
        throw new EvidenceMismatchError("A quote must be at least 8 characters of the source's own words");
    }
    assertNoSecrets(quote, "evidence quote");
    const checkedAt = nowIso();
    // 1. A result returned by an evidence search (no refetch needed).
    const fromSearch = cachedResults(root).find((result) => sameUrl(result.url, url) && quoteAppears(quote, `${result.title} ${result.text}`));
    let verification;
    let source = input.source;
    let title = input.title;
    if (fromSearch) {
        verification = { status: "verified", method: "search-result", checkedAt };
        source ??= fromSearch.source;
        title ??= fromSearch.title;
    }
    else {
        // 2. The page itself. Network happens outside the project lock.
        const page = await fetchPageText(url, options);
        if (page.ok) {
            if (!quoteAppears(quote, page.text)) {
                throw new EvidenceMismatchError(`The quote does not appear on ${url}. Copy the source's exact words (use … between fragments), or record the claim as unknown.`);
            }
            verification = { status: "verified", method: "page-fetch", checkedAt };
        }
        else {
            verification = { status: "unverifiable", method: "page-fetch", checkedAt, note: page.reason };
        }
    }
    return withLock(root, () => {
        const items = loadEvidence(root);
        const existing = items.find((item) => sameUrl(item.url, url) && normalizeText(item.quote) === normalizeText(quote));
        if (existing)
            return existing;
        const lastId = items.reduce((max, item) => Math.max(max, Number(item.id.slice(2))), 0);
        const item = EvidenceItem.parse({
            id: `E-${lastId + 1}`,
            url,
            quote,
            source: source ?? new URL(url).hostname,
            title,
            query: input.query,
            retrievedAt: checkedAt,
            verification,
            savedBy: input.savedBy,
        });
        writeJsonAtomic(storeFile(root), { items: [...items, item] });
        return item;
    });
}
/** The stored item backing a (url, quote) pair cited in an artifact, if any. */
export function findEvidence(items, url, quote) {
    return items.find((item) => sameUrl(item.url, url) && (quoteAppears(quote, item.quote) || quoteAppears(item.quote, quote)));
}

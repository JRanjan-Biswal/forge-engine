import { VERSION } from "../version.js";
import { errorMessage } from "../core/util.js";
export const USER_AGENT = `forge-engine/${VERSION} (+https://www.npmjs.com/package/forge-engine)`;
const ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "…",
    mdash: "—",
    ndash: "–",
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
};
export function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity.startsWith("#")) {
            const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[entity.toLowerCase()] ?? match;
    });
}
export function htmlToText(html) {
    return decodeEntities(html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}
/** Lower-case, unify quotes/dashes, collapse whitespace — for tolerant quote matching. */
export function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[‘’‛′`]/g, "'")
        .replace(/[“”″]/g, '"')
        .replace(/[‐-―−]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * True when `quote` appears in `text`. A quote may skip text with "..." or "…";
 * its fragments must then appear in order.
 */
export function quoteAppears(quote, text) {
    const haystack = normalizeText(text);
    const fragments = normalizeText(quote)
        .split(/\s*(?:\.\.\.|…)\s*/)
        .filter((fragment) => fragment.length > 0);
    if (!fragments.length)
        return false;
    let from = 0;
    for (const fragment of fragments) {
        const index = haystack.indexOf(fragment, from);
        if (index === -1)
            return false;
        from = index + fragment.length;
    }
    return true;
}
export function sameUrl(a, b) {
    const canonical = (value) => {
        try {
            const url = new URL(value);
            url.hash = "";
            return url.href.replace(/\/$/, "");
        }
        catch {
            return value;
        }
    };
    return canonical(a) === canonical(b);
}
function collectStrings(value, out) {
    if (typeof value === "string")
        out.push(value);
    else if (Array.isArray(value))
        for (const item of value)
            collectStrings(item, out);
    else if (value && typeof value === "object")
        for (const item of Object.values(value))
            collectStrings(item, out);
}
/** Fetch a page and reduce it to plain text (HTML stripped, JSON string values joined). */
export async function fetchPageText(url, options = {}) {
    const maxBytes = options.maxBytes ?? 3_000_000;
    try {
        const response = await (options.fetchImpl ?? fetch)(url, {
            headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5" },
            redirect: "follow",
            signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        });
        if (!response.ok)
            return { ok: false, reason: `HTTP ${response.status}` };
        const type = response.headers.get("content-type") ?? "";
        if (type && !/text|json|xml/.test(type))
            return { ok: false, reason: `unsupported content-type ${type}` };
        const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, maxBytes);
        const body = new TextDecoder().decode(bytes);
        if (/json/.test(type)) {
            try {
                const strings = [];
                collectStrings(JSON.parse(body), strings);
                return { ok: true, text: htmlToText(strings.join(" ")) };
            }
            catch {
                return { ok: true, text: body };
            }
        }
        return { ok: true, text: /html|xml/.test(type) || /<[a-z!]/i.test(body) ? htmlToText(body) : body };
    }
    catch (error) {
        return { ok: false, reason: errorMessage(error) };
    }
}

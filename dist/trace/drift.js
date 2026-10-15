import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../vendor/yaml.js";
import { loadArtifact } from "../core/artifacts.js";
import { loadConfig } from "../core/config.js";
import { extractProduct, listProjectFiles, routeKey } from "../product/scan.js";
/**
 * Two gap checks that keep the build honest against its own plan:
 * - contract drift: every operation in contracts/openapi is implemented, and every
 *   implemented endpoint is in the contract (or explicitly ignored);
 * - platform parity: when a product targets web and mobile, every MVP story has
 *   screens on both (or is deliberately exempt).
 */
const CONTRACT_FILES = ["contracts/openapi.yaml", "contracts/openapi.yml", "contracts/openapi.json", "openapi.yaml", "openapi.json"];
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
export function findContract(root) {
    return CONTRACT_FILES.find((file) => existsSync(join(root, file)));
}
/** Operations from an OpenAPI document, with the servers[0] base path applied and {params} normalised. */
export function contractOperations(root, file) {
    const text = readFileSync(join(root, file), "utf8");
    const doc = (file.endsWith(".json") ? JSON.parse(text) : parse(text));
    if (!doc?.paths)
        throw new Error(`${file} has no paths`);
    let base = "";
    const server = doc.servers?.[0]?.url;
    if (server) {
        try {
            base = new URL(server, "http://forge.invalid").pathname.replace(/\/+$/, "");
        }
        catch {
            base = "";
        }
    }
    const ops = [];
    for (const [path, item] of Object.entries(doc.paths)) {
        for (const method of Object.keys(item ?? {})) {
            if (!METHODS.includes(method))
                continue;
            ops.push({ method: method.toUpperCase(), path: `${base}${path}`, key: routeKey(`${base}${path}`.replace(/\{[^}]+\}/g, ":p")) });
        }
    }
    return ops;
}
export function contractDrift(root) {
    const contract = findContract(root);
    if (!contract)
        return { operations: 0, endpoints: 0, missing: [], undocumented: [], suffixMatches: [] };
    const ops = contractOperations(root, contract);
    const ignore = new Set(loadConfig(root).gates.gap.contractIgnore.map((entry) => entry.trim().replace(/\s+/, " ").toUpperCase()));
    const endpoints = extractProduct(root, listProjectFiles(root))
        .surfaces.filter((s) => s.kind === "endpoint")
        .map((s) => ({ method: (s.method ?? "ANY").toUpperCase(), route: s.route, key: routeKey(s.route), file: s.file }));
    const methodOk = (a, b) => a === b || a === "ANY" || b === "ANY";
    /** A route tail is only trusted when it has a literal segment ("/:p" alone would match anything). */
    const literalTail = (key) => key.split("/").some((part) => part && part !== ":p");
    const suffixMatches = [];
    const missing = ops.filter((op) => {
        if (endpoints.some((e) => methodOk(e.method, op.method) && e.key === op.key))
            return false;
        // FastAPI/Express routers mounted under a prefix declare only the tail of the path.
        const tail = endpoints.find((e) => methodOk(e.method, op.method) && literalTail(e.key) && op.key.endsWith(e.key));
        if (tail) {
            suffixMatches.push({ operation: `${op.method} ${op.path}`, route: tail.route, file: tail.file });
            return false;
        }
        return true;
    });
    const undocumented = endpoints
        .filter((e) => !ignore.has(`${e.method} ${e.route}`.toUpperCase()) && !ignore.has(`${e.method} ${e.key}`.toUpperCase()))
        .filter((e) => !ops.some((op) => methodOk(e.method, op.method) && (op.key === e.key || (literalTail(e.key) && op.key.endsWith(e.key)))))
        .map(({ method, route, file }) => ({ method, route, file }));
    return { contract, operations: ops.length, endpoints: endpoints.length, missing, undocumented, suffixMatches };
}
const groupOf = (platform) => (platform === "ios" || platform === "android" ? "mobile" : platform);
export function platformParity(root) {
    const config = loadConfig(root);
    const groups = [...new Set(config.platforms.filter((p) => p !== "api" && p !== "desktop").map(groupOf))];
    const prd = loadArtifact(root, "prd");
    const screens = loadArtifact(root, "screens");
    if (groups.length < 2 || !prd || !screens)
        return { groups, stories: [], gaps: [] };
    const exempt = new Set(config.gates.gap.parityExempt);
    const stories = prd.stories
        .filter((s) => s.mvp && s.priority !== "wont")
        .map((story) => {
        const has = [...new Set(screens.screens.filter((sc) => sc.storyIds.includes(story.id)).map((sc) => groupOf(sc.platform)))];
        return { id: story.id, has, missing: groups.filter((g) => !has.includes(g)), exempt: exempt.has(story.id) };
    });
    return { groups, stories, gaps: stories.filter((s) => s.missing.length && !s.exempt).map(({ id, missing }) => ({ id, missing })) };
}

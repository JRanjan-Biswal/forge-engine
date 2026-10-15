import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
/**
 * Deterministic product scanning: list the project's files (respecting .gitignore
 * via git when available), fingerprint them for staleness checks, and extract the
 * product's surfaces — pages and API endpoints — from common frameworks.
 */
const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".expo", ".svelte-kit", "coverage", "vendor",
    ".forge", "graphify-out", ".turbo", ".vercel", "out", "target", "__pycache__", ".venv", "venv",
]);
const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rb|php|java|kt|swift|dart|rs|cs)$/;
const DOC = /\.(md|mdx)$/i;
const TEST = /(^|\/)(__tests__|tests?|e2e|fixtures|__mocks__)\/|\.(test|spec|stories)\.[a-z]+$/i;
const MAX_FILES = 50_000;
const toPosix = (path) => path.split(sep).join("/");
/** Project files relative to root; uses `git ls-files` (honours .gitignore) when possible. */
export function listProjectFiles(root) {
    const git = spawnSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (git.status === 0 && git.stdout.trim()) {
        return git.stdout
            .split("\n")
            .filter(Boolean)
            .filter((file) => !file.split("/").some((part) => SKIP_DIRS.has(part)) && existsSync(join(root, file)))
            .slice(0, MAX_FILES);
    }
    const files = [];
    const walk = (dir) => {
        if (files.length >= MAX_FILES)
            return;
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            let stat;
            try {
                stat = statSync(full);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                if (!SKIP_DIRS.has(name) && !name.startsWith("."))
                    walk(full);
            }
            else {
                files.push(toPosix(relative(root, full)));
            }
        }
    };
    walk(root);
    return files;
}
const relevant = (file) => CODE.test(file) || DOC.test(file) || basename(file) === "package.json" || /requirements\.txt$|pyproject\.toml$/.test(file);
/** Cheap staleness fingerprint: paths, sizes and mtimes of code, docs and manifests. */
export function fingerprint(root, files) {
    const hash = createHash("sha1");
    let count = 0;
    for (const file of [...files].filter(relevant).sort()) {
        try {
            const stat = statSync(join(root, file));
            hash.update(`${file}\0${stat.size}\0${Math.floor(stat.mtimeMs)}\n`);
            count++;
        }
        catch {
            // vanished during the scan
        }
    }
    return { files: count, hash: hash.digest("hex") };
}
function readDeps(dir) {
    try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        return { ...pkg.dependencies, ...pkg.devDependencies };
    }
    catch {
        return {};
    }
}
/** Dependencies of the nearest package.json above a file (monorepos: apps/mobile vs apps/web), merged with the root's. */
function depsResolver(root) {
    const cache = new Map();
    const rootDeps = readDeps(root);
    return (file) => {
        const parts = file.split("/").slice(0, -1);
        for (let i = parts.length; i > 0; i--) {
            const dir = parts.slice(0, i).join("/");
            if (!cache.has(dir))
                cache.set(dir, existsSync(join(root, dir, "package.json")) ? readDeps(join(root, dir)) : {});
            const deps = cache.get(dir) ?? {};
            if (Object.keys(deps).length)
                return { ...rootDeps, ...deps };
        }
        return rootDeps;
    };
}
/** Convert file-system route segments ((group), @slot, [id], [...rest]) into a URL pattern. */
function fsRoute(segments) {
    const parts = segments
        .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@") && s !== "index")
        .map((s) => s
        .replace(/^\[\[\.\.\.(.+)\]\]$/, "*$1")
        .replace(/^\[\.\.\.(.+)\]$/, "*$1")
        .replace(/^\[(.+)\]$/, ":$1"));
    return `/${parts.join("/")}`;
}
const page = (route, file, framework) => ({ id: `page:${route}`, kind: "page", route, file, framework });
const endpoint = (method, route, file, framework) => ({
    id: `endpoint:${method} ${route}`,
    kind: "endpoint",
    route,
    method,
    file,
    framework,
});
const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
function exportedMethods(source) {
    const methods = new Set();
    const pattern = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+(${HTTP_METHODS})\\b`, "g");
    for (const match of source.matchAll(pattern))
        if (match[1])
            methods.add(match[1]);
    return methods.size ? [...methods] : ["ANY"];
}
/** Normalise a route or a client-side URL literal for matching: params → ":p". */
export function routeKey(route) {
    return route
        .replace(/\$\{[^}]*\}/g, ":p")
        .replace(/\{[^}]+\}/g, ":p")
        .replace(/:[A-Za-z_][\w]*/g, ":p")
        .replace(/\*[A-Za-z_]\w*/g, ":p")
        .replace(/\/+$/, "") || "/";
}
/** Join a mount prefix and a route: ("/books", "/") → "/books", ("", "/x") → "/x". */
function joinRoute(prefix, route) {
    const joined = `${prefix.replace(/\/+$/, "")}${route === "/" || route === "" ? "" : route.startsWith("/") ? route : `/${route}`}`;
    return joined || "/";
}
const JS_FILE = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const ROUTER_CTOR = /(?:const|let|var)\s+(\w+)\s*=\s*(?:new\s+(?:Hono|Elysia|Router)\b|(?:express\.)?Router\s*\()/g;
/**
 * Where each routing file is mounted: Hono `app.route("/x", child)` / basePath, Express
 * `app.use("/x", router)`, FastAPI `include_router(mod.router, prefix=…)` and Flask
 * `register_blueprint(bp, url_prefix=…)`, resolved through imports to the child file.
 * Returns every full prefix a file's routes live under ("" when not mounted).
 */
function mountPrefixes(codeFiles, read) {
    const known = new Set(codeFiles.map(toPosix));
    const resolveJs = (from, spec) => {
        const base = posixJoin(from.split("/").slice(0, -1).join("/"), spec).replace(/\.(?:m?js|cjs)$/, "");
        return [base, ...[".ts", ".tsx", ".js", ".mjs", ".jsx", "/index.ts", "/index.js"].map((ext) => base + ext)].find((f) => known.has(f));
    };
    const resolvePy = (from, module, name) => {
        const dots = /^\.+/.exec(module)?.[0].length ?? 0;
        const dir = from.split("/").slice(0, -1);
        const pkg = dots ? [...dir.slice(0, dir.length - (dots - 1)), ...module.slice(dots).split(".").filter(Boolean)] : module.split(".");
        const candidates = [`${pkg.join("/")}/${name}.py`, `${pkg.join("/")}.py`];
        return [...known].find((f) => candidates.some((c) => f === c || f.endsWith(`/${c}`)));
    };
    /** child file → [parent file, mount path] */
    const edges = [];
    const own = new Map();
    for (const file of known) {
        const source = read(file);
        if (!source)
            continue;
        if (JS_FILE.test(file)) {
            const imports = new Map();
            for (const m of source.matchAll(/import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
                const target = resolveJs(file, m[3] ?? "");
                if (!target)
                    continue;
                if (m[1])
                    imports.set(m[1], target);
                for (const part of (m[2] ?? "").split(",")) {
                    const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
                    if (alias)
                        imports.set(alias, target);
                }
            }
            for (const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
                const target = resolveJs(file, m[2] ?? "");
                if (target && m[1])
                    imports.set(m[1], target);
            }
            const base = /basePath\(\s*["'`](\/[^"'`]*)["'`]\s*\)/.exec(source)?.[1];
            if (base)
                own.set(file, base);
            for (const m of source.matchAll(/\.(?:route|use)\(\s*["'`](\/[^"'`]*)["'`]\s*,\s*(\w+)\s*[,)]/g)) {
                const child = imports.get(m[2] ?? "");
                if (child && m[1])
                    edges.push([child, file, m[1]]);
            }
        }
        else if (file.endsWith(".py")) {
            const imports = new Map();
            for (const m of source.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([\w\s,]+)$/gm)) {
                for (const part of (m[2] ?? "").split(",")) {
                    const [name, alias] = part.trim().split(/\s+as\s+/);
                    const target = name ? resolvePy(file, m[1] ?? "", name) : undefined;
                    if (target)
                        imports.set(alias ?? name ?? "", target);
                }
            }
            const prefix = /(?:APIRouter|Blueprint)\([^)]*?\b(?:url_)?prefix\s*=\s*["'](\/[^"']*)["']/.exec(source)?.[1];
            if (prefix)
                own.set(file, prefix);
            for (const m of source.matchAll(/(?:include_router|register_blueprint)\(\s*(\w+)(?:\.\w+)?\s*(?:,[^)]*?\b(?:url_)?prefix\s*=\s*["'](\/[^"']*)["'])?/g)) {
                const child = imports.get(m[1] ?? "");
                if (child)
                    edges.push([child, file, m[2] ?? ""]);
            }
        }
    }
    const memo = new Map();
    const prefixesOf = (file, depth = 0) => {
        const cached = memo.get(file);
        if (cached)
            return cached;
        const parents = edges.filter(([child]) => child === file);
        const ownPrefix = own.get(file) ?? "";
        const result = parents.length && depth < 6
            ? [...new Set(parents.flatMap(([, parent, path]) => prefixesOf(parent, depth + 1).map((p) => joinRoute(joinRoute(p, path), ownPrefix))))]
            : [ownPrefix];
        memo.set(file, result.map((p) => (p === "/" ? "" : p)));
        return memo.get(file) ?? [""];
    };
    return new Map([...known].map((file) => [file, prefixesOf(file)]));
}
function posixJoin(dir, spec) {
    const out = dir ? dir.split("/") : [];
    for (const part of spec.split("/")) {
        if (part === "..")
            out.pop();
        else if (part && part !== ".")
            out.push(part);
    }
    return out.join("/");
}
export function extractProduct(root, files) {
    const depsOf = depsResolver(root);
    const frameworks = new Set();
    const surfaces = new Map();
    const add = (surface) => {
        if (!surfaces.has(surface.id))
            surfaces.set(surface.id, surface);
        frameworks.add(surface.framework);
    };
    const sources = new Map();
    const read = (file) => {
        if (!sources.has(file)) {
            try {
                const stat = statSync(join(root, file));
                sources.set(file, stat.size > 1_000_000 ? "" : readFileSync(join(root, file), "utf8"));
            }
            catch {
                sources.set(file, "");
            }
        }
        return sources.get(file) ?? "";
    };
    const codeFiles = files.filter((file) => CODE.test(file) && !TEST.test(file));
    const declaring = new Set();
    const mounts = mountPrefixes(codeFiles, read);
    for (const file of codeFiles) {
        const posix = toPosix(file);
        let match;
        if (depsOf(posix).next) {
            if ((match = /(?:^|\/)app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(posix)))
                add(page(fsRoute((match[1] ?? "").split("/")), posix, "nextjs"));
            if ((match = /(?:^|\/)app\/(?:(.*)\/)?route\.(?:ts|js)$/.exec(posix))) {
                for (const method of exportedMethods(read(file)))
                    add(endpoint(method, fsRoute((match[1] ?? "").split("/")), posix, "nextjs"));
                declaring.add(posix);
            }
            if ((match = /(?:^|\/)pages\/(.*)\.(?:tsx|ts|jsx|js)$/.exec(posix)) && !/(^|\/)_(app|document|error)$/.test(match[1] ?? "")) {
                const segments = (match[1] ?? "").split("/");
                if (segments[0] === "api") {
                    add(endpoint("ANY", fsRoute(segments), posix, "nextjs"));
                    declaring.add(posix);
                }
                else {
                    add(page(fsRoute(segments), posix, "nextjs"));
                }
            }
        }
        if (depsOf(posix)["expo-router"] && (match = /(?:^|\/)app\/(.*)\.(?:tsx|ts|jsx|js)$/.exec(posix))) {
            const segments = (match[1] ?? "").split("/");
            const last = segments[segments.length - 1] ?? "";
            if (!last.startsWith("_") && !last.startsWith("+"))
                add(page(fsRoute(segments), posix, "expo-router"));
        }
        if (depsOf(posix)["@sveltejs/kit"]) {
            if ((match = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+page\.svelte$/.exec(posix)))
                add(page(fsRoute((match[1] ?? "").split("/")), posix, "sveltekit"));
            if ((match = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+server\.(?:ts|js)$/.exec(posix))) {
                for (const method of exportedMethods(read(file)))
                    add(endpoint(method, fsRoute((match[1] ?? "").split("/")), posix, "sveltekit"));
                declaring.add(posix);
            }
        }
        if (depsOf(posix).nuxt) {
            if ((match = /(?:^|\/)pages\/(.*)\.vue$/.exec(posix)))
                add(page(fsRoute((match[1] ?? "").split("/")), posix, "nuxt"));
            if ((match = /(?:^|\/)server\/api\/(.*?)(?:\.(get|post|put|patch|delete))?\.(?:ts|js)$/.exec(posix))) {
                add(endpoint(match[2]?.toUpperCase() ?? "ANY", fsRoute(["api", ...(match[1] ?? "").split("/")]), posix, "nuxt"));
                declaring.add(posix);
            }
        }
        const source = read(file);
        if (!source)
            continue;
        if (/react-router/.test(source)) {
            for (const m of source.matchAll(/<Route\b[^>]*\bpath=["'](\/[^"']*)["']/g))
                if (m[1])
                    add(page(m[1], posix, "react-router"));
            if (/createBrowserRouter|createRoutesFromElements|createHashRouter/.test(source)) {
                for (const m of source.matchAll(/\bpath\s*:\s*["'](\/[^"']*)["']/g))
                    if (m[1])
                        add(page(m[1], posix, "react-router"));
            }
        }
        const before = surfaces.size;
        const prefixes = mounts.get(posix) ?? [""];
        if (JS_FILE.test(posix)) {
            // Receivers: the usual names plus any variable holding a Hono/Express/Elysia router in this file.
            const receivers = new Set(["app", "router", "server", "api", "fastify", "hono", "route", "routes"]);
            for (const m of source.matchAll(ROUTER_CTOR))
                if (m[1])
                    receivers.add(m[1]);
            const routerFile = /new\s+(?:Hono|Elysia|Router)\b|(?:express\.)?Router\s*\(/.test(source);
            const pattern = new RegExp(`(?:\\b(${[...receivers].join("|")})|${routerFile ? "\\)" : "(?!)"})\\s*\\.(get|post|put|patch|delete|all)\\(\\s*["'\`](\\/[^"'\`]*)["'\`]`, "g");
            for (const m of source.matchAll(pattern)) {
                if (!m[2] || !m[3])
                    continue;
                for (const prefix of prefixes)
                    add(endpoint(m[2] === "all" ? "ANY" : m[2].toUpperCase(), joinRoute(prefix, m[3]), posix, "node-http"));
            }
            for (const m of source.matchAll(new RegExp(`method\\s*===\\s*["'](${HTTP_METHODS})["']\\s*&&\\s*[\\w.]+\\s*===\\s*["'](\\/[^"']*)["']`, "g"))) {
                if (m[1] && m[2])
                    add(endpoint(m[1], m[2], posix, "node-http"));
            }
        }
        if (posix.endsWith(".py")) {
            // Mount prefixes already include the file's own APIRouter(prefix=…) / Blueprint(url_prefix=…); `app` routes are never prefixed.
            const routeFor = (receiver, path) => (receiver === "app" ? [path || "/"] : prefixes.map((p) => joinRoute(p, path)));
            for (const m of source.matchAll(/@(\w+)\.(get|post|put|patch|delete)\(\s*["'](\/?[^"']*)["']/g)) {
                const [, receiver = "", method = "", path = ""] = m;
                if (!path && receiver === "app")
                    continue;
                for (const route of routeFor(receiver, path))
                    add(endpoint(method.toUpperCase(), route, posix, "python"));
            }
            for (const m of source.matchAll(/@(\w+)\.route\(\s*["'](\/?[^"']*)["'](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g)) {
                const [, receiver = "", path = "", list] = m;
                const methods = list ? [...list.matchAll(/["'](\w+)["']/g)].map((x) => (x[1] ?? "").toUpperCase()) : ["GET"];
                for (const method of methods)
                    for (const route of routeFor(receiver, path))
                        add(endpoint(method, route, posix, "python"));
            }
        }
        if (surfaces.size > before)
            declaring.add(posix);
    }
    // Calls: client code that requests a known endpoint route.
    const endpoints = [...surfaces.values()].filter((s) => s.kind === "endpoint");
    const calls = [];
    const seen = new Set();
    for (const file of codeFiles) {
        if (declaring.has(toPosix(file)))
            continue;
        const source = read(file);
        if (!source)
            continue;
        const literals = [
            ...source.matchAll(/(?:fetch|\$fetch|useFetch|axios(?:\.\w+)?|ky(?:\.\w+)?|request)\(\s*[`"'](\/[^`"'?#]*)/g),
            ...source.matchAll(/\.(?:get|post|put|patch|delete)\(\s*[`"'](\/api\/[^`"'?#]*)/g),
        ].map((m) => m[1] ?? "");
        for (const literal of literals) {
            const key = routeKey(literal);
            for (const target of endpoints.filter((e) => routeKey(e.route) === key)) {
                const id = `${toPosix(file)}→${target.id}`;
                if (!seen.has(id)) {
                    seen.add(id);
                    calls.push({ from: toPosix(file), to: target.id, literal });
                }
            }
        }
    }
    const docs = files
        .filter((file) => DOC.test(file) && !TEST.test(file))
        .slice(0, 2_000)
        .map((file) => {
        const text = read(file);
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? basename(file);
        return { path: toPosix(file), title, bytes: Buffer.byteLength(text) };
    });
    return {
        surfaces: [...surfaces.values()].sort((a, b) => a.id.localeCompare(b.id)),
        frameworks: [...frameworks].sort(),
        calls,
        docs,
    };
}

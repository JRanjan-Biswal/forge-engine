import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { Surface } from "../schemas/product.js";

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

const toPosix = (path: string) => path.split(sep).join("/");

/** Project files relative to root; uses `git ls-files` (honours .gitignore) when possible. */
export function listProjectFiles(root: string): string[] {
  const git = spawnSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (git.status === 0 && git.stdout.trim()) {
    return git.stdout
      .split("\n")
      .filter(Boolean)
      .filter((file) => !file.split("/").some((part) => SKIP_DIRS.has(part)) && existsSync(join(root, file)))
      .slice(0, MAX_FILES);
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(full);
      } else {
        files.push(toPosix(relative(root, full)));
      }
    }
  };
  walk(root);
  return files;
}

const relevant = (file: string) => CODE.test(file) || DOC.test(file) || basename(file) === "package.json" || /requirements\.txt$|pyproject\.toml$/.test(file);

/** Cheap staleness fingerprint: paths, sizes and mtimes of code, docs and manifests. */
export function fingerprint(root: string, files: string[]): { files: number; hash: string } {
  const hash = createHash("sha1");
  let count = 0;
  for (const file of [...files].filter(relevant).sort()) {
    try {
      const stat = statSync(join(root, file));
      hash.update(`${file}\0${stat.size}\0${Math.floor(stat.mtimeMs)}\n`);
      count++;
    } catch {
      // vanished during the scan
    }
  }
  return { files: count, hash: hash.digest("hex") };
}

function readDeps(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

/** Convert file-system route segments ((group), @slot, [id], [...rest]) into a URL pattern. */
function fsRoute(segments: string[]): string {
  const parts = segments
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@") && s !== "index")
    .map((s) =>
      s
        .replace(/^\[\[\.\.\.(.+)\]\]$/, "*$1")
        .replace(/^\[\.\.\.(.+)\]$/, "*$1")
        .replace(/^\[(.+)\]$/, ":$1"),
    );
  return `/${parts.join("/")}`;
}

const page = (route: string, file: string, framework: string): Surface => ({ id: `page:${route}`, kind: "page", route, file, framework });
const endpoint = (method: string, route: string, file: string, framework: string): Surface => ({
  id: `endpoint:${method} ${route}`,
  kind: "endpoint",
  route,
  method,
  file,
  framework,
});

const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function exportedMethods(source: string): string[] {
  const methods = new Set<string>();
  const pattern = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+(${HTTP_METHODS})\\b`, "g");
  for (const match of source.matchAll(pattern)) if (match[1]) methods.add(match[1]);
  return methods.size ? [...methods] : ["ANY"];
}

export interface Extraction {
  surfaces: Surface[];
  frameworks: string[];
  calls: { from: string; to: string; literal: string }[];
  docs: { path: string; title: string; bytes: number }[];
}

/** Normalise a route or a client-side URL literal for matching: params → ":p". */
function routeKey(route: string): string {
  return route
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/:[A-Za-z_][\w]*/g, ":p")
    .replace(/\*[A-Za-z_]\w*/g, ":p")
    .replace(/\/+$/, "") || "/";
}

export function extractProduct(root: string, files: string[]): Extraction {
  const deps = readDeps(root);
  const frameworks = new Set<string>();
  const surfaces = new Map<string, Surface>();
  const add = (surface: Surface) => {
    if (!surfaces.has(surface.id)) surfaces.set(surface.id, surface);
    frameworks.add(surface.framework);
  };
  const sources = new Map<string, string>();
  const read = (file: string) => {
    if (!sources.has(file)) {
      try {
        const stat = statSync(join(root, file));
        sources.set(file, stat.size > 1_000_000 ? "" : readFileSync(join(root, file), "utf8"));
      } catch {
        sources.set(file, "");
      }
    }
    return sources.get(file) ?? "";
  };

  const codeFiles = files.filter((file) => CODE.test(file) && !TEST.test(file));
  const declaring = new Set<string>();

  for (const file of codeFiles) {
    const posix = toPosix(file);
    let match: RegExpExecArray | null;

    if (deps.next) {
      if ((match = /(?:^|\/)app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(posix))) add(page(fsRoute((match[1] ?? "").split("/")), posix, "nextjs"));
      if ((match = /(?:^|\/)app\/(?:(.*)\/)?route\.(?:ts|js)$/.exec(posix))) {
        for (const method of exportedMethods(read(file))) add(endpoint(method, fsRoute((match[1] ?? "").split("/")), posix, "nextjs"));
        declaring.add(posix);
      }
      if ((match = /(?:^|\/)pages\/(.*)\.(?:tsx|ts|jsx|js)$/.exec(posix)) && !/(^|\/)_(app|document|error)$/.test(match[1] ?? "")) {
        const segments = (match[1] ?? "").split("/");
        if (segments[0] === "api") {
          add(endpoint("ANY", fsRoute(segments), posix, "nextjs"));
          declaring.add(posix);
        } else {
          add(page(fsRoute(segments), posix, "nextjs"));
        }
      }
    }
    if (deps["expo-router"] && (match = /(?:^|\/)app\/(.*)\.(?:tsx|ts|jsx|js)$/.exec(posix))) {
      const segments = (match[1] ?? "").split("/");
      const last = segments[segments.length - 1] ?? "";
      if (!last.startsWith("_") && !last.startsWith("+")) add(page(fsRoute(segments), posix, "expo-router"));
    }
    if (deps["@sveltejs/kit"]) {
      if ((match = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+page\.svelte$/.exec(posix))) add(page(fsRoute((match[1] ?? "").split("/")), posix, "sveltekit"));
      if ((match = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+server\.(?:ts|js)$/.exec(posix))) {
        for (const method of exportedMethods(read(file))) add(endpoint(method, fsRoute((match[1] ?? "").split("/")), posix, "sveltekit"));
        declaring.add(posix);
      }
    }
    if (deps.nuxt) {
      if ((match = /(?:^|\/)pages\/(.*)\.vue$/.exec(posix))) add(page(fsRoute((match[1] ?? "").split("/")), posix, "nuxt"));
      if ((match = /(?:^|\/)server\/api\/(.*?)(?:\.(get|post|put|patch|delete))?\.(?:ts|js)$/.exec(posix))) {
        add(endpoint(match[2]?.toUpperCase() ?? "ANY", fsRoute(["api", ...(match[1] ?? "").split("/")]), posix, "nuxt"));
        declaring.add(posix);
      }
    }

    const source = read(file);
    if (!source) continue;

    if (/react-router/.test(source)) {
      for (const m of source.matchAll(/<Route\b[^>]*\bpath=["'](\/[^"']*)["']/g)) if (m[1]) add(page(m[1], posix, "react-router"));
      if (/createBrowserRouter|createRoutesFromElements|createHashRouter/.test(source)) {
        for (const m of source.matchAll(/\bpath\s*:\s*["'](\/[^"']*)["']/g)) if (m[1]) add(page(m[1], posix, "react-router"));
      }
    }

    const before = surfaces.size;
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(posix)) {
      for (const m of source.matchAll(/\b(?:app|router|server|api|fastify|hono|routes?)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/g)) {
        if (m[1] && m[2]) add(endpoint(m[1] === "all" ? "ANY" : m[1].toUpperCase(), m[2], posix, "node-http"));
      }
      for (const m of source.matchAll(new RegExp(`method\\s*===\\s*["'](${HTTP_METHODS})["']\\s*&&\\s*[\\w.]+\\s*===\\s*["'](\\/[^"']*)["']`, "g"))) {
        if (m[1] && m[2]) add(endpoint(m[1], m[2], posix, "node-http"));
      }
    }
    if (posix.endsWith(".py")) {
      for (const m of source.matchAll(/@\w+\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g)) {
        if (m[1] && m[2]) add(endpoint(m[1].toUpperCase(), m[2], posix, "python"));
      }
      for (const m of source.matchAll(/@\w+\.route\(\s*["'](\/[^"']*)["'](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g)) {
        const methods = m[2] ? [...m[2].matchAll(/["'](\w+)["']/g)].map((x) => (x[1] ?? "").toUpperCase()) : ["GET"];
        for (const method of methods) if (m[1]) add(endpoint(method, m[1], posix, "python"));
      }
    }
    if (surfaces.size > before) declaring.add(posix);
  }

  // Calls: client code that requests a known endpoint route.
  const endpoints = [...surfaces.values()].filter((s) => s.kind === "endpoint");
  const calls: Extraction["calls"] = [];
  const seen = new Set<string>();
  for (const file of codeFiles) {
    if (declaring.has(toPosix(file))) continue;
    const source = read(file);
    if (!source) continue;
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

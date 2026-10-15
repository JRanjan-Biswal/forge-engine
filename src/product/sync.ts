import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtifact } from "../core/artifacts.js";
import { appendLedger } from "../core/ledger.js";
import { withLock } from "../core/lock.js";
import { layout, nowIso, readJson, writeJsonAtomic } from "../core/paths.js";
import { formatIssues } from "../core/util.js";
import { graphStatus, graphUpdate } from "../memory/graphify.js";
import { PageAudit, ProductMap, type ProductModel, type Surface } from "../schemas/product.js";
import type { Trace } from "../schemas/artifacts.js";
import { extractProduct, fingerprint, listProjectFiles } from "./scan.js";

/**
 * Keeps forge's understanding of an existing product in sync with its code:
 * product map (pages, endpoints, calls, docs) + graphify code graph + traceability
 * graph, all regenerated from the code — never edited by hand.
 */

export const MAP_ORIGIN = "product-map";

function mapFile(root: string): string {
  return join(layout(root).forge, "product", "map.json");
}

function pagesDir(root: string): string {
  return join(layout(root).forge, "pages");
}

export function loadProductMap(root: string): ProductMap | undefined {
  const file = mapFile(root);
  if (!existsSync(file)) return undefined;
  const parsed = ProductMap.safeParse(readJson(file));
  if (!parsed.success) throw new Error(`.forge/product/map.json is invalid:\n${formatIssues(parsed.error)}`);
  return parsed.data;
}

export interface ProductCheck {
  mapExists: boolean;
  stale: boolean;
  reason: string;
  files: number;
}

/** Fast staleness check (no extraction): has any code, doc or manifest changed since the last sync? */
export function checkProduct(root: string): ProductCheck {
  const map = loadProductMap(root);
  const current = fingerprint(root, listProjectFiles(root));
  if (!map) return { mapExists: false, stale: true, reason: "no product map yet — run `forge sync`", files: current.files };
  if (map.fingerprint.hash !== current.hash) {
    const delta = current.files - map.fingerprint.files;
    return {
      mapExists: true,
      stale: true,
      reason: `code changed since the last sync (${delta >= 0 ? "+" : ""}${delta} files, contents or timestamps differ) — run \`forge sync\``,
      files: current.files,
    };
  }
  return { mapExists: true, stale: false, reason: `in sync (${current.files} files)`, files: current.files };
}

/** Map each source file to its earliest graphify node (usually the module/file node). */
function graphNodesByFile(root: string): Map<string, string> {
  const nodes = new Map<string, { id: string; line: number }>();
  const file = layout(root).graphifyGraph;
  if (!existsSync(file)) return new Map();
  try {
    const graph = readJson(file) as { nodes?: { id: string; source_file?: string; source_location?: string }[] };
    for (const node of graph.nodes ?? []) {
      if (!node.source_file) continue;
      const line = Number(/L(\d+)/.exec(node.source_location ?? "")?.[1] ?? Number.MAX_SAFE_INTEGER);
      const current = nodes.get(node.source_file);
      if (!current || line < current.line) nodes.set(node.source_file, { id: node.id, line });
    }
  } catch {
    return new Map();
  }
  return new Map([...nodes].map(([source, value]) => [source, value.id]));
}

export interface SyncDiff {
  firstSync: boolean;
  added: string[];
  removed: string[];
  changed: boolean;
}

export interface SyncResult {
  map: ProductMap;
  diff: SyncDiff;
  /** Product-model features that reference surfaces or files that no longer exist. */
  staleFeatures: { feature: string; missing: string[] }[];
}

/** Rebuild the product map (and the code graph, unless graph=false) and connect it into the trace graph. */
export async function syncProduct(root: string, options: { graph?: boolean } = {}): Promise<SyncResult> {
  const files = listProjectFiles(root);
  const print = fingerprint(root, files);
  const previous = loadProductMap(root);

  let graph: ProductMap["graph"];
  const status = graphStatus(root);
  if (options.graph === false) graph = { status: "skipped" };
  else if (!status.installed) graph = { status: "unavailable", note: "graphify is not installed (uv tool install graphifyy)" };
  else if (previous && previous.fingerprint.hash === print.hash && status.graphExists) graph = { status: "unchanged" };
  else {
    const result = await graphUpdate(root);
    graph = result.ok ? { status: "updated" } : { status: "failed", note: (result.error ?? "").slice(0, 300) };
  }

  const extraction = extractProduct(root, files);
  const nodesByFile = graphNodesByFile(root);
  const surfaces: Surface[] = extraction.surfaces.map((surface) => {
    const node = nodesByFile.get(surface.file);
    return node ? { ...surface, graphifyNode: node } : surface;
  });
  const map = ProductMap.parse({
    version: 1,
    generatedAt: nowIso(),
    fingerprint: print,
    frameworks: extraction.frameworks,
    surfaces,
    calls: extraction.calls,
    docs: extraction.docs,
    graph,
  });

  const before = new Set(previous?.surfaces.map((s) => s.id) ?? []);
  const after = new Set(surfaces.map((s) => s.id));
  const diff: SyncDiff = {
    firstSync: !previous,
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    changed: !previous || previous.fingerprint.hash !== print.hash,
  };

  let model: ProductModel | undefined;
  try {
    model = loadArtifact<ProductModel>(root, "product");
  } catch {
    model = undefined;
  }
  const existingFiles = new Set(files);
  const staleFeatures = (model?.features ?? [])
    .map((feature) => ({
      feature: feature.id,
      missing: [...feature.surfaces.filter((id) => !after.has(id)), ...feature.files.filter((file) => !existingFiles.has(file))],
    }))
    .filter((entry) => entry.missing.length);

  withLock(root, () => {
    writeJsonAtomic(mapFile(root), map);
    upsertTrace(root, map);
    if (diff.firstSync || diff.added.length || diff.removed.length) {
      const pages = surfaces.filter((s) => s.kind === "page").length;
      appendLedger(root, {
        kind: "note",
        summary:
          `Product map synced: ${pages} pages, ${surfaces.length - pages} endpoints` +
          (diff.firstSync ? " (first sync)" : ` (+${diff.added.length} / -${diff.removed.length})`) +
          (staleFeatures.length ? `; ${staleFeatures.length} product-model feature(s) reference removed code` : ""),
        links: [".forge/product/map.json"],
      });
    }
  });
  return { map, diff, staleFeatures };
}

/** Replace the product-map-derived part of the traceability graph. */
function upsertTrace(root: string, map: ProductMap): void {
  const trace = (loadArtifact<Trace>(root, "trace") ?? { nodes: [], edges: [] }) as Trace & {
    nodes: (Trace["nodes"][number] & { origin?: string })[];
    edges: (Trace["edges"][number] & { origin?: string })[];
  };
  const nodes = trace.nodes.filter((node) => node.origin !== MAP_ORIGIN);
  const edges = trace.edges.filter((edge) => edge.origin !== MAP_ORIGIN);
  const ids = new Set(nodes.map((node) => node.id));
  const node = (id: string, type: Trace["nodes"][number]["type"], graphifyNode?: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    nodes.push({ id, type, origin: MAP_ORIGIN, ...(graphifyNode ? { graphifyNode } : {}) });
  };
  const edge = (from: string, to: string, type: Trace["edges"][number]["type"]) => edges.push({ from, to, type, origin: MAP_ORIGIN });

  const pageFiles = new Map(map.surfaces.filter((s) => s.kind === "page").map((s) => [s.file, `screen:${s.route}`]));
  for (const surface of map.surfaces) {
    const code = `code:${surface.file}`;
    node(code, "code", surface.graphifyNode);
    if (surface.kind === "page") {
      node(`screen:${surface.route}`, "screen");
      edge(`screen:${surface.route}`, code, "implementedBy");
    } else {
      node(`endpoint:${surface.method} ${surface.route}`, "endpoint");
      edge(`endpoint:${surface.method} ${surface.route}`, code, "implementedBy");
    }
  }
  for (const call of map.calls) {
    const from = pageFiles.get(call.from) ?? `code:${call.from}`;
    if (from.startsWith("code:")) node(from, "code");
    edge(from, call.to, "calls");
  }
  writeJsonAtomic(layout(root).trace, { nodes, edges });
}

// ── Page audits (pro-page-complete) ──────────────────────────────────────────

export function savePageAudit(root: string, slug: string, data: unknown): { path: string; open: number } {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new Error("slug must be lowercase letters, digits and dashes (e.g. settings-billing)");
  const parsed = PageAudit.safeParse(typeof data === "string" ? JSON.parse(data) : data);
  if (!parsed.success) throw new Error(`page audit does not match its schema:\n${formatIssues(parsed.error)}`);
  const file = join(pagesDir(root), `${slug}.json`);
  writeJsonAtomic(file, parsed.data);
  const open = parsed.data.atoms.filter((atom) => atom.must && atom.status !== "live").length;
  appendLedger(root, {
    kind: "note",
    summary: `Page audit ${parsed.data.page}: ${parsed.data.atoms.length} atoms, ${open} open must-fix`,
    links: [`.forge/pages/${slug}.json`],
  });
  return { path: `.forge/pages/${slug}.json`, open };
}

export function listPageAudits(root: string): (PageAudit & { slug: string })[] {
  const dir = pagesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed = PageAudit.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
      return parsed.success ? [{ ...parsed.data, slug: name.slice(0, -5) }] : [];
    });
}

// ── Git hooks: keep the product map in sync on every commit / merge ─────────

const HOOK_MARK = "# forge: keep the product map in sync";

export function installGitHooks(root: string): string[] {
  const hooksDir = join(root, ".git", "hooks");
  if (!existsSync(hooksDir)) throw new Error(`${root} is not a git repository (no .git/hooks)`);
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const line = `"${process.execPath}" "${cli}" sync --quiet --no-graph --root "${root}" >/dev/null 2>&1 || true`;
  const installed: string[] = [];
  for (const hook of ["post-commit", "post-merge", "post-checkout"]) {
    const file = join(hooksDir, hook);
    const current = existsSync(file) ? readFileSync(file, "utf8") : "#!/bin/sh\n";
    if (current.includes(HOOK_MARK)) continue;
    writeFileSync(file, `${current.trimEnd()}\n${HOOK_MARK}\n${line}\n`);
    chmodSync(file, 0o755);
    installed.push(`.git/hooks/${hook}`);
  }
  return installed;
}

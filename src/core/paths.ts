import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

export const FORGE_DIR = ".forge";
export const CONFIG_FILE = "forge.config.yaml";

/**
 * Resolve the project root: FORGE_ROOT if set, otherwise the nearest ancestor of
 * `start` (default: cwd) containing .forge/ or forge.config.yaml, otherwise `start`.
 */
export function findRoot(start?: string): string {
  if (!start && process.env.FORGE_ROOT) return resolve(process.env.FORGE_ROOT);
  const origin = resolve(start ?? process.cwd());
  const top = parse(origin).root;
  let dir = origin;
  for (;;) {
    if (existsSync(join(dir, FORGE_DIR)) || existsSync(join(dir, CONFIG_FILE))) return dir;
    if (dir === top) return origin;
    dir = dirname(dir);
  }
}

export function layout(root: string) {
  const forge = join(root, FORGE_DIR);
  return {
    root,
    forge,
    config: join(root, CONFIG_FILE),
    state: join(forge, "state.json"),
    ledger: join(forge, "ledger.jsonl"),
    artifacts: join(forge, "artifacts"),
    gates: join(forge, "gates"),
    episodes: join(forge, "episodes"),
    learnings: join(forge, "learnings.md"),
    graphDir: join(forge, "graph"),
    trace: join(forge, "graph", "trace.json"),
    reviews: join(forge, "reviews"),
    releases: join(forge, "releases"),
    adr: join(forge, "adr"),
    graphifyGraph: join(root, "graphify-out", "graph.json"),
  };
}
export type Layout = ReturnType<typeof layout>;

/** User-level forge directory (~/.forge), overridable with FORGE_HOME. */
export function forgeHome(): string {
  return process.env.FORGE_HOME ? resolve(process.env.FORGE_HOME) : join(homedir(), ".forge");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Write via a temp file + rename so a crash never leaves half-written state. */
export function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

export function writeJsonAtomic(path: string, data: unknown): void {
  writeTextAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

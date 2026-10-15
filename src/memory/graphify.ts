import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { findOnPath, setting } from "../core/env.js";
import { layout } from "../core/paths.js";

/**
 * Bridge to graphify (https://pypi.org/project/graphifyy/), the code knowledge graph.
 * graphify is optional: every function degrades to a clear "not available" result.
 */

export const GRAPHIFY_INSTALL_HINT = "install graphify with `uv tool install graphifyy` (or `pip install graphifyy`)";

export function findGraphify(): string | null {
  // FORGE_GRAPHIFY_BIN overrides discovery; an empty value disables graphify.
  const override = setting("FORGE_GRAPHIFY_BIN");
  if (override !== undefined) return override || null;
  return findOnPath("graphify", { executable: true });
}

export interface GraphStatus {
  installed: boolean;
  binary: string | null;
  graphPath: string;
  graphExists: boolean;
}

export function graphStatus(root: string): GraphStatus {
  const binary = findGraphify();
  const graphPath = layout(root).graphifyGraph;
  return { installed: binary !== null, binary, graphPath, graphExists: existsSync(graphPath) };
}

export interface GraphResult {
  ok: boolean;
  output: string;
  error?: string;
}

function run(binary: string, args: string[], cwd: string, timeoutMs: number): Promise<GraphResult> {
  return new Promise((resolve) => {
    // execFile (no shell): questions and node names are passed as plain arguments.
    execFile(binary, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout).trim();
      if (error) resolve({ ok: false, output: out, error: String(stderr).trim() || error.message });
      else resolve({ ok: true, output: out });
    });
  });
}

async function withGraph(
  root: string,
  build: (status: GraphStatus & { binary: string }) => Promise<GraphResult>,
): Promise<GraphResult> {
  const status = graphStatus(root);
  if (!status.binary) return { ok: false, output: "", error: `graphify is not installed — ${GRAPHIFY_INSTALL_HINT}` };
  if (!status.graphExists) {
    return { ok: false, output: "", error: "no code graph yet — run `forge graph update` (or /graphify) first" };
  }
  return build({ ...status, binary: status.binary });
}

export function graphQuery(root: string, question: string, budget = 1500): Promise<GraphResult> {
  return withGraph(root, (s) =>
    run(s.binary, ["query", question, "--budget", String(budget), "--graph", s.graphPath], root, 60_000),
  );
}

export function graphPathBetween(root: string, from: string, to: string): Promise<GraphResult> {
  return withGraph(root, (s) => run(s.binary, ["path", from, to, "--graph", s.graphPath], root, 60_000));
}

export function graphExplain(root: string, node: string): Promise<GraphResult> {
  return withGraph(root, (s) => run(s.binary, ["explain", node, "--graph", s.graphPath], root, 60_000));
}

/** Incremental, LLM-free re-extraction of code files (`graphify update <root>`). */
export async function graphUpdate(root: string): Promise<GraphResult> {
  const binary = findGraphify();
  if (!binary) return { ok: false, output: "", error: `graphify is not installed — ${GRAPHIFY_INSTALL_HINT}` };
  return run(binary, ["update", root], root, 10 * 60_000);
}

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLockAt } from "../core/lock.js";
import { forgeHome, layout, nowIso, writeTextAtomic } from "../core/paths.js";
import { assertNoSecrets } from "./secrets.js";

export type LearningScope = "project" | "global";

export interface Learning {
  scope: LearningScope;
  text: string;
}

function learningsFile(root: string, scope: LearningScope): string {
  return scope === "global" ? join(forgeHome(), "global", "learnings.md") : layout(root).learnings;
}

/** Append a lesson. Project lessons live in the repo; global ones in ~/.forge/global. */
export function addLearning(
  root: string,
  text: string,
  options: { source?: string; scope?: LearningScope } = {},
): Learning {
  const scope = options.scope ?? "project";
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("A learning needs text");
  const line = `- ${nowIso().slice(0, 10)} — ${trimmed}${options.source ? ` _(source: ${options.source})_` : ""}`;
  assertNoSecrets(line, "learning");
  const file = learningsFile(root, scope);
  withLockAt(dirname(file), () => {
    if (!existsSync(file)) writeTextAtomic(file, "# Learnings\n\n");
    appendFileSync(file, `${line}\n`, "utf8");
  });
  return { scope, text: line };
}

export function listLearnings(root: string, scope: LearningScope | "all" = "all"): Learning[] {
  const scopes: LearningScope[] = scope === "all" ? ["project", "global"] : [scope];
  return scopes.flatMap((s) => {
    const file = learningsFile(root, s);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => ({ scope: s, text: line }));
  });
}

import { ARTIFACTS, loadArtifact } from "../core/artifacts.js";
import { Forge } from "../core/engine.js";
import { readLedger } from "../core/ledger.js";
import { errorMessage } from "../core/util.js";
import { computeGaps } from "../trace/trace.js";
import { listPageAudits, loadProductMap } from "../product/sync.js";
import { listEpisodes } from "./episodes.js";
import { graphQuery, type GraphResult } from "./graphify.js";
import { listLearnings } from "./learnings.js";

export type Intent = "status" | "why" | "coverage" | "code" | "history" | "spec";
export type MemorySource = "state" | "ledger" | "episode" | "learning" | "artifact" | "gaps" | "graph" | "product";

const INTENTS: ReadonlyArray<readonly [Intent, RegExp]> = [
  ["why", /\b(why|decid\w*|decision|chose|choose|chosen|rejected|alternatives?|trade-?offs?)\b/i],
  ["coverage", /\b(covered|coverage|gaps?|missing|tested|untested|traced?)\b/i],
  ["status", /\b(status|next|blocked|blockers?|progress|left|remaining|where are we)\b/i],
  ["code", /\b(where|which file|function|module|calls?|imports?|class|component|endpoint|how does)\b/i],
  ["history", /\b(when|history|last (time|session)|happened|previous|lessons?|learn\w*)\b/i],
];

export function classifyIntent(question: string): Intent {
  return INTENTS.find(([, pattern]) => pattern.test(question))?.[0] ?? "spec";
}

/** Relevance multipliers: each intent prefers the memory layer that answers it. */
const BOOST: Record<Intent, Partial<Record<MemorySource, number>>> = {
  why: { ledger: 3 },
  coverage: { gaps: 3, artifact: 1.5 },
  status: { state: 3, ledger: 1.5 },
  code: { graph: 3, product: 2 },
  history: { episode: 3, learning: 2 },
  spec: { artifact: 3, product: 1.5 },
};

const STOPWORDS = new Set(
  "the and for are was were what why how who when where which this that with from have has had does did our your their into about there been will would should could than then them they its it's is of to in on at by an a or as be we you i me my".split(" "),
);

export function terms(question: string): string[] {
  return [...new Set(question.toLowerCase().split(/[^a-z0-9_.-]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))];
}

function relevance(text: string, queryTerms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    let count = 0;
    for (let i = lower.indexOf(term); i !== -1 && count < 5; i = lower.indexOf(term, i + term.length)) count++;
    score += count;
  }
  return score;
}

interface Doc {
  source: MemorySource;
  ref: string;
  text: string;
}

export interface MemoryHit extends Doc {
  score: number;
}

export interface MemoryAnswer {
  question: string;
  intent: Intent;
  hits: MemoryHit[];
  graph?: GraphResult;
  /** Hits rendered as cited lines, trimmed to the token budget. */
  text: string;
}

/** Array fields that hold individually addressable items in each artifact. */
const ITEM_FIELDS = ["ideas", "criteria", "competitors", "personas", "stories", "screens", "specs", "tasks", "findings", "checks", "features", "gaps"];

function artifactDocs(root: string): Doc[] {
  const docs: Doc[] = [];
  for (const def of Object.values(ARTIFACTS)) {
    if (def.name === "trace") continue; // summarised by the gap report and product docs; raw JSON only adds noise
    let data: unknown;
    try {
      data = loadArtifact<unknown>(root, def.name);
    } catch {
      continue; // invalid artifacts are reported by gates, not by memory
    }
    if (data === undefined) continue;
    if (typeof data === "string") {
      docs.push({ source: "artifact", ref: def.path, text: data.slice(0, 4000) });
      continue;
    }
    const record = data as Record<string, unknown>;
    let itemized = false;
    for (const field of ITEM_FIELDS) {
      const items = record[field];
      if (!Array.isArray(items)) continue;
      itemized = true;
      items.forEach((item, index) => {
        const id = (item as { id?: string; name?: string }).id ?? (item as { name?: string }).name ?? String(index);
        docs.push({ source: "artifact", ref: `${def.name}#${id}`, text: JSON.stringify(item) });
      });
    }
    const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !ITEM_FIELDS.includes(key)));
    if (!itemized || Object.keys(rest).length) {
      docs.push({ source: "artifact", ref: def.name, text: JSON.stringify(rest).slice(0, 4000) });
    }
  }
  return docs;
}

/** The product map (pages, endpoints, calls) and page audits of an adopted product. */
function productDocs(root: string): Doc[] {
  const docs: Doc[] = [];
  try {
    const map = loadProductMap(root);
    for (const s of map?.surfaces ?? []) {
      const callers = (map?.calls ?? []).filter((c) => c.to === s.id).map((c) => c.from);
      const label = `${s.kind} ${s.method ? `${s.method} ` : ""}${s.route}`;
      docs.push({ source: "product", ref: s.id, text: `${label} in ${s.file} (${s.framework})${callers.length ? `; called from ${callers.join(", ")}` : ""}` });
    }
    for (const audit of listPageAudits(root)) {
      const open = audit.atoms.filter((a) => a.must && a.status !== "live").map((a) => `${a.label} (${a.break ?? a.status})`);
      docs.push({ source: "product", ref: `page-audit ${audit.slug}`, text: `page ${audit.page}: job "${audit.job}" for ${audit.who}; ${audit.atoms.length} atoms; open must-fix: ${open.join(", ") || "none"}` });
    }
  } catch {
    // an invalid map is reported by product_sync / the understand gate
  }
  return docs;
}

function stateDoc(root: string): Doc {
  try {
    const status = new Forge(root).status();
    const lines = status.stages.map((stage) => `${stage.id}: ${stage.status}`);
    const blockers = status.blockers.map((blocker) => `${blocker.id} ${blocker.need}`);
    return {
      source: "state",
      ref: "state.json",
      text: `project ${status.project}; next stage: ${status.next ?? "none"}; stages — ${lines.join(", ")}${blockers.length ? `; blockers — ${blockers.join(", ")}` : ""}`,
    };
  } catch (error) {
    return { source: "state", ref: "state.json", text: errorMessage(error) };
  }
}

function gapsDoc(root: string): Doc {
  const report = computeGaps(root);
  const gaps = report.gaps.map((gap) => `${gap.story} missing ${gap.missing}`).join(", ");
  return {
    source: "gaps",
    ref: "trace/gaps",
    text: `coverage ${Math.round(report.coverage * 100)}% (${report.satisfied}/${report.required})${gaps ? `; gaps: ${gaps}` : ""}${report.notes.length ? `; notes: ${report.notes.join("; ")}` : ""}`,
  };
}

/**
 * Answer "what has been built, why, and what's left" from every memory layer,
 * with a citation per hit. graphify is consulted for code questions (or when
 * nothing else matched) if it is installed and a graph exists.
 */
export async function queryMemory(
  root: string,
  question: string,
  options: { budgetTokens?: number; useGraph?: boolean } = {},
): Promise<MemoryAnswer> {
  const intent = classifyIntent(question);
  const queryTerms = terms(question);
  const budgetTokens = options.budgetTokens ?? 1500;

  const docs: Doc[] = [stateDoc(root)];
  for (const entry of readLedger(root)) {
    const parts = [`${entry.summary}`, entry.why ? `why: ${entry.why}` : "", entry.rejected.length ? `rejected: ${entry.rejected.join("; ")}` : ""];
    docs.push({ source: "ledger", ref: `${entry.id}${entry.stage ? ` (${entry.stage})` : ""}`, text: parts.filter(Boolean).join(" — ") });
  }
  const episodes = listEpisodes(root);
  for (const episode of episodes) docs.push({ source: "episode", ref: episode.file, text: episode.text.slice(0, 3000) });
  for (const learning of listLearnings(root)) docs.push({ source: "learning", ref: `${learning.scope} learnings`, text: learning.text });
  docs.push(...artifactDocs(root));
  docs.push(...productDocs(root));
  if (intent === "coverage") docs.push(gapsDoc(root));

  // Some questions are answered by one layer whatever the word overlap: "what's next?" by
  // state, "what's missing?" by the gap report, "what happened last time?" by the newest episodes.
  const recent = episodes.slice(0, 3).map((episode) => episode.file);
  const pinned = (doc: Doc): number => {
    if (doc.source === "state" && intent === "status") return 100;
    if (doc.source === "gaps") return 100;
    if (doc.source === "episode" && intent === "history" && recent.includes(doc.ref)) return 100 - recent.indexOf(doc.ref);
    return 0;
  };
  const hits: MemoryHit[] = docs
    .map((doc) => ({ ...doc, score: relevance(`${doc.ref} ${doc.text}`, queryTerms) * (BOOST[intent][doc.source] ?? 1) + pinned(doc) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  let graph: GraphResult | undefined;
  if (options.useGraph !== false && (intent === "code" || hits.length === 0)) {
    graph = await graphQuery(root, question, Math.min(budgetTokens, 2000));
    if (graph.ok && graph.output) {
      hits.unshift({ source: "graph", ref: "graphify", text: graph.output, score: Number.MAX_SAFE_INTEGER });
    }
  }

  const maxChars = budgetTokens * 4;
  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const line = `[${hit.source} ${hit.ref}] ${hit.text}`;
    const room = maxChars - used;
    if (room <= 80) break;
    lines.push(line.length > room ? `${line.slice(0, room - 1)}…` : line);
    used += Math.min(line.length, room) + 1;
  }
  return {
    question,
    intent,
    hits,
    graph,
    text: lines.length ? lines.join("\n") : "Nothing in forge memory matches this question yet.",
  };
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { loadArtifact, writeArtifact } from "../core/artifacts.js";
import { withLock } from "../core/lock.js";
import { errorMessage } from "../core/util.js";
import { TraceEdgeType, TraceNodeType, type Prd, type Screens, type Trace } from "../schemas/artifacts.js";

/** What every MVP story needs before it can ship. */
export const STORY_REQUIREMENTS = ["designedBy", "implementedBy", "verifiedBy"] as const;
export type StoryRequirement = (typeof STORY_REQUIREMENTS)[number];

const HINTS: Record<StoryRequirement, string> = {
  designedBy: "add a screen whose storyIds include it, or `forge trace link story:<id> screen:<id> designedBy`",
  implementedBy: "`forge trace link story:<id> code:<path> implementedBy`",
  verifiedBy: "`forge trace link story:<id> test:<path> verifiedBy`",
};

export interface Gap {
  story: string;
  missing: StoryRequirement;
  message: string;
}

export interface GapReport {
  coverage: number;
  required: number;
  satisfied: number;
  gaps: Gap[];
  notes: string[];
}

function storyId(nodeId: string): string {
  return nodeId.startsWith("story:") ? nodeId.slice("story:".length) : nodeId;
}

function tryLoad<T>(root: string, name: string, notes: string[]): T | undefined {
  try {
    return loadArtifact<T>(root, name);
  } catch (error) {
    notes.push(errorMessage(error));
    return undefined;
  }
}

/** Compare the PRD's MVP stories against the traceability graph and screen inventory. */
export function computeGaps(root: string): GapReport {
  const notes: string[] = [];
  const prd = tryLoad<Prd>(root, "prd", notes);
  if (!prd) {
    return { coverage: 0, required: 0, satisfied: 0, gaps: [], notes: [...notes, "no PRD — nothing to trace against"] };
  }
  const trace = tryLoad<Trace>(root, "trace", notes) ?? { nodes: [], edges: [] };
  const screens = tryLoad<Screens>(root, "screens", notes);

  const links = new Map<string, Set<string>>();
  const mark = (story: string, type: string) => {
    if (!links.has(story)) links.set(story, new Set());
    links.get(story)?.add(type);
  };
  for (const edge of trace.edges) if (edge.from.startsWith("story:")) mark(storyId(edge.from), edge.type);
  for (const screen of screens?.screens ?? []) for (const id of screen.storyIds) mark(id, "designedBy");

  let stories = prd.stories.filter((story) => story.mvp);
  if (!stories.length) {
    notes.push("no story is marked mvp — tracing all 'must' stories instead");
    stories = prd.stories.filter((story) => story.priority === "must");
  }

  const gaps: Gap[] = [];
  for (const story of stories) {
    for (const requirement of STORY_REQUIREMENTS) {
      if (!links.get(story.id)?.has(requirement)) {
        gaps.push({
          story: story.id,
          missing: requirement,
          message: `${story.id} has no ${requirement} link — ${HINTS[requirement].replaceAll("<id>", story.id)}`,
        });
      }
    }
  }
  const required = stories.length * STORY_REQUIREMENTS.length;
  const satisfied = required - gaps.length;
  return { coverage: required ? satisfied / required : 0, required, satisfied, gaps, notes };
}

/** Add a typed edge (and its nodes) to .forge/graph/trace.json. Node ids are "<type>:<name>". */
export function linkTrace(root: string, from: string, to: string, type: string): Trace {
  return withLock(root, () => linkTraceUnlocked(root, from, to, type));
}

function linkTraceUnlocked(root: string, from: string, to: string, type: string): Trace {
  const edgeType = TraceEdgeType.parse(type);
  const trace = loadArtifact<Trace>(root, "trace") ?? { nodes: [], edges: [] };
  for (const id of [from, to]) {
    const nodeType = TraceNodeType.safeParse(id.split(":", 1)[0]);
    if (!nodeType.success || !id.includes(":")) {
      throw new Error(`Trace node "${id}" must look like <type>:<name> with type one of ${TraceNodeType.options.join(", ")}`);
    }
    if (!trace.nodes.some((node) => node.id === id)) trace.nodes.push({ id, type: nodeType.data });
  }
  if (!trace.edges.some((edge) => edge.from === from && edge.to === to && edge.type === edgeType)) {
    trace.edges.push({ from, to, type: edgeType });
  }
  writeArtifact(root, "trace", trace);
  return trace;
}

// ── Placeholder scan ─────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go", ".rb",
  ".java", ".kt", ".swift", ".dart", ".cs", ".php", ".rs",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".expo", "coverage", "vendor",
  "__tests__", "test", "tests", "e2e", "fixtures", "__mocks__", ".forge", "graphify-out",
]);
const TEST_FILE = /\.(test|spec|stories)\.[a-z]+$/i;
// Target what fabricated data looks like in code (mock-prefixed identifiers, comments
// saying so) rather than prose, so UI copy such as "No data yet" is not flagged.
// Written with character classes / \s+ so this file never matches its own patterns.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /lorem\s+ipsum/i,
  /\b(?:fake|dummy|mock|placeholder|sample)[_-]?(?:data|users?|items?|products?|orders?|posts?|records?|responses?)\b/i,
  /(?:\/\/|#|\/\*|^\s*\*).*\b(?:fake|dummy|mock|placeholder|hard-?coded)\s+(?:data|values?|users?|response)\b/i,
  /\bnot\s+implemented\b/i,
  /\b(?:TO[D]O|FIX[M]E)\b.*\b(?:replace|implement|fake|mock|placeholder|hardcode)/i,
];

export interface PlaceholderHit {
  file: string;
  line: number;
  text: string;
}

export function scanPlaceholders(root: string, dirs: string[], limit = 50): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  let filesSeen = 0;
  const walk = (dir: string) => {
    if (hits.length >= limit || filesSeen > 20_000) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(full);
        continue;
      }
      if (!CODE_EXTENSIONS.has(extname(name)) || TEST_FILE.test(name) || stat.size > 1_000_000) continue;
      filesSeen++;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (hits.length < limit && PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
            hits.push({ file: relative(root, full), line: index + 1, text: text.trim().slice(0, 160) });
          }
        });
    }
  };
  for (const dir of dirs) {
    const full = join(root, dir);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  }
  return hits;
}

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../core/lock.js";
import { layout, nowIso, writeTextAtomic } from "../core/paths.js";
import { assertNoSecrets } from "./secrets.js";

export interface EpisodeInput {
  goal: string;
  done?: string[];
  decisions?: string[];
  openThreads?: string[];
  next?: string;
  stage?: string;
}

export interface Episode {
  file: string;
  at: string;
  stage?: string;
  text: string;
}

function section(title: string, items: string[] | undefined): string {
  if (!items?.length) return "";
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}\n\n`;
}

/** Save a session summary as .forge/episodes/YYYY-MM-DD-n.md. */
export function saveEpisode(root: string, input: EpisodeInput): Episode {
  // Locked: the file number is derived from what is on disk.
  return withLock(root, () => saveEpisodeUnlocked(root, input));
}

function saveEpisodeUnlocked(root: string, input: EpisodeInput): Episode {
  if (!input.goal.trim()) throw new Error("An episode needs a goal");
  const dir = layout(root).episodes;
  mkdirSync(dir, { recursive: true });
  const at = nowIso();
  const day = at.slice(0, 10);
  let n = readdirSync(dir).filter((name) => name.startsWith(day)).length + 1;
  while (existsSync(join(dir, `${day}-${n}.md`))) n++;
  const file = `${day}-${n}.md`;

  const frontmatter = ["---", `at: ${at}`, ...(input.stage ? [`stage: ${input.stage}`] : []), "---"].join("\n");
  const text =
    `${frontmatter}\n\n# ${input.goal.trim()}\n\n` +
    section("Done", input.done) +
    section("Decisions", input.decisions) +
    section("Open threads", input.openThreads) +
    (input.next ? `## Next\n\n${input.next.trim()}\n` : "");

  assertNoSecrets(text, "episode");
  writeTextAtomic(join(dir, file), text);
  return { file: `.forge/episodes/${file}`, at, stage: input.stage, text };
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const index = line.indexOf(":");
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return fields;
}

/** Episodes, newest first. */
export function listEpisodes(root: string): Episode[] {
  const dir = layout(root).episodes;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      const fields = parseFrontmatter(text);
      return { file: `.forge/episodes/${name}`, at: fields.at ?? "", stage: fields.stage, text };
    })
    // Same-millisecond episodes tie on `at`; the file's sequence number breaks the tie.
    .sort((a, b) => b.at.localeCompare(a.at) || b.file.localeCompare(a.file, undefined, { numeric: true }));
}

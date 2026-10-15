import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact } from "../core/artifacts.js";
import { listProjectFiles } from "../product/scan.js";
import type { Prd, Screens } from "../schemas/artifacts.js";
import { linkTrace } from "../trace/trace.js";

/**
 * QA plan and coverage: every acceptance criterion of an MVP story is a test case
 * with a stable id (`S-1/AC1`). Tests claim a case by carrying the tag `@S-1/AC1` in
 * their title, tag list or a comment (Playwright, Vitest/Jest, pytest, Maestro).
 * Coverage is computed from the test files on disk; the e2e/test commands prove the
 * tagged tests actually pass.
 */

export interface QaCase {
  id: string;
  story: string;
  text: string;
  /** Where the story's screens live: web → Playwright, ios/android → Maestro, none → API tests. */
  tool: "playwright" | "maestro" | "api";
  suggestedFile: string;
}

export interface QaCoverage {
  required: number;
  covered: { id: string; files: string[] }[];
  missing: QaCase[];
  ratio: number;
  /** Tags in tests that match no acceptance criterion (typos or removed stories). */
  unknownTags: { tag: string; file: string }[];
  testFiles: number;
}

const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|spec|\.maestro|maestro|playwright)\/|\.(test|spec|e2e)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$/i;
const TAG = /@?\b([A-Za-z][\w.-]*\/AC\d+)\b/g;

const slug = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function qaPlan(root: string): QaCase[] {
  const prd = loadArtifact<Prd>(root, "prd");
  if (!prd) throw new Error("No PRD yet — the spec stage writes it (artifact_write prd)");
  let screens: Screens | undefined;
  try {
    screens = loadArtifact<Screens>(root, "screens");
  } catch {
    screens = undefined;
  }
  return prd.stories
    .filter((story) => story.mvp && story.priority !== "wont")
    .flatMap((story) => {
      const platforms = new Set((screens?.screens ?? []).filter((s) => s.storyIds.includes(story.id)).map((s) => s.platform as string));
      const tool: QaCase["tool"] = platforms.has("web") ? "playwright" : platforms.has("ios") || platforms.has("android") ? "maestro" : platforms.size ? "playwright" : "api";
      const suggestedFile = tool === "maestro" ? `.maestro/${slug(story.id)}.yaml` : tool === "playwright" ? `e2e/${slug(story.id)}.spec.ts` : `tests/${slug(story.id)}.test.ts`;
      return story.acceptance.map((ac, i) => ({
        id: `${story.id}/AC${i + 1}`,
        story: story.id,
        text: `Given ${ac.given}, when ${ac.when}, then ${ac.then}`,
        tool,
        suggestedFile,
      }));
    });
}

export function qaCoverage(root: string, options: { link?: boolean } = {}): QaCoverage {
  const cases = qaPlan(root);
  const known = new Map(cases.map((c) => [c.id, c]));
  const filesByCase = new Map<string, Set<string>>();
  const unknownTags: QaCoverage["unknownTags"] = [];
  const listed = listProjectFiles(root);
  // Maestro flows live in a dot-directory that the non-git file walk skips.
  const maestro = existsSync(join(root, ".maestro")) ? readdirSync(join(root, ".maestro")).map((name) => `.maestro/${name}`) : [];
  const testFiles = [...new Set([...listed, ...maestro])].filter((file) => TEST_FILE.test(file) && /\.(?:[cm]?[jt]sx?|py|ya?ml|feature)$/.test(file));
  for (const file of testFiles) {
    let text: string;
    try {
      if (statSync(join(root, file)).size > 1_000_000) continue;
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(TAG)) {
      const tag = match[1] ?? "";
      if (known.has(tag)) {
        const set = filesByCase.get(tag) ?? new Set<string>();
        set.add(file);
        filesByCase.set(tag, set);
      } else if (!unknownTags.some((u) => u.tag === tag && u.file === file)) {
        unknownTags.push({ tag, file });
      }
    }
  }
  const covered = [...filesByCase].map(([id, files]) => ({ id, files: [...files].sort() }));
  if (options.link) {
    for (const { id, files } of covered) {
      const story = known.get(id)?.story;
      for (const file of files) if (story) linkTrace(root, `story:${story}`, `test:${file}`, "verifiedBy");
    }
  }
  const missing = cases.filter((c) => !filesByCase.has(c.id));
  return {
    required: cases.length,
    covered: covered.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    missing,
    ratio: cases.length ? (cases.length - missing.length) / cases.length : 1,
    unknownTags,
    testFiles: testFiles.length,
  };
}

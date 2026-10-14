import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { Forge } from "../src/core/engine.js";

const roots: string[] = [];

/** Isolate every test: no real graphify, no real ~/.forge. */
export function isolate(): void {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "forge-home-"));
    process.env.FORGE_HOME = home;
    process.env.FORGE_GRAPHIFY_BIN = "";
    delete process.env.FORGE_ROOT;
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
}

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-test-"));
  roots.push(dir);
  return dir;
}

export function tmpProject(options: { autonomy?: "auto" | "checkpoint" | "strict"; packs?: string[] } = {}): string {
  const root = tempDir();
  Forge.init(root, { name: "test-app" });
  if (options.autonomy) editConfig(root, (text) => text.replace("autonomy: checkpoint", `autonomy: ${options.autonomy}`));
  if (options.packs) editConfig(root, (text) => text.replace("packs: []", `packs: [${options.packs?.join(", ")}]`));
  return root;
}

export function editConfig(root: string, edit: (text: string) => string): void {
  const file = join(root, "forge.config.yaml");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
}

export function setCommand(root: string, name: "build" | "test" | "e2e" | "lint", command: string): void {
  editConfig(root, (text) => text.replace(new RegExp(`^  ${name}:.*$`, "m"), `  ${name}: ${JSON.stringify(command)}`));
}

// ── Fixtures (synthetic test data) ───────────────────────────────────────────

const AT = "2026-10-14T00:00:00.000Z";

export const evidence = (i: number) => ({ url: `https://example.com/source-${i}`, quote: `quote ${i}`, retrievedAt: AT });

export const brainstorm = (chosenId?: string) => ({
  theme: "habits",
  ideas: [
    { id: "I-1", title: "Habit coach", oneLiner: "Streak-based habit coach" },
    { id: "I-2", title: "Focus timer", oneLiner: "Pomodoro with friends" },
  ],
  ...(chosenId ? { chosenId } : {}),
});

export const vision = (antiGoals = 3) => ({
  northStar: "Weekly active habit streaks",
  problem: "People drop habits after a week",
  audience: "Busy professionals",
  principles: ["Tiny steps"],
  antiGoals: Array.from({ length: antiGoals }, (_, i) => `anti-goal ${i + 1}`),
  successMetrics: [{ name: "WAU with streak ≥ 3" }],
});

/** 10 yes (each with distinct evidence) + 2 no → score 83. */
export const validation = (overrides: Record<string, unknown> = {}) => ({
  idea: "Streak-based habit coach",
  criteria: [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `C-${i + 1}`,
      group: "problem",
      question: `question ${i + 1}?`,
      answer: "yes",
      evidence: [evidence(i + 1)],
    })),
    { id: "C-11", group: "risk", question: "No blocking risk?", answer: "no" },
    { id: "C-12", group: "monetization", question: "Willingness to pay?", answer: "no" },
  ],
  score: 83,
  verdict: "go",
  ...overrides,
});

export const competitors = (count = 5) => ({
  competitors: Array.from({ length: count }, (_, i) => ({ name: `Competitor ${i + 1}`, segment: "direct" })),
});

export const prd = () => ({
  title: "Habit coach MVP",
  goals: ["Help users keep a 3-day streak"],
  stories: [
    {
      id: "S-1",
      as: "a user",
      iWant: "to check in daily",
      soThat: "my streak grows",
      priority: "must",
      mvp: true,
      acceptance: [{ given: "a habit", when: "I tap check in", then: "the streak increments" }],
    },
    {
      id: "S-2",
      as: "a user",
      iWant: "reminders",
      soThat: "I don't forget",
      priority: "should",
      mvp: true,
      acceptance: [{ given: "a reminder time", when: "it arrives", then: "I get a notification" }],
    },
  ],
});

export const screens = (states = ["empty", "loading", "error", "success"]) => ({
  screens: [
    { id: "checkin", storyIds: ["S-1"], route: "/checkin", platform: "web", states },
    { id: "reminders", storyIds: ["S-2"], route: "/reminders", platform: "web", states },
  ],
});

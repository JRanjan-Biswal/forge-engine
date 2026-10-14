import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { Forge } from "../src/core/engine.js";
import { appendLedger, readLedger } from "../src/core/ledger.js";
import { listEpisodes, saveEpisode } from "../src/memory/episodes.js";
import { addLearning, listLearnings } from "../src/memory/learnings.js";
import { classifyIntent, queryMemory } from "../src/memory/query.js";
import { findSecrets, SecretError } from "../src/memory/secrets.js";
import { isolate, prd, tmpProject } from "./helpers.js";

isolate();

describe("ledger", () => {
  it("assigns sequential ids and refuses secrets", () => {
    const root = tmpProject();
    expect(readLedger(root)[0]?.kind).toBe("init");
    const entry = appendLedger(root, { kind: "decision", summary: "Use Supabase", why: "RLS", rejected: ["Firebase"] });
    expect(entry.id).toBe("D-2");
    // Built at runtime so repository secret scanners don't flag the dummy key.
    expect(() => appendLedger(root, { kind: "note", summary: `key ${"AKIA"}${"ABCDEFGHIJKLMNOP"}` })).toThrow(SecretError);
    expect(readLedger(root)).toHaveLength(2);
  });

  it("detects common credential formats", () => {
    expect(findSecrets("ghp_" + "a".repeat(36))).toEqual(["GitHub token"]);
    expect(findSecrets(`-----BEGIN RSA ${"PRIVATE"} KEY-----`)).toEqual(["private key"]);
    expect(findSecrets("just a normal sentence about keys")).toEqual([]);
  });
});

describe("episodes and learnings", () => {
  it("saves numbered episodes and lists newest first", () => {
    const root = tmpProject();
    const first = saveEpisode(root, { goal: "Validate the idea", done: ["scorecard"], next: "write PRD", stage: "validate" });
    const second = saveEpisode(root, { goal: "Write the PRD" });
    expect(first.file).toMatch(/-1\.md$/);
    expect(second.file).toMatch(/-2\.md$/);
    const episodes = listEpisodes(root);
    expect(episodes).toHaveLength(2);
    expect(episodes[1]?.stage).toBe("validate");
    expect(episodes[1]?.text).toContain("## Next\n\nwrite PRD");
  });

  it("keeps project and global learnings apart", () => {
    const root = tmpProject();
    addLearning(root, "Design critic flags off-token spacing", { source: "design gate" });
    addLearning(root, "Always set commands.test before build", { scope: "global" });
    expect(listLearnings(root, "project")).toHaveLength(1);
    expect(listLearnings(root, "global")).toHaveLength(1);
    expect(existsSync(join(process.env.FORGE_HOME!, "global", "learnings.md"))).toBe(true);
  });
});

describe("memory query", () => {
  it("classifies intents", () => {
    expect(classifyIntent("Why did we choose Supabase?")).toBe("why");
    expect(classifyIntent("what is next?")).toBe("status");
    expect(classifyIntent("is S-2 tested?")).toBe("coverage");
    expect(classifyIntent("which file handles checkout")).toBe("code");
    expect(classifyIntent("what happened last session")).toBe("history");
    expect(classifyIntent("reminder notifications acceptance criteria")).toBe("spec");
  });

  it("answers why-questions from the ledger with citations", async () => {
    const root = tmpProject();
    appendLedger(root, { kind: "decision", stage: "architect", summary: "Use Expo + Supabase", why: "single TS codebase and RLS", rejected: ["Flutter"] });
    const answer = await queryMemory(root, "why did we choose supabase?");
    expect(answer.intent).toBe("why");
    expect(answer.hits[0]?.source).toBe("ledger");
    expect(answer.text).toMatch(/\[ledger D-2 \(architect\)\] Use Expo \+ Supabase — why: single TS codebase/);
  });

  it("answers spec questions from artifacts and status questions from state", async () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    const spec = await queryMemory(root, "reminders notification");
    expect(spec.hits[0]?.ref).toBe("prd#S-2");

    new Forge(root).start("brainstorm");
    const status = await queryMemory(root, "what is next?");
    expect(status.text).toMatch(/next stage: brainstorm/);
  });

  it("answers history questions from the newest episodes even without word overlap", async () => {
    const root = tmpProject();
    writeArtifact(root, "brainstorm", { ideas: [{ id: "I-1", title: "Focus rooms", oneLiner: "Co-working focus sessions" }] });
    saveEpisode(root, { goal: "Ship the MVP", done: ["14 gates passed"] });
    const answer = await queryMemory(root, "what happened last session?");
    expect(answer.intent).toBe("history");
    expect(answer.hits[0]?.source).toBe("episode");
  });

  it("reports coverage and degrades gracefully without graphify", async () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    const coverage = await queryMemory(root, "what is missing for S-1?");
    expect(coverage.text).toMatch(/S-1 missing designedBy/);

    const code = await queryMemory(root, "which file handles checkout?");
    expect(code.graph?.ok).toBe(false);
    expect(code.graph?.error).toMatch(/not installed/);
  });
});

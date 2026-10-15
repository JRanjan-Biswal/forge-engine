import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { Forge } from "../src/core/engine.js";
import { readLedger } from "../src/core/ledger.js";
import { editConfig, isolate, prd, screens, setCommand, tmpProject, validation } from "./helpers.js";

isolate();

async function gate(root: string, stage: string) {
  const forge = new Forge(root);
  forge.start(stage, { force: true });
  const result = await forge.complete(stage);
  const failing = Object.fromEntries(result.checks.filter((c) => c.status === "fail").map((c) => [c.id, c.message]));
  const skipped = result.checks.filter((c) => c.status === "skip").map((c) => c.id);
  return { result, failing, skipped };
}

describe("validation gate", () => {
  it("rejects 'yes' answers without evidence and inconsistent scores", async () => {
    const root = tmpProject({ autonomy: "auto" });
    const bad = validation();
    (bad.criteria as { evidence?: unknown[] }[])[0]!.evidence = [];
    writeArtifact(root, "validation", { ...bad, score: 50 });
    const { failing } = await gate(root, "validate");
    expect(failing["validation-evidenceRule"]).toMatch(/C-1/);
    expect(failing["validation-scoreConsistent"]).toMatch(/give 83/);
    expect(failing["min-score"]).toMatch(/score = 50, needs >= 65/);
    expect(failing["competitors-valid"]).toMatch(/missing/);
  });

  it("reads thresholds from forge.config.yaml", async () => {
    const root = tmpProject({ autonomy: "auto" });
    editConfig(root, (text) => text.replace("minScore: 65", "minScore: 90"));
    writeArtifact(root, "validation", validation());
    const { failing } = await gate(root, "validate");
    expect(failing["min-score"]).toMatch(/needs >= 90/);
  });

  it("turns kill / pivot / needs-experiment verdicts into a decision", async () => {
    const root = tmpProject({ autonomy: "auto" });
    writeArtifact(root, "validation", validation({ verdict: "kill" }));
    expect((await gate(root, "validate")).failing["validation-verdictGo"]).toMatch(/forge archive/);
  });
});

describe("command checks", () => {
  it("fails unconfigured commands instead of assuming they pass", async () => {
    const root = tmpProject();
    const { failing } = await gate(root, "build");
    expect(failing.build).toMatch(/commands.build in forge.config.yaml is not configured/);
  });

  it("runs configured commands and reports exit codes", async () => {
    const root = tmpProject();
    setCommand(root, "build", "node -e \"process.exit(0)\"");
    setCommand(root, "test", "node -e \"console.error('3 tests failed'); process.exit(3)\"");
    const { failing } = await gate(root, "build");
    expect(failing.build).toBeUndefined();
    expect(failing.test).toMatch(/exited 3/);
    expect(failing.test).toMatch(/3 tests failed/);
  });

  it("skips optional commands that are not configured", async () => {
    const root = tmpProject();
    writeArtifact(root, "reviews", { findings: [] });
    writeArtifact(root, "prd", prd());
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "streak.test.ts"), 'test("check-in grows the streak @S-1/AC1", () => {});\ntest("reminder arrives @S-2/AC1", () => {});\n');
    const { result, skipped } = await gate(root, "verify");
    expect(skipped).toEqual(["security-headers", "e2e", "lint", "audit"]);
    expect(result.passed).toBe(true);
  });

  it("redacts secrets that leak into command output", async () => {
    const root = tmpProject();
    setCommand(root, "build", "node -e \"console.log('key=sk-ant-' + 'a'.repeat(30)); process.exit(1)\"");
    const { failing } = await gate(root, "build");
    const secret = `sk-ant-${"a".repeat(30)}`;
    expect(failing.build).toContain("key=[REDACTED]");
    expect(failing.build).not.toContain(secret);
    expect(readLedger(root).at(-1)?.summary).not.toContain(secret);
  });
});

describe("design, planning and review gates", () => {
  it("requires every UI state, MVP story coverage and a fresh rubric", async () => {
    const root = tmpProject({ autonomy: "auto" });
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "screens", screens(["success"]));
    const { failing } = await gate(root, "design");
    expect(failing["design-states"]).toMatch(/checkin \(empty\/loading\/error\)/);
    expect(failing["design-tokens"]).toMatch(/design\/tokens is missing/);
    expect(failing["design-critique"]).toMatch(/no rubric result/);
    expect(failing["design-storyCoverage"]).toBeUndefined();
  });

  it("passes design with tokens, states and a rubric from a judge", async () => {
    const root = tmpProject({ autonomy: "auto" });
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "screens", screens());
    const forge = new Forge(root);
    forge.start("design", { force: true });
    mkdirSync(join(root, "design", "tokens"), { recursive: true });
    writeFileSync(
      join(root, "design", "tokens", "semantic.tokens.json"),
      JSON.stringify({ color: { $type: "color", text: { $value: "#1A1A2E" }, bg: { $value: "#FFFFFF" } } }),
    );
    writeFileSync(join(root, "design", "contrast.json"), JSON.stringify({ pairs: [{ fg: "color.text", bg: "color.bg" }] }));
    writeFileSync(
      join(root, ".forge", "gates", "design.rubric.json"),
      JSON.stringify({ judge: "model-b", producer: "model-a", criteria: Array.from({ length: 10 }, (_, i) => ({ id: `R-${i}`, question: `q${i}?`, pass: true })) }),
    );
    const result = await forge.complete("design");
    expect(result.checks.filter((c) => c.status === "fail")).toEqual([]);
  });

  it("detects task dependency cycles and missing story coverage", async () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "tasks", {
      tasks: [
        { id: "T-1", title: "a", dept: "frontend", storyIds: ["S-1"], deps: ["T-2"] },
        { id: "T-2", title: "b", dept: "backend", deps: ["T-1"] },
      ],
    });
    const { failing } = await gate(root, "plan");
    expect(failing["tasks-dag"]).toMatch(/cycle: T-1 → T-2 → T-1/);
    expect(failing["tasks-storyCoverage"]).toMatch(/S-2/);
  });

  it("blocks on open critical/high findings only", async () => {
    const root = tmpProject();
    writeArtifact(root, "reviews", {
      findings: [
        { id: "F-1", severity: "high", category: "security", file: "src/api.ts", claim: "SQL injection" },
        { id: "F-2", severity: "critical", category: "bug", file: "src/a.ts", claim: "crash", status: "fixed" },
        { id: "F-3", severity: "low", category: "style", file: "src/b.ts", claim: "naming" },
      ],
    });
    const { failing } = await gate(root, "verify");
    expect(failing["review-noBlocking"]).toBe("open blocking findings: F-1 (high, src/api.ts)");
  });
});

describe("autonomy", () => {
  it("strict adds a human check to every stage; auto skips them", async () => {
    const strict = tmpProject({ autonomy: "strict" });
    writeArtifact(strict, "prd", prd());
    expect((await gate(strict, "spec")).failing["human-approval"]).toMatch(/forge approve spec/);

    const auto = tmpProject({ autonomy: "auto" });
    writeArtifact(auto, "prd", prd());
    const { result, skipped } = await gate(auto, "spec");
    expect(result.passed).toBe(true);
    expect(skipped).toEqual([]);
  });
});

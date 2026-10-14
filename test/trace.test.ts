import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { computeGaps, linkTrace, scanPlaceholders } from "../src/trace/trace.js";
import { isolate, prd, screens, tmpProject } from "./helpers.js";

isolate();

describe("traceability", () => {
  it("has nothing to trace without a PRD", () => {
    const report = computeGaps(tmpProject());
    expect(report.coverage).toBe(0);
    expect(report.notes).toContain("no PRD — nothing to trace against");
  });

  it("computes coverage from screens and trace links", () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "screens", screens());
    linkTrace(root, "story:S-1", "code:src/checkin.tsx", "implementedBy");
    linkTrace(root, "story:S-1", "test:e2e/checkin.spec.ts", "verifiedBy");
    linkTrace(root, "story:S-1", "test:e2e/checkin.spec.ts", "verifiedBy"); // idempotent

    const report = computeGaps(root);
    expect(report.required).toBe(6);
    expect(report.satisfied).toBe(4);
    expect(report.gaps.map((gap) => `${gap.story}:${gap.missing}`)).toEqual(["S-2:implementedBy", "S-2:verifiedBy"]);
  });

  it("validates node ids and edge types", () => {
    const root = tmpProject();
    expect(() => linkTrace(root, "S-1", "test:a", "verifiedBy")).toThrow(/<type>:<name>/);
    expect(() => linkTrace(root, "story:S-1", "test:a", "testedBy")).toThrow();
  });
});

describe("placeholder scan", () => {
  it("flags placeholder data in product code but not in tests", () => {
    const root = tmpProject();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "home.tsx"), "export const intro = 'Lorem ipsum dolor sit amet';\n");
    writeFileSync(join(root, "src", "home.test.tsx"), "const copy = 'lorem ipsum';\n");
    writeFileSync(join(root, "src", "api.ts"), "// TODO: replace with the real endpoint\nexport {};\n");
    writeFileSync(join(root, "src", "users.ts"), "export const mockUsers = [];\n// fake data until the API exists\n");
    writeFileSync(join(root, "src", "empty.tsx"), "export const empty = 'No data yet — add your first habit';\n");
    const hits = scanPlaceholders(root, ["src"]);
    expect(hits.map((hit) => `${hit.file}:${hit.line}`).sort()).toEqual([
      "src/api.ts:1",
      "src/home.tsx:1",
      "src/users.ts:1",
      "src/users.ts:2",
    ]);
  });

  it("does not flag forge's own source", () => {
    const repo = join(import.meta.dirname, "..");
    expect(scanPlaceholders(repo, ["src"])).toEqual([]);
  });
});

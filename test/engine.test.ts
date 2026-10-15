import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { Forge } from "../src/core/engine.js";
import { readLedger } from "../src/core/ledger.js";
import { brainstorm, competitors, editConfig, isolate, tempDir, tmpProject, validation, vision } from "./helpers.js";

isolate();

describe("pipeline", () => {
  it("runs, gates and resumes a 3-stage pipeline across restarts (Phase 1 exit criterion)", async () => {
    const root = tmpProject();
    let forge = new Forge(root);
    expect(forge.status().next).toBe("brainstorm");

    // Order is enforced.
    expect(() => forge.start("vision")).toThrow(/Earlier stages are not finished: brainstorm/);

    // Stage 1: the gate fails until the artifact exists and an idea is chosen.
    forge.start("brainstorm");
    let result = await forge.complete("brainstorm");
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === "brainstorm-valid")?.message).toMatch(/missing/);

    writeArtifact(root, "brainstorm", brainstorm());
    result = await forge.complete("brainstorm");
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === "brainstorm-chosen")?.status).toBe("fail");

    writeArtifact(root, "brainstorm", brainstorm("I-1"));
    expect((await forge.complete("brainstorm")).passed).toBe(true);

    // "Restart": a brand-new engine reads everything back from disk.
    forge = new Forge(root);
    const status = forge.status();
    expect(status.stages.find((s) => s.id === "brainstorm")?.status).toBe("passed");
    expect(status.next).toBe("vision");

    // Stage 2: a checkpoint stage waits for human approval.
    forge.start("vision");
    writeArtifact(root, "vision", vision());
    result = await forge.complete("vision");
    expect(result.passed).toBe(false);
    expect(result.checks.filter((c) => c.status === "fail").map((c) => c.id)).toEqual(["human-approval"]);
    forge.approve("vision", "tester");
    expect((await forge.complete("vision")).passed).toBe(true);

    // Stage 3: validation with evidence + competitors. The fixture evidence is not saved
    // through the evidence store here (that path is covered in evidence.test.ts).
    editConfig(root, (text) => text.replace("requireEvidenceStore: true", "requireEvidenceStore: false"));
    forge = new Forge(root);
    forge.start("validate");
    writeArtifact(root, "validation", validation());
    writeArtifact(root, "competitors", competitors());
    forge.approve("validate", "tester");
    const validated = await forge.complete("validate");
    expect(validated.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(validated.passed).toBe(true);

    expect(new Forge(root).status().next).toBe("spec");
    const gateEntries = readLedger(root).filter((entry) => entry.kind === "gate");
    expect(gateEntries.map((entry) => entry.summary.startsWith("Gate passed"))).toContain(true);
  });

  it("escalates with a decision memo after maxIterations failures", async () => {
    const root = tmpProject();
    editConfig(root, (text) => text.replace("maxIterations: 3", "maxIterations: 2"));
    const forge = new Forge(root);
    forge.start("brainstorm");
    expect((await forge.complete("brainstorm")).escalate).toBe(false);
    const second = await forge.complete("brainstorm");
    expect(second.escalate).toBe(true);
    expect(second.memo).toMatch(/forge override brainstorm/);
    expect(forge.status().stages[0]?.status).toBe("blocked");
  });

  it("records skip / override reasons and supports cascading reopen", async () => {
    const root = tmpProject({ autonomy: "auto" });
    const forge = new Forge(root);
    expect(() => forge.skip("brainstorm", "")).toThrow(/reason is required/);
    forge.skip("brainstorm", "idea already chosen elsewhere");
    forge.start("vision");
    forge.override("vision", "founder wrote the vision offline");
    expect(forge.status().next).toBe("validate");

    const ledger = readLedger(root);
    expect(ledger.find((e) => e.kind === "override")?.why).toBe("founder wrote the vision offline");

    expect(forge.reopen("brainstorm", "rethink", { cascade: true })).toEqual(forge.stages().map((s) => s.id));
    expect(forge.status().next).toBe("brainstorm");
  });

  it("only enables pack stages when the pack is configured, even after init", () => {
    const root = tmpProject();
    expect(new Forge(root).stages().map((s) => s.id)).not.toContain("motion");
    editConfig(root, (text) => text.replace("packs: []", "packs: [motion]"));
    const forge = new Forge(root);
    expect(forge.status().stages.find((s) => s.id === "motion")?.status).toBe("pending");
    expect(() => new Forge(tmpProject()).start("motion")).toThrow(/enable pack "motion"/);
  });

  it("blocks work on an archived project and tracks blockers", () => {
    const root = tmpProject();
    const forge = new Forge(root);
    const blocker = forge.addBlocker("STRIPE_SECRET_KEY for payments", "build");
    expect(blocker.id).toBe("B-1");
    expect(forge.status().blockers).toHaveLength(1);
    forge.resolveBlocker("B-1", "added to .env");
    expect(forge.status().blockers).toHaveLength(0);

    forge.archive("validation verdict was kill");
    expect(() => forge.start("brainstorm")).toThrow(/archived/);
    expect(forge.status().next).toBeNull();
  });

  it("explains a corrupt state.json instead of surfacing a raw JSON error", () => {
    const root = tmpProject();
    writeFileSync(join(root, ".forge", "state.json"), "{ not json");
    expect(() => new Forge(root).status()).toThrow(/\.forge\/state\.json is not valid JSON.*forge init --force/);
  });

  it("refuses to run before init", () => {
    expect(() => new Forge(tempDir()).status()).toThrow(/forge init/);
  });
});

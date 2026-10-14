import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { brainstorm, isolate, tempDir } from "./helpers.js";

isolate();

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("forge CLI", () => {
  it("prints help and version", async () => {
    expect((await cli("--help")).out).toMatch(/Usage: forge <command>/);
    expect((await cli("--version")).out).toMatch(/^\d+\.\d+\.\d+/);
    expect((await cli("frobnicate")).code).toBe(2);
  });

  it("runs a stage through init → start → artifact write → complete → status", async () => {
    const root = tempDir();
    expect((await cli("init", "--root", root, "--name", "cli-app")).out).toMatch(/\+ forge.config.yaml/);
    expect((await cli("init", "--root", root)).out).toMatch(/already initialised/);

    expect((await cli("start", "brainstorm", "--root", root)).code).toBe(0);
    const failed = await cli("complete", "brainstorm", "--root", root);
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/FAILED {2}brainstorm/);

    const file = join(root, "idea.json");
    writeFileSync(file, JSON.stringify(brainstorm("I-2")));
    expect((await cli("artifact", "write", "brainstorm", "--file", file, "--root", root)).out).toMatch(/Wrote .forge\/artifacts\/brainstorm.json/);
    const passed = await cli("complete", "brainstorm", "--root", root);
    expect(passed.code).toBe(0);
    expect(passed.out).toMatch(/PASSED {2}brainstorm/);

    const status = await cli("status", "--root", root);
    expect(status.out).toMatch(/✓ brainstorm/);
    expect(status.out).toMatch(/next: vision {2}\(\/forge vision\)/);

    const json = JSON.parse((await cli("status", "--json", "--root", root)).out);
    expect(json.project).toBe("cli-app");
  });

  it("reports usage errors with exit code 2", async () => {
    const root = tempDir();
    await cli("init", "--root", root);
    const result = await cli("skip", "brainstorm", "--root", root);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/Missing --reason/);
  });

  it("exports JSON Schemas for every artifact", async () => {
    const out = join(tempDir(), "schemas");
    expect((await cli("schemas", "export", "--out", out)).code).toBe(0);
    const files = readdirSync(out);
    expect(files).toContain("validation.schema.json");
    expect(files).toContain("ledger-entry.schema.json");
  });
});

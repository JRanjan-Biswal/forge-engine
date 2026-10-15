import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { run } from "../src/cli.js";
import { githubAnnotations, markdownSummary, runCiCheck } from "../src/ship/checks.js";
import { isolate, prd, tempDir, tmpProject } from "./helpers.js";

isolate();
afterEach(() => {
  delete process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_ACTIONS;
});

function put(root: string, file: string, content: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function cli(...argv: string[]) {
  const out: string[] = [];
  const code = await run(argv, { out: (line) => out.push(line), err: () => undefined });
  return { code, out: out.join("\n") };
}

describe("ci check review", () => {
  it("works on any repo (no forge.config.yaml) and turns findings into PR annotations", () => {
    const root = tempDir();
    put(root, "src/run.ts", "export const run = (req) => eval(req.body.code);\n");
    put(root, "src/util.ts", "export const sum = (a: number, b: number) => a + b;\n");
    const result = runCiCheck(root, "review");
    expect(result.ok).toBe(false);
    expect(result.sections.map((s) => [s.name, s.status])).toEqual([["Security scan", "fail"]]);
    expect(githubAnnotations(result)).toEqual([
      "::error file=src/run.ts,line=1,title=high%3A Dynamic code evaluation (eval) (CWE-95)::js.eval — Remove dynamic evaluation; parse data with JSON.parse or a real parser, dispatch with a lookup table.",
    ]);
  });

  it("adds open review findings and QA coverage when the project has them", () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "reviews", {
      findings: [
        { id: "F-1", severity: "high", category: "correctness", file: "src/store.ts", line: 4, claim: "streak never increments", status: "open" },
        { id: "F-2", severity: "low", category: "style", file: "src/a.ts", claim: "naming", status: "open" },
        { id: "F-3", severity: "critical", category: "security", file: "src/b.ts", claim: "fixed already", status: "fixed" },
      ],
    });
    put(root, "e2e/checkin.spec.ts", 'test("streak grows @S-1/AC1", async () => {});\n');
    const result = runCiCheck(root, "review");
    expect(result.sections.map((s) => [s.name, s.status])).toEqual([
      ["Security scan", "pass"],
      ["Review findings", "fail"],
      ["QA coverage", "fail"],
    ]);
    const annotations = githubAnnotations(result);
    expect(annotations).toContain("::error file=src/store.ts,line=4,title=F-1 high%3A correctness::streak never increments");
    expect(annotations).toContain("::notice file=src/a.ts,title=F-2 low%3A style::naming");
    expect(annotations.some((a) => a.includes("No test for S-2/AC1"))).toBe(true);
    const summary = markdownSummary(result);
    expect(summary).toMatch(/^## forge review — failed/);
    expect(summary).toMatch(/\| ❌ \| Review findings \| 2 open \(1 critical\/high\) of 3 \|/);
  });
});

describe("ci check gap", () => {
  it("reports contract drift and placeholder data, and passes once fixed", () => {
    const root = tmpProject();
    put(root, "package.json", JSON.stringify({ dependencies: { next: "16.0.0" } }));
    put(root, "app/api/habits/route.ts", "export async function GET() {}\nexport async function POST() {}\n");
    put(root, "contracts/openapi.yaml", "openapi: 3.1.0\ninfo: { title: t, version: '1' }\npaths:\n  /api/habits:\n    get: {}\n");
    put(root, "src/seed.ts", "export const users = [{ name: 'lorem ipsum' }];\n");
    const failing = runCiCheck(root, "gap");
    expect(failing.sections.map((s) => [s.name, s.status])).toEqual([
      ["Contract drift", "fail"],
      ["Placeholder data", "fail"],
    ]);
    expect(githubAnnotations(failing)).toEqual(
      expect.arrayContaining(["::error file=app/api/habits/route.ts,title=Endpoint not in the contract::POST /api/habits", expect.stringMatching(/^::error file=src\/seed\.ts,line=1,title=Placeholder/)]),
    );
    put(root, "contracts/openapi.yaml", "openapi: 3.1.0\ninfo: { title: t, version: '1' }\npaths:\n  /api/habits:\n    get: {}\n    post: {}\n");
    put(root, "src/seed.ts", "export const users: string[] = [];\n");
    expect(runCiCheck(root, "gap").ok).toBe(true);
  });

  it("forge ci check writes annotations and the job summary in GitHub Actions, and exits 1 on failure", async () => {
    const root = tempDir();
    put(root, "src/run.ts", "export const run = (cmd: string) => require('child_process').execSync(`sh -c ${cmd}`);\n");
    const summary = join(tempDir(), "summary.md");
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_STEP_SUMMARY = summary;
    const result = await cli("ci", "check", "review", "--root", root);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^::error file=src\/run\.ts,line=1,title=critical%3A Shell command built from a template or concatenation/);
    expect(readFileSync(summary, "utf8")).toMatch(/## forge review — failed[\s\S]*`src\/run\.ts:1` \*\*critical: Shell command/);
    expect((await cli("ci", "check", "nope", "--root", root)).code).toBe(2);
  });
});

describe("composite actions", () => {
  const actionsDir = fileURLToPath(new URL("../actions/", import.meta.url));
  for (const name of ["review", "gap"]) {
    it(`actions/${name}/action.yml is a valid composite action that never interpolates inputs into shell`, () => {
      const action = parse(readFileSync(join(actionsDir, name, "action.yml"), "utf8")) as {
        runs: { using: string; steps: { run?: string }[] };
        inputs: Record<string, unknown>;
      };
      expect(action.runs.using).toBe("composite");
      expect(Object.keys(action.inputs)).toEqual(["working-directory", "forge-version"]);
      for (const step of action.runs.steps) expect(step.run ?? "").not.toMatch(/\$\{\{/);
      expect(action.runs.steps.at(-1)?.run).toBe(`$FORGE_CLI ci check ${name} --format github`);
    });
  }
});

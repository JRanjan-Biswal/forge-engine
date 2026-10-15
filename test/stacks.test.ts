import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  combineCommands,
  detectStacks,
  lensSection,
  listPacks,
  readLens,
  scaffoldPlan,
  scaffoldStack,
  stackCommands,
  useStacks,
} from "../src/build/stacks.js";
import { taskBrief } from "../src/build/tasks.js";
import { writeArtifact } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { readLedger } from "../src/core/ledger.js";
import { run } from "../src/cli.js";
import { isolate, prd, setCommand, tmpProject } from "./helpers.js";

isolate();

function put(root: string, file: string, content: string | object): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

/** A pnpm monorepo: Next.js in web/, FastAPI (uv) in api/, Expo in apps/mobile, Supabase at the root. */
function monorepo(): string {
  const root = tmpProject({ autonomy: "auto" });
  put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put(root, "web/package.json", {
    scripts: { dev: "next dev", build: "next build", lint: "eslint" },
    dependencies: { next: "16.0.0", react: "19.2.0", hono: "4.0.0" },
    devDependencies: { vitest: "3.0.0", typescript: "5.9.0" },
  });
  put(root, "api/pyproject.toml", `[project]\nname = "api"\ndependencies = [\n  "fastapi[standard]>=0.115",\n]\n\n[dependency-groups]\ndev = ["pytest>=8"]\n`);
  put(root, "api/uv.lock", "version = 1\n");
  put(root, "api/app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n");
  put(root, "apps/mobile/package.json", { scripts: { test: "jest --watchAll" }, dependencies: { expo: "54.0.0" }, devDependencies: { jest: "29.0.0" } });
  put(root, "supabase/config.toml", 'project_id = "demo"\n');
  return root;
}

const API_BUILD = 'uv run python -c "import app.main"';

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("stack packs", () => {
  it("ships valid packs, each with conventions and a review lens", () => {
    const packs = listPacks();
    expect(packs.map((p) => p.pack.id)).toEqual(["expo", "fastapi", "nextjs", "node-hono", "supabase"]);
    for (const { pack } of packs) {
      const lens = readLens(pack.id);
      expect(lensSection(lens, "Conventions").length, pack.id).toBeGreaterThan(200);
      expect(lensSection(lens, "Review lens"), pack.id).toMatch(/- \[ \]/);
      expect(pack.scaffold.command, pack.id).toMatch(/\{dir\}/);
    }
  });

  it("detects every stack in a monorepo with its evidence; Hono inside Next.js is not a separate service", () => {
    const found = detectStacks(monorepo());
    expect(found.map((d) => `${d.pack}@${d.dir}`)).toEqual(["supabase@.", "fastapi@api", "nextjs@web", "expo@apps/mobile"]);
    expect(found.find((d) => d.pack === "fastapi")?.evidence).toEqual(["python dependency fastapi"]);
    expect(found.find((d) => d.pack === "supabase")?.evidence).toEqual(["file supabase/config.toml"]);
  });

  it("reads Python dependencies from Poetry tables and requirements files", () => {
    const root = tmpProject();
    put(root, "svc/pyproject.toml", `[tool.poetry]\nname = "svc"\n\n[tool.poetry.dependencies]\npython = "^3.12"\nFastAPI = "^0.115"\n`);
    put(root, "legacy/requirements.txt", "# api\nfastapi==0.110.0\nuvicorn[standard]\n");
    expect(detectStacks(root).map((d) => `${d.pack}@${d.dir}`)).toEqual(["fastapi@legacy", "fastapi@svc"]);
    // No app module and no pytest → nothing runnable, and forge says so instead of guessing.
    const svc = stackCommands(root, "fastapi", "svc");
    expect(svc.commands).toEqual({});
    expect(svc.missing.map((m) => m.key)).toEqual(["build", "test", "lint", "audit"]);
  });

  it("derives only the commands the repo can run, with the right runners, and says how to enable the rest", () => {
    const root = monorepo();
    const web = stackCommands(root, "nextjs", "web");
    expect(web.packageManager).toBe("pnpm");
    expect(web.commands).toEqual({ build: "pnpm build", test: "pnpm exec vitest run", lint: "pnpm lint", audit: "pnpm audit --prod --audit-level high" });
    expect(web.missing).toEqual([
      expect.objectContaining({ key: "e2e", why: "@playwright/test is not a dependency", fix: expect.stringMatching(/^pnpm dlx create-playwright/) }),
    ]);

    const api = stackCommands(root, "fastapi", "api");
    expect(api.commands).toEqual({ build: API_BUILD, test: "uv run python -m pytest -q" });
    expect(api.missing.map((m) => m.key)).toEqual(["lint", "audit"]);

    // The template's `jest --watchAll` script is never chosen: jest runs one-shot.
    expect(stackCommands(root, "expo", "apps/mobile").commands.test).toBe("pnpm exec jest --ci --watchAll=false");

    expect(combineCommands([web, api])).toMatchObject({
      build: `(cd web && pnpm build) && (cd api && ${API_BUILD})`,
      lint: "cd web && pnpm lint",
    });
  });

  it("records stacks in forge.config.yaml, fills empty commands, keeps configured ones and logs the decision", () => {
    const root = monorepo();
    setCommand(root, "test", "make test");
    const result = useStacks(root);
    expect(result.set.build).toBe(
      `(cd api && ${API_BUILD}) && (cd web && pnpm build) && (cd apps/mobile && pnpm exec expo export --platform ios --platform android --output-dir .expo/forge-export)`,
    );
    expect(result.set.e2e).toBeUndefined(); // no Playwright, no Maestro → stays unconfigured
    expect(result.kept.test).toEqual({ current: "make test", suggested: expect.stringContaining("(cd web && pnpm exec vitest run)") });

    const config = loadConfig(root);
    expect(config.stacks).toEqual([
      { pack: "supabase", dir: "." },
      { pack: "fastapi", dir: "api" },
      { pack: "nextjs", dir: "web" },
      { pack: "expo", dir: "apps/mobile" },
    ]);
    expect(config.commands.test).toBe("make test");
    expect(config.commands.lint).toContain("cd web && pnpm lint");
    expect(readFileSync(join(root, "forge.config.yaml"), "utf8")).toMatch(/# forge project configuration/);
    expect(readLedger(root).at(-1)).toMatchObject({ kind: "decision", stage: "architect", summary: expect.stringMatching(/^Stacks: supabase \(\.\), fastapi \(api\)/) });

    expect(useStacks(root, { force: true }).set.test).toContain("pnpm exec vitest run");
    expect(loadConfig(root).commands.test).toContain("pnpm exec vitest run");
  });

  it("adds a named pack in a directory, and refuses unknown packs, outside directories and an empty repo", () => {
    const root = tmpProject();
    expect(() => useStacks(root)).toThrow(/No known stack found .*forge stack scaffold/);
    put(root, "server/package.json", { scripts: { build: "tsc" }, dependencies: { hono: "4.0.0" } });
    put(root, "server/package-lock.json", "{}");
    useStacks(root, { pack: "node-hono", dir: "server" });
    expect(loadConfig(root).stacks).toEqual([{ pack: "node-hono", dir: "server" }]);
    expect(loadConfig(root).commands.build).toBe("cd server && npm run build");
    expect(() => useStacks(root, { pack: "node-hono", dir: "../elsewhere" })).toThrow(/inside the project/);
    expect(() => useStacks(root, { pack: "rails" })).toThrow(/Unknown stack pack "rails"/);
  });

  it("puts the matching stack's layout, commands and conventions into task briefs", () => {
    const root = monorepo();
    useStacks(root);
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "tasks", {
      tasks: [
        { id: "T-1", title: "Check-in endpoint", dept: "backend", storyIds: ["S-1"], files: ["api/app/routers/checkins.py"] },
        { id: "T-2", title: "Check-in screen", dept: "frontend", storyIds: ["S-1"], files: ["web/src/app/checkin/page.tsx"] },
        { id: "T-3", title: "Streak policies", dept: "data", storyIds: ["S-1"], files: ["supabase/migrations/0001_streaks.sql"] },
      ],
    });
    const api = taskBrief(root, "T-1");
    expect(api).toMatch(/## Stack: FastAPI \(Python\) in api\//);
    expect(api).toMatch(/routers → api\/app\/routers/);
    expect(api).toMatch(/test `uv run python -m pytest -q`/);
    expect(api).toMatch(/No lint command yet \(ruff is not a dependency; mypy is not a dependency\) — uv add --dev ruff/);
    expect(api).not.toMatch(/Next\.js/);

    const web = taskBrief(root, "T-2");
    expect(web).toMatch(/## Stack: Next\.js \(App Router\) in web\//);
    expect(web).toMatch(/Server first/);
    expect(web).toMatch(/design\/dist\/tailwind\.css/);
    expect(web.indexOf("## Stack")).toBeLessThan(web.indexOf("## Rules"));

    // A root-level stack (supabase in ".") is matched by department.
    expect(taskBrief(root, "T-3")).toMatch(/## Stack: Supabase/);
  });

  it("plans the official generator with the project's package manager", () => {
    const root = monorepo();
    expect(scaffoldPlan(root, "nextjs", { dir: "site" }).command).toBe(
      "pnpm dlx create-next-app@latest site --ts --app --eslint --tailwind --src-dir --import-alias '@/*' --use-pnpm --yes --disable-git",
    );
    expect(scaffoldPlan(root, "node-hono", { pm: "npm" })).toMatchObject({
      dir: "api",
      command: expect.stringMatching(/^npx create-hono@latest api .*--pm npm/),
      then: ["npm add zod @hono/zod-validator", "npm add -D vitest"],
    });
    expect(scaffoldPlan(root, "expo").dir).toBe("mobile");
    expect(() => scaffoldPlan(root, "nextjs", { pm: "pip" })).toThrow(/--pm must be one of/);
  });

  it("runs a scaffold, refuses a non-empty target and honours project packs", async () => {
    const root = tmpProject();
    put(
      root,
      ".forge/stack-packs/tiny/pack.yaml",
      [
        "id: tiny",
        "name: Tiny",
        "summary: test pack",
        "kind: service",
        "platforms: [api]",
        "depts: [backend]",
        "language: typescript",
        "detect: { packageDeps: [tiny-framework] }",
        "commands:",
        "  build:",
        '    - run: "{run} build"',
        "      requires: { script: build }",
        "scaffold:",
        `  command: "mkdir -p {dir} && echo '{\\"scripts\\":{\\"build\\":\\"true\\"},\\"dependencies\\":{\\"tiny-framework\\":\\"1\\"}}' > {dir}/package.json && echo '{}' > {dir}/package-lock.json"`,
        "  docs: https://example.com/tiny",
        '  then: ["touch made-by-then"]',
        "qa: none",
      ].join("\n"),
    );
    expect(listPacks(root).find((p) => p.pack.id === "tiny")?.source).toBe("project");

    const result = await scaffoldStack(root, "tiny", { dir: "svc", pm: "npm" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "svc", "made-by-then"), "utf8")).toBe("");
    expect(loadConfig(root).stacks).toEqual([{ pack: "tiny", dir: "svc" }]);
    expect(loadConfig(root).commands.build).toBe("cd svc && npm run build");
    await expect(scaffoldStack(root, "tiny", { dir: "svc" })).rejects.toThrow(/not empty/);
  });

  it("is available from the CLI", async () => {
    const root = monorepo();
    const detect = JSON.parse((await cli("stack", "detect", "--json", "--root", root)).out) as { pack: string; commands: object }[];
    expect(detect.find((d) => d.pack === "nextjs")?.commands).toMatchObject({ build: "pnpm build" });
    expect((await cli("stack", "use", "--root", root)).out).toMatch(/✓ commands\.build/);
    expect((await cli("stack", "--root", root)).out).toMatch(/configured: .*nextjs \(web\)/);
    expect((await cli("stack", "show", "fastapi", "--root", root)).out).toMatch(/## Review lens/);
    expect((await cli("stack", "scaffold", "fastapi", "--root", root)).out).toMatch(/uv init --app --no-workspace --vcs none api[\s\S]*Re-run with --run/);
    expect((await cli("stack", "nope", "--root", root)).code).toBe(2);
  });
});

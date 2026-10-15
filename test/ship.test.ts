import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { useStacks } from "../src/build/stacks.js";
import { loadArtifact, writeArtifact } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { Forge } from "../src/core/engine.js";
import { BUILTINS } from "../src/core/gates.js";
import { readLedger } from "../src/core/ledger.js";
import { findStage } from "../src/core/stages.js";
import { qaCoverage, qaPlan } from "../src/qa/coverage.js";
import type { Release, Trace } from "../src/schemas/artifacts.js";
import { generateWorkflow, writeWorkflow } from "../src/ship/ci.js";
import { deploy, deployPlan } from "../src/ship/deploy.js";
import { editConfig, isolate, prd, screens, setCommand, tmpProject } from "./helpers.js";

isolate();

const servers: Server[] = [];
afterEach(async () => {
  delete process.env.FORGE_TEST_BYPASS;
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

function put(root: string, file: string, content: string | object): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

/** A real local HTTP server standing in for a deployed app. */
async function liveServer(handler: (req: { url?: string; headers: Record<string, string | string[] | undefined> }) => { status: number; location?: string }): Promise<string> {
  const server = createServer((req, res) => {
    const { status, location } = handler(req);
    res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff", ...(location ? { location } : {}) });
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** A project pack whose "deploy" prints the URL of a live server — the CLI contract without a cloud. */
function projectWithTarget(root: string, target: { auth?: string; bin?: string; url: string; requires?: string; preview?: boolean }) {
  put(
    root,
    ".forge/stack-packs/tiny/pack.yaml",
    [
      "id: tiny",
      "name: Tiny",
      "summary: test pack",
      "kind: app",
      "platforms: [web]",
      "depts: [frontend]",
      "language: typescript",
      "detect: { packageDeps: [tiny-framework] }",
      "scaffold: { command: 'true {dir}', docs: 'https://example.com/tiny' }",
      "qa: none",
      "deploy:",
      "  - id: tinyhost",
      "    name: Tiny Host",
      `    bin: ${target.bin ?? "node"}`,
      `    auth: "${target.auth ?? "true"}"`,
      "    login: tinyhost login",
      ...(target.requires ? ["    requires:", `      - { file: ${target.requires}, create: "tinyhost link" }`] : []),
      ...(target.preview === false ? [] : [`    preview: "echo Preview ready at ${target.url}"`]),
      `    production: "echo Production ready at ${target.url}"`,
      "    url: 'http://127\\.0\\.0\\.1:\\d+'",
      "    bypass: { header: x-test-bypass, env: FORGE_TEST_BYPASS }",
      "    rollback: tinyhost rollback",
      "    docs: https://example.com/tiny/deploy",
    ].join("\n"),
  );
  put(root, "web/package.json", { dependencies: { "tiny-framework": "1.0.0" } });
  useStacks(root, { pack: "tiny", dir: "web" });
}

describe("QA plan and coverage", () => {
  it("turns every MVP acceptance criterion into a case with a tool and file", () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "screens", screens());
    expect(qaPlan(root)).toEqual([
      expect.objectContaining({ id: "S-1/AC1", story: "S-1", tool: "playwright", suggestedFile: "e2e/s-1.spec.ts", text: "Given a habit, when I tap check in, then the streak increments" }),
      expect.objectContaining({ id: "S-2/AC1", tool: "playwright" }),
    ]);
  });

  it("finds tags in test files, flags unknown tags, links the trace and gates verify", async () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    put(root, "e2e/checkin.spec.ts", 'test("streak grows @S-1/AC1", async () => {});\ntest("typo @S-9/AC1", async () => {});\n');
    put(root, "src/checkin.ts", "// @S-2/AC1 mentioned in product code does not count\n");
    const stage = findStage("verify")!;
    const ctx = () => ({ root, config: loadConfig(root), stage, state: new Forge(root).readState() });

    let report = qaCoverage(root);
    expect(report).toMatchObject({ required: 2, ratio: 0.5, covered: [{ id: "S-1/AC1", files: ["e2e/checkin.spec.ts"] }], unknownTags: [{ tag: "S-9/AC1", file: "e2e/checkin.spec.ts" }] });
    expect(report.missing.map((m) => m.id)).toEqual(["S-2/AC1"]);
    expect(await BUILTINS["qa.coverage"]!(ctx())).toMatchObject({ status: "fail", message: expect.stringMatching(/50%.*missing: S-2\/AC1/) });

    put(root, ".maestro/reminders.yaml", "appId: com.example\ntags:\n  - S-2/AC1\n---\n- launchApp\n");
    report = qaCoverage(root, { link: true });
    expect(report.ratio).toBe(1);
    expect(loadArtifact<Trace>(root, "trace")?.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: "story:S-1", to: "test:e2e/checkin.spec.ts", type: "verifiedBy" })]));
    expect(await BUILTINS["qa.coverage"]!(ctx())).toMatchObject({ status: "pass" });
  });
});

describe("CI workflow", () => {
  it("generates one job per stack with the gate commands, plus the security scan", () => {
    const root = tmpProject();
    put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    put(root, "web/package.json", { scripts: { build: "next build", lint: "eslint" }, dependencies: { next: "16.0.0" }, devDependencies: { vitest: "3.0.0", "@playwright/test": "1.50.0" } });
    put(root, "api/pyproject.toml", '[project]\nname = "api"\ndependencies = ["fastapi"]\n[dependency-groups]\ndev = ["pytest"]\n');
    put(root, "api/uv.lock", "version = 1\n");
    put(root, "api/app/main.py", "app = None\n");
    put(root, "supabase/config.toml", "");
    useStacks(root);

    const { yaml, jobs, notes } = generateWorkflow(root);
    expect(jobs).toEqual(["fastapi-api", "nextjs-web", "security"]);
    const wf = parse(yaml) as { jobs: Record<string, { defaults?: { run: { "working-directory": string } }; steps: { run?: string; uses?: string }[] }> };
    const web = wf.jobs["nextjs-web"]!;
    expect(web.defaults?.run["working-directory"]).toBe("web");
    expect(web.steps.map((s) => s.run ?? s.uses)).toEqual([
      "actions/checkout@v4",
      "pnpm/action-setup@v4",
      "actions/setup-node@v4",
      "pnpm install --frozen-lockfile",
      "pnpm build",
      "pnpm lint",
      "pnpm exec vitest run",
      "pnpm audit --prod --audit-level high",
      "pnpm exec playwright install --with-deps chromium",
      "pnpm exec playwright test",
    ]);
    expect(wf.jobs["fastapi-api"]!.steps.map((s) => s.run ?? s.uses)).toEqual(expect.arrayContaining(["astral-sh/setup-uv@v6", "uv sync --frozen", 'uv run python -c "import app.main"', "uv run python -m pytest -q"]));
    expect(wf.jobs.security!.steps.at(-1)?.run).toBe("npx --yes forge-engine security scan");
    expect(notes.join("\n")).toMatch(/supabase: database tests need the local Supabase stack/);

    expect(writeWorkflow(root)).toMatchObject({ written: true, path: ".github/workflows/forge.yml" });
    writeFileSync(join(root, ".github/workflows/forge.yml"), "name: mine\n");
    expect(writeWorkflow(root)).toMatchObject({ written: false, notes: expect.arrayContaining([expect.stringMatching(/exists and differs/)]) });
    expect(writeWorkflow(root, { force: true }).written).toBe(true);
  });
});

describe("deploy", () => {
  it("plans targets and reports what is missing with the fix", async () => {
    const root = tmpProject();
    projectWithTarget(root, { bin: "tinyhost-cli-not-installed", url: "http://127.0.0.1:1", requires: "tiny.toml" });
    const [item] = deployPlan(root, "preview");
    expect(item).toMatchObject({ pack: "tiny", dir: "web", command: "echo Preview ready at http://127.0.0.1:1" });
    expect(item?.problems).toEqual(["tinyhost-cli-not-installed is not installed — tinyhost login", "web/tiny.toml is missing — tinyhost link"]);
    const result = await deploy(root);
    expect(result).toMatchObject({ ok: false, steps: [{ status: "blocked" }] });
    expect(loadArtifact(root, "release")).toBeUndefined();
  });

  it("stops at the login check instead of deploying", async () => {
    const root = tmpProject();
    projectWithTarget(root, { auth: "false", url: "http://127.0.0.1:1" });
    const result = await deploy(root);
    expect(result.steps[0]).toMatchObject({ status: "blocked", detail: expect.stringMatching(/not logged in to Tiny Host .*tinyhost login/) });
    expect(result.release).toBeUndefined();
  });

  it("deploys, smoke-tests, probes headers, runs e2e against the URL, and records the release", async () => {
    const url = await liveServer(() => ({ status: 200 }));
    const root = tmpProject({ autonomy: "checkpoint" });
    projectWithTarget(root, { url });
    setCommand(root, "e2e", `node -e "process.exit(process.env.PLAYWRIGHT_BASE_URL === '${url}' && process.env.BASE_URL === '${url}' ? 0 : 1)"`);
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "tasks", { tasks: [{ id: "T-1", title: "Check-in", dept: "frontend", storyIds: ["S-1"], files: ["web/a.ts"], status: "done" }] });

    const result = await deploy(root);
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([expect.objectContaining({ pack: "tiny", status: "deployed", url })]);
    expect(result.checks.map((c) => [c.name, c.pass])).toEqual([
      ["deploy tiny (Tiny Host, preview)", true],
      [`smoke GET ${url}/`, true],
      ["security headers", true],
      [`e2e against ${url}`, true],
    ]);
    const release = loadArtifact<Release>(root, "release");
    expect(release).toMatchObject({ env: "preview", url, source: "forge-deploy", target: "tinyhost", rollback: "tiny: tinyhost rollback" });
    const notes = readFileSync(join(root, release?.notes ?? "missing"), "utf8");
    expect(notes).toMatch(/# Release 0\.0\.0 — preview/);
    expect(notes).toMatch(/S-1: as a user, to check in daily/);
    expect(readLedger(root).at(-1)?.summary).toBe(`Deployed 0.0.0 to preview at ${url} — all checks passed`);

    const ship = findStage("ship")!;
    const ctx = { root, config: loadConfig(root), stage: ship, state: new Forge(root).readState() };
    expect(await BUILTINS["release.checksPass"]!(ctx)).toMatchObject({ status: "pass" });
    expect(await BUILTINS["release.live"]!(ctx)).toMatchObject({ status: "pass", message: expect.stringMatching(/HTTP 200/) });

    await expect(deploy(root, { env: "production" })).rejects.toThrow(/forge approve ship/);
    new Forge(root).approve("ship", "test-user");
    expect((await deploy(root, { env: "production" })).release?.env).toBe("production");

    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
    expect(await BUILTINS["release.live"]!(ctx)).toMatchObject({ status: "fail", message: expect.stringMatching(/unreachable/) });
  });

  it("fails the release when the deployed app is broken or protected, and gets through protection with the bypass header", async () => {
    const broken = await liveServer(() => ({ status: 500 }));
    const root = tmpProject();
    projectWithTarget(root, { url: broken });
    const result = await deploy(root);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name.startsWith("smoke"))).toMatchObject({ pass: false, detail: expect.stringMatching(/^HTTP 500/) });
    const ship = findStage("ship")!;
    expect(await BUILTINS["release.checksPass"]!({ root, config: loadConfig(root), stage: ship, state: new Forge(root).readState() })).toMatchObject({ status: "fail" });

    const protectedUrl = await liveServer((req) => ({ status: req.headers["x-test-bypass"] === "let-me-in" ? 200 : 401 }));
    const root2 = tmpProject();
    projectWithTarget(root2, { url: protectedUrl });
    const denied = await deploy(root2);
    expect(denied.checks.find((c) => c.name.startsWith("smoke"))?.detail).toMatch(/HTTP 401 — the deployment is protected; set FORGE_TEST_BYPASS/);
    process.env.FORGE_TEST_BYPASS = "let-me-in";
    expect((await deploy(root2)).ok).toBe(true);
  });

  it("does not mistake a protected deployment's login redirect for the app (regression: Vercel SSO)", async () => {
    const login = await liveServer(() => ({ status: 200 })); // a login page on another origin that answers 200
    const app = await liveServer((req) =>
      req.headers["x-test-bypass"] === "let-me-in"
        ? req.url === "/"
          ? { status: 307, location: "/home" } // same-origin redirects are followed
          : { status: 200 }
        : { status: 302, location: `${login}/sso-api?url=x&nonce=secret` },
    );
    const root = tmpProject();
    projectWithTarget(root, { url: app });
    const blocked = await deploy(root);
    expect(blocked.ok).toBe(false);
    const smoke = blocked.checks.find((c) => c.name.startsWith("smoke"));
    expect(smoke?.detail).toMatch(new RegExp(`HTTP 302 redirect to ${login.replace(/\./g, "\\.")}/sso-api \\(login wall or deployment protection, not the app\\) — the deployment is protected; set FORGE_TEST_BYPASS`));
    expect(smoke?.detail).not.toMatch(/nonce/);
    const ctx = { root, config: loadConfig(root), stage: findStage("ship")!, state: new Forge(root).readState() };
    expect(await BUILTINS["release.live"]!(ctx)).toMatchObject({ status: "fail", message: expect.stringMatching(/not the app/) });

    process.env.FORGE_TEST_BYPASS = "let-me-in";
    const passed = await deploy(root);
    expect(passed.ok).toBe(true);
    expect(passed.checks.find((c) => c.name.startsWith("smoke"))?.detail).toBe(`HTTP 200 (${app}/home)`);
    expect(await BUILTINS["release.live"]!({ ...ctx, state: new Forge(root).readState() })).toMatchObject({ status: "pass" });
  });

  it("skips targets that only deploy to production when deploying a preview", async () => {
    const root = tmpProject();
    projectWithTarget(root, { url: "http://127.0.0.1:1", preview: false });
    const result = await deploy(root);
    expect(result.steps).toEqual([expect.objectContaining({ status: "skipped", detail: "Tiny Host has no preview deploy (production only)" })]);
    expect(existsSync(join(root, ".forge/releases/latest.json"))).toBe(false);
  });

  it("an unknown configured deploy target is a problem, not a guess", () => {
    const root = tmpProject();
    projectWithTarget(root, { url: "http://127.0.0.1:1" });
    editConfig(root, (text) => text.replace("targets: {}", "targets: { tiny: vercel }"));
    expect(deployPlan(root, "preview")[0]?.problems).toEqual(["deploy.targets.tiny = vercel, but tiny knows: tinyhost"]);
  });
});

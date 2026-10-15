#!/usr/bin/env node
// Stack packs against the real official generators: scaffold → detect → record gate
// commands → run every command forge configured. Needs the network and installs
// dependencies, so it is opt-in and runs ONE stack at a time (RAM protection).
// Usage (from the forge repo, after pnpm build):
//   node e2e/stacks.mjs [fastapi] [node-hono] [nextjs] [expo] [supabase] [--with-docker]
// Writes e2e/runs/<timestamp>-stacks/REPORT.md and e2e/LATEST-stacks.md. Dependencies
// (node_modules, .venv, build caches) are deleted after each stack; sources stay for inspection.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { CLI, E2E, FORGE, Suite, forgeCli, makeRunDir, pidAlive, pruneRuns, readJson, sh, shAsync, tail, writeText } from "./lib.mjs";

const ALL = ["fastapi", "node-hono", "nextjs", "expo", "supabase"];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const packs = wanted.length ? wanted : ALL;
const withDocker = process.argv.includes("--with-docker");
const suite = new Suite(`stack packs on real generators — ${packs.join(" · ")}`);
const RUN = makeRunDir("stacks");
const ENV = { FORGE_HOME: join(RUN, "forge-home"), CI: "1" };
const forge = forgeCli(ENV);
const LONG = 1_200_000;

/**
 * What a builder's first task would add so the test command has something to run.
 * Test fixtures written by the harness, not product code.
 */
const PREPARE = {
  fastapi: [
    ["app/__init__.py", ""],
    ["app/main.py", 'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/health")\ndef health() -> dict[str, str]:\n    return {"status": "ok"}\n'],
    ["tests/__init__.py", ""],
    [
      "tests/test_health.py",
      'from fastapi.testclient import TestClient\n\nfrom app.main import app\n\n\ndef test_health() -> None:\n    response = TestClient(app).get("/health")\n    assert response.status_code == 200\n    assert response.json() == {"status": "ok"}\n',
    ],
  ],
  "node-hono": [
    [
      "src/app.test.ts",
      'import { Hono } from "hono";\nimport { expect, test } from "vitest";\n\ntest("routes answer through app.request()", async () => {\n  const app = new Hono().get("/health", (c) => c.json({ status: "ok" }));\n  const res = await app.request("/health");\n  expect(res.status).toBe(200);\n  expect(await res.json()).toEqual({ status: "ok" });\n});\n',
    ],
  ],
  nextjs: [["src/lib/slug.test.ts", 'import { expect, test } from "vitest";\n\ntest("vitest runs in the Next.js app", () => {\n  expect("Check In".toLowerCase().replace(/\\s+/g, "-")).toBe("check-in");\n});\n']],
};

/** Follow the pack's own fix hint for a missing test runner, as a task brief tells a builder to. */
const ENABLE_TESTS = { nextjs: "pnpm add -D vitest" };

/** Production server per stack, for the live security-header probe (started after the build, stopped right after). */
const SERVE = {
  nextjs: (port) => ["pnpm", ["exec", "next", "start", "-p", String(port), "-H", "127.0.0.1"], "/"],
  fastapi: (port) => ["uv", ["run", "fastapi", "run", "app/main.py", "--host", "127.0.0.1", "--port", String(port)], "/health"],
};

async function probeHeaders(pack, dir) {
  const port = 45000 + Math.floor(Math.random() * 2000);
  const [cmd, args, path] = SERVE[pack](port);
  const child = spawn(cmd, args, { cwd: dir, detached: true, stdio: "ignore", env: { ...process.env, NODE_ENV: "production" } });
  const url = `http://127.0.0.1:${port}${path}`;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(url).then(() => true, () => false);
    }
    suite.check(`${pack} production server answered on ${url}`, up);
    if (!up) return;
    const r = await shAsync(process.execPath, [CLI, "security", "headers", url, "--json"], { cwd: dir, env: { ...process.env, ...ENV } });
    const report = JSON.parse(r.out || "{}");
    suite.check("live header probe ran against the real framework defaults", Array.isArray(report.checks), r.all.slice(0, 300));
    const notable = (report.checks ?? []).filter((c) => c.status === "fail" || c.status === "warn").map((c) => `${c.id} (${c.severity}${c.status === "warn" ? ", warn" : ""})`);
    suite.note(`${pack} defaults — ${report.kind}, ${report.blocking} blocking at high`, notable.join(", ") || "all checks pass");
  } finally {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    for (let i = 0; i < 20 && pidAlive(child.pid); i++) await new Promise((r) => setTimeout(r, 250));
    if (pidAlive(child.pid)) process.kill(-child.pid, "SIGKILL");
    suite.check(`${pack} server process group stopped`, !pidAlive(child.pid), `pid ${child.pid}`);
  }
}

const config = (root) => parse(readFileSync(join(root, "forge.config.yaml"), "utf8"));

function dropDependencies(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (["node_modules", ".venv", ".next", ".expo"].includes(entry.name)) rmSync(path, { recursive: true, force: true });
    else if (!entry.name.startsWith(".")) dropDependencies(path);
  }
}

for (const pack of packs) {
  suite.begin(pack);
  const P = join(RUN, pack);
  mkdirSync(P, { recursive: true });
  await suite.guard(pack, async () => {
    forge(P, "init", "--name", `${pack}-app`);
    const started = Date.now();
    const scaffold = sh(process.execPath, [CLI, "stack", "scaffold", pack, "--run", "--pm", "pnpm", "--json"], {
      cwd: P,
      env: { ...process.env, ...ENV },
      timeout: LONG,
      maxBuffer: 64 * 1024 * 1024,
    });
    let result;
    try {
      result = JSON.parse(scaffold.out);
    } catch {
      result = undefined;
    }
    suite.check(`scaffold with the official generator: \`${result?.command ?? "?"}\``, scaffold.code === 0 && result?.ok === true, tail(result?.output ?? scaffold.all, 25));
    suite.note("scaffold time", `${Math.round((Date.now() - started) / 1000)} s`);
    if (!result?.ok) return;

    const dir = join(P, result.dir);
    const detected = JSON.parse(forge(P, "stack", "detect", "--json").out || "[]");
    const mine = detected.find((d) => d.pack === pack && d.dir === result.dir);
    suite.check(`detects ${pack} in ${result.dir}`, Boolean(mine), JSON.stringify(detected.map((d) => `${d.pack}@${d.dir}`)));
    suite.note("runnable right after scaffolding", JSON.stringify(mine?.commands ?? {}));
    if (mine?.missing?.length) suite.note("missing, with the pack's fix", mine.missing.map((m) => `${m.key}: ${m.why}${m.fix ? ` → ${m.fix}` : ""}`).join(" | "));

    if (ENABLE_TESTS[pack]) {
      const enable = sh("sh", ["-c", ENABLE_TESTS[pack]], { cwd: dir, timeout: LONG });
      suite.check(`following the pack's fix enables tests: \`${ENABLE_TESTS[pack]}\``, enable.code === 0, tail(enable.all));
    }
    for (const [file, text] of PREPARE[pack] ?? []) writeText(join(dir, file), text);
    const used = JSON.parse(forge(P, "stack", "use", "--force", "--json").out || "{}");
    const commands = Object.fromEntries(Object.entries(config(P).commands ?? {}).filter(([, value]) => value));
    suite.check(
      "stack use records the stack and its gate commands in forge.config.yaml",
      config(P).stacks?.some((s) => s.pack === pack) && Object.keys(commands).length > 0,
      JSON.stringify(used?.stacks?.map((s) => s.commands)),
    );

    for (const [key, command] of Object.entries(commands)) {
      if (pack === "supabase" && !withDocker) {
        suite.note(`${key}: \`${command}\``, "not run — needs the local Supabase stack (Docker); pass --with-docker");
        continue;
      }
      const t0 = Date.now();
      const r = sh("sh", ["-c", command], { cwd: P, env: { ...process.env, CI: "1" }, timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
      suite.check(`commands.${key} passes: \`${command}\` (${Math.round((Date.now() - t0) / 1000)} s)`, r.code === 0, tail(r.all, 20));
    }
    const scan = JSON.parse(forge(P, "security", "scan", "--json").out || "{}");
    suite.check("security scan of the generated app: nothing at high or above (no false positives)", scan.blocking === 0, JSON.stringify(scan.findings?.slice(0, 5)));
    if (SERVE[pack]) await probeHeaders(pack, dir);
  });
  dropDependencies(P);
  suite.note("cleanup", "node_modules, .venv and build caches removed");
}

const leftovers = sh("pgrep", ["-fl", RUN]).out.trim();
suite.check("no process from this run is still alive", !leftovers, leftovers);

const report = suite.report({ forge: readJson(join(FORGE, "package.json")).version, "Run directory": RUN.replace(`${E2E}/`, "e2e/") });
writeText(join(RUN, "REPORT.md"), report);
writeText(join(E2E, "LATEST-stacks.md"), report);
pruneRuns(6);
console.log(`\n${suite.failed.length ? `FAILED (${suite.failed.length})` : "PASSED"} — ${join(RUN, "REPORT.md")}`);
process.exitCode = suite.failed.length ? 1 : 0;

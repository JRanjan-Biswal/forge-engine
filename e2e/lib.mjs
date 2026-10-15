// Shared helpers for the forge end-to-end harnesses (run.mjs, hosts.mjs).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E = dirname(fileURLToPath(import.meta.url));
export const FORGE = resolve(process.env.FORGE_REPO ?? join(E2E, ".."));
export const CLI = join(FORGE, "dist", "cli.js");
export const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Keep only the newest `keep` timestamped run directories (test outputs, gitignored). */
export function pruneRuns(keep) {
  const dir = join(E2E, "runs");
  if (!existsSync(dir)) return;
  const runs = readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .sort();
  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) rmSync(join(dir, name), { recursive: true, force: true });
}

export function makeRunDir(kind) {
  const dir = join(E2E, "runs", `${STAMP}-${kind}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function tail(text, lines = 12) {
  return String(text ?? "").trim().split("\n").slice(-lines).join("\n");
}

/** Run a command synchronously and capture everything. */
export function sh(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 600_000, ...options });
  const out = r.stdout ?? "";
  const err = (r.stderr ?? "") + (r.error ? String(r.error) : "");
  return { code: r.status, out, err, all: `${out}${err}` };
}

/** Run a command asynchronously (used for parallel / long-running processes). */
export function shAsync(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { ...options });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (err += chunk));
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, out, err, all: `${out}${err}` });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

/** Start the fixture evidence server as a separate, tracked process. Always call stop(). */
export async function startEvidenceServer() {
  const child = spawn(process.execPath, [join(E2E, "fixtures", "evidence-server.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("evidence server did not start")), 10_000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolvePort(JSON.parse(String(chunk)).port);
    });
  });
  const stop = () =>
    new Promise((resolveStop) => {
      if (child.exitCode !== null) return resolveStop(child.exitCode);
      child.once("exit", resolveStop);
      child.stdin.end();
      setTimeout(() => child.kill("SIGTERM"), 2_000).unref();
    });
  return { base: `http://127.0.0.1:${port}`, pid: child.pid, stop };
}

export function forgeCli(env) {
  return (cwd, ...args) => sh(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
}

const escapeCell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");

export class Suite {
  constructor(title) {
    this.title = title;
    this.results = [];
    this.section = "general";
    this.started = Date.now();
  }

  begin(section) {
    this.section = section;
    console.log(`\n## ${section}`);
  }

  check(name, ok, detail = "") {
    const result = { section: this.section, name, pass: Boolean(ok), detail: String(detail ?? "").trim().slice(0, 1200) };
    this.results.push(result);
    const shown = !result.pass && result.detail ? `\n      ${result.detail.split("\n").slice(0, 8).join("\n      ")}` : "";
    console.log(`${result.pass ? "  ✓" : "  ✗"} ${name}${shown}`);
    return result.pass;
  }

  note(name, detail) {
    this.results.push({ section: this.section, name, pass: null, detail: String(detail) });
    console.log(`  – ${name}: ${detail}`);
  }

  async guard(name, fn) {
    try {
      return await fn();
    } catch (error) {
      this.check(name, false, error?.stack ?? String(error));
      return undefined;
    }
  }

  get failed() {
    return this.results.filter((r) => r.pass === false);
  }

  report(meta = {}) {
    const passed = this.results.filter((r) => r.pass === true).length;
    const total = this.results.filter((r) => r.pass !== null).length;
    const lines = [
      `# forge e2e report — ${this.title}`,
      "",
      `- Run: \`${STAMP}\``,
      ...Object.entries(meta).map(([key, value]) => `- ${key}: ${value}`),
      `- Duration: ${Math.round((Date.now() - this.started) / 1000)}s`,
      "",
      `**Result: ${passed}/${total} checks passed${this.failed.length ? ` — ${this.failed.length} FAILED` : ""}**`,
    ];
    const sections = [...new Set(this.results.map((r) => r.section))];
    for (const section of sections) {
      lines.push("", `## ${section}`, "", "| | Check | Detail |", "|---|---|---|");
      for (const r of this.results.filter((x) => x.section === section)) {
        const mark = r.pass === null ? "–" : r.pass ? "✅" : "❌";
        lines.push(`| ${mark} | ${escapeCell(r.name)} | ${escapeCell(r.detail.slice(0, 300))} |`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

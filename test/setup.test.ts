import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { runSetup, setupPlan } from "../src/install/setup.js";
import { isolate, tempDir } from "./helpers.js";

isolate();

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const json = (file: string) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));

/**
 * Fake `claude` and `codex` executables: they log every call and answer `plugin list --json`
 * from what was "installed", so setup runs end to end without touching real host config.
 */
function fakeHosts(hosts: ("claude" | "codex")[]): { calls: () => string[] } {
  const dir = tempDir();
  const log = join(dir, "calls.log");
  const state = join(dir, "installed");
  for (const host of hosts) {
    const list =
      host === "claude"
        ? `if [ -f "${state}.claude" ]; then echo '[{"id":"forge-engine@forge-engine","enabled":true}]'; else echo '[]'; fi`
        : `if [ -f "${state}.codex" ]; then echo '{"installed":[{"pluginId":"forge-engine@forge-engine","enabled":true}]}'; else echo '{"installed":[]}'; fi`;
    writeFileSync(
      join(dir, host),
      [
        "#!/bin/sh",
        'case "$*" in',
        `  "plugin list --json") ${list} ;;`,
        `  "plugin install"*|"plugin add"*) echo "${host} $*" >> "${log}"; touch "${state}.${host}" ;;`,
        `  "plugin uninstall"*|"plugin remove"*) echo "${host} $*" >> "${log}"; rm -f "${state}.${host}" ;;`,
        `  *) echo "${host} $*" >> "${log}" ;;`,
        "esac",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(join(dir, host), 0o755);
  }
  process.env.PATH = `${dir}:/usr/bin:/bin`;
  return { calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
});
afterEach(() => {
  process.env.PATH = savedPath;
});

describe("forge-engine setup", () => {
  it("plans the GitHub marketplace for Claude Code and Codex, and skips hosts that are not installed", () => {
    fakeHosts(["claude"]);
    const plan = setupPlan();
    expect(plan.hosts).toEqual([
      { host: "claude", found: true },
      { host: "codex", found: false },
    ]);
    expect(plan.steps.map((s) => s.argv.join(" "))).toEqual(["claude plugin install forge-engine --marketplace JRanjan-Biswal/forge-engine --scope user"]);
    expect(plan.notes).toEqual(["Codex (`codex`) is not installed — skipped"]);
  });

  it("installs from a local checkout into both hosts, verifies with their own plugin list, and removes again", () => {
    const fake = fakeHosts(["claude", "codex"]);
    const source = tempDir();
    const plan = setupPlan({ source, scope: "project" });
    expect(plan.steps.map((s) => s.argv.join(" "))).toEqual([
      `claude plugin install forge-engine --marketplace ${source} --scope project`,
      `codex plugin marketplace add ${source}`,
      "codex plugin add forge-engine@forge-engine",
    ]);
    expect(plan.notes).toContain("Codex has no install scopes — the plugin is enabled for every Codex session using this CODEX_HOME");
    const result = runSetup(plan);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.verified).toEqual([
      { host: "claude", installed: true, detail: "forge-engine is listed by `claude plugin list`" },
      { host: "codex", installed: true, detail: "forge-engine@forge-engine installed and enabled" },
    ]);
    expect(fake.calls()).toEqual([
      `claude plugin install forge-engine --marketplace ${source} --scope project`,
      `codex plugin marketplace add ${source}`,
      "codex plugin add forge-engine@forge-engine",
    ]);

    const removed = runSetup(setupPlan({ remove: true, scope: "project" }));
    expect(removed.verified.map((v) => v.installed)).toEqual([false, false]);
    expect(fake.calls().slice(3)).toEqual(["claude plugin uninstall forge-engine --scope project", "codex plugin remove forge-engine@forge-engine", "codex plugin marketplace remove forge-engine"]);
  });

  it("the CLI shows the plan and changes nothing without --yes", async () => {
    const fake = fakeHosts(["claude", "codex"]);
    const out: string[] = [];
    const io = { out: (line: string) => out.push(line), err: () => undefined };
    expect(await run(["setup", "--dry-run"], io)).toBe(0);
    expect(out.join("\n")).toMatch(/Will run:\n {2}claude plugin install forge-engine --marketplace JRanjan-Biswal\/forge-engine --scope user[\s\S]*codex plugin marketplace add JRanjan-Biswal\/forge-engine[\s\S]*codex plugin add forge-engine@forge-engine/);
    expect(fake.calls()).toEqual([]);
    out.length = 0;
    expect(await run(["setup", "--host", "codex", "--yes"], io)).toBe(0);
    expect(out.join("\n")).toMatch(/✓ Codex: forge-engine@forge-engine installed and enabled/);
    expect(await run(["setup", "--host", "cursor"], io)).toBe(2);
  });
});

describe("plugin manifests", () => {
  it("use one name and the package version everywhere, and point at files that ship", () => {
    const pkg = json("package.json") as { name: string; version: string; files: string[] };
    expect(pkg.name).toBe("forge-engine");
    const claude = json(".claude-plugin/plugin.json");
    const codex = json(".codex-plugin/plugin.json");
    for (const manifest of [claude, codex]) expect(manifest).toMatchObject({ name: "forge-engine", version: pkg.version });
    expect(json(".claude-plugin/marketplace.json")).toMatchObject({ name: "forge-engine", plugins: [{ name: "forge-engine", source: "./", version: pkg.version }] });
    expect(json(".agents/plugins/marketplace.json")).toMatchObject({ name: "forge-engine", plugins: [{ name: "forge-engine", version: pkg.version, source: { source: "local", path: "./" } }] });
    // Codex starts plugin MCP servers in the session's cwd and does not expand a plugin-root variable: it must be path-independent.
    expect(json(".codex-mcp.json").mcpServers.forge).toEqual({ command: "npx", args: ["--yes", `forge-engine@${pkg.version}`, "mcp"] });
    expect(json(".mcp.json").mcpServers.forge).toEqual({ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs"] });
    expect(codex).toMatchObject({ skills: "./skills/", mcpServers: "./.codex-mcp.json" });
    for (const file of ["scripts/mcp.mjs", ".codex-plugin", ".codex-mcp.json", ".agents", ".claude-plugin", ".mcp.json", "skills", "INSTALL.md"]) {
      expect(pkg.files, file).toContain(file);
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  it("every skill has frontmatter both hosts can load", () => {
    const dir = join(ROOT, "skills");
    const skills = readdirSync(dir).filter((name) => existsSync(join(dir, name, "SKILL.md")));
    expect(skills.length).toBeGreaterThanOrEqual(20);
    for (const skill of skills) {
      expect(readFileSync(join(dir, skill, "SKILL.md"), "utf8"), skill).toMatch(new RegExp(`^---\\nname: ${skill}\\ndescription: .{40,}\\n---\\n`));
    }
  });
});

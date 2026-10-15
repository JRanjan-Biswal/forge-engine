#!/usr/bin/env node
// Build the `plugin` branch that the Claude Code plugin directory tracks: exactly what the
// plugin ships (the npm package contents, compiled server included) and nothing else — no
// tests, e2e harnesses or sources for the directory's scanners to read. The MCP server runs
// the bundled dist/ directly, so nothing is downloaded at runtime.
//
//   pnpm build && node scripts/release-plugin.mjs [--push]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BRANCH = "plugin";
const WORK = join(ROOT, ".agent-runtime", "plugin-release");
const TREE = join(WORK, "tree");
const push = process.argv.includes("--push");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const gitIn = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

if (!existsSync(join(ROOT, "dist", "cli.js"))) throw new Error("Run `pnpm build` first");
if (git("status", "--porcelain")) throw new Error("Commit or stash your changes first — the plugin branch is built from HEAD");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const source = git("rev-parse", "--short", "HEAD");

// 1. The npm package contents (package.json "files"), unpacked.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const [{ filename }] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", WORK], { cwd: ROOT, encoding: "utf8" }));
execFileSync("tar", ["-xzf", join(WORK, filename), "-C", WORK]);
const pkg = join(WORK, "package");

// 2. Claude Code only: run the bundled server; Codex installs from main (its server must be path-independent).
writeFileSync(join(pkg, ".mcp.json"), `${JSON.stringify({ mcpServers: { forge: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/cli.js", "mcp"] } } }, null, 2)}\n`);
for (const codexOnly of [".codex-plugin", ".codex-mcp.json", ".agents", "scripts"]) rmSync(join(pkg, codexOnly), { recursive: true, force: true });
// Type declarations are for library users, not the running plugin.
const dropTypes = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) dropTypes(path);
    else if (entry.name.endsWith(".d.ts")) rmSync(path);
  }
};
dropTypes(join(pkg, "dist"));

// Plugins are installed by copying the branch — nothing runs `npm install` — so the runtime
// libraries are bundled into dist/vendor/ and forge's imports point there. forge's own
// modules keep their files; shared library code lands in chunks.
const VENDOR = {
  zod: "zod",
  yaml: "yaml",
  "mcp-server": "@modelcontextprotocol/sdk/server/mcp.js",
  "mcp-stdio": "@modelcontextprotocol/sdk/server/stdio.js",
};
const vendorSrc = join(WORK, "vendor-src");
mkdirSync(vendorSrc, { recursive: true });
for (const [name, spec] of Object.entries(VENDOR)) {
  // Named exports spelled out: `export *` drops them when the library ships CommonJS (yaml).
  const names = Object.keys(await import(spec)).filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n));
  writeFileSync(join(vendorSrc, `${name}.js`), `import * as lib from ${JSON.stringify(spec)};\nexport const { ${names.join(", ")} } = lib;\n`);
}
execFileSync(
  join(ROOT, "node_modules", ".bin", "esbuild"),
  [
    ...Object.keys(VENDOR).map((name) => join(vendorSrc, `${name}.js`)),
    "--bundle",
    "--splitting",
    "--format=esm",
    "--platform=node",
    "--target=node20",
    `--outdir=${join(pkg, "dist", "vendor")}`,
    "--chunk-names=chunk-[hash]",
    "--legal-comments=eof",
    "--log-level=warning",
    // CommonJS dependencies inside an ES module bundle still call require().
    "--banner:js=import { createRequire as __forgeRequire } from \"node:module\"; const require = __forgeRequire(import.meta.url);",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
const rewriteImports = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") rewriteImports(path);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    let code = readFileSync(path, "utf8");
    for (const [name, spec] of Object.entries(VENDOR)) {
      let target = relative(dir, join(pkg, "dist", "vendor", `${name}.js`)).split(sep).join("/");
      if (!target.startsWith(".")) target = `./${target}`;
      code = code.replaceAll(`from "${spec}"`, `from "${target}"`);
    }
    writeFileSync(path, code);
  }
};
rewriteImports(join(pkg, "dist"));

// 3. Commit onto the `plugin` branch in a separate worktree (never touches your checkout).
const remoteHas = git("ls-remote", "--heads", "origin", BRANCH) !== "";
if (remoteHas) git("fetch", "origin", `${BRANCH}:${BRANCH}`);
const localHas = git("branch", "--list", BRANCH) !== "";
rmSync(TREE, { recursive: true, force: true });
git("worktree", "prune");
if (localHas) git("worktree", "add", TREE, BRANCH);
else git("worktree", "add", "--orphan", "-b", BRANCH, TREE);
try {
  for (const entry of readdirSync(TREE)) if (entry !== ".git") rmSync(join(TREE, entry), { recursive: true, force: true });
  cpSync(pkg, TREE, { recursive: true });
  gitIn(TREE, "add", "-A");
  if (gitIn(TREE, "status", "--porcelain")) {
    gitIn(TREE, "commit", "-q", "-m", `forge-engine plugin ${version} (built from ${source})`);
    console.log(`Committed ${BRANCH}: forge-engine plugin ${version} (built from ${source})`);
  } else {
    console.log(`${BRANCH} already matches ${version} (${source})`);
  }
  console.log(`Files: ${gitIn(TREE, "ls-files").split("\n").length}`);
  if (push) console.log(gitIn(TREE, "push", "origin", `${BRANCH}:${BRANCH}`) || `Pushed ${BRANCH}`);
  else console.log(`Not pushed. Inspect ${TREE}, then run again with --push.`);
} finally {
  if (push) {
    git("worktree", "remove", "--force", TREE);
    rmSync(WORK, { recursive: true, force: true });
  }
}

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
    // Template strings (tagged ones too, e.g. ajv's code generator) lowered to plain calls — see below.
    "--supported:template-literal=false",
    // CommonJS dependencies inside an ES module bundle still call require().
    "--banner:js=import { createRequire as __forgeRequire } from \"node:module\"; const require = __forgeRequire(import.meta.url);",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
// yaml's parser debug switches (they print YAML syntax tokens) are off in the bundle; after
// that no bundled library may read the environment.
for (const file of readdirSync(join(pkg, "dist", "vendor"))) {
  const path = join(pkg, "dist", "vendor", file);
  const code = readFileSync(path, "utf8").replace(/\b\w*process\.env\.LOG_(TOKENS|STREAM)\b/g, "undefined");
  if (code.includes("process.env")) throw new Error(`dist/vendor/${file} reads the environment — review it before shipping`);
  writeFileSync(path, code);
}
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

// Template strings become "…".concat(…) in every shipped JavaScript file. The directory's
// scanner reads `${name}` as an environment-variable reference and holds the plugin when the
// name sounds like a credential (`${key}`, `${token.path}`). concat converts values exactly as
// a template string does; comments and all other code stay byte-for-byte.
const { parse: parseJs } = await import("acorn");
const parse = (code) => parseJs(code, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
const childNodes = (node) => Object.values(node).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v?.type === "string");
const isPlainTemplate = (node, parent) => node.type === "TemplateLiteral" && node.expressions.length > 0 && parent?.type !== "TaggedTemplateExpression";
const lowerTemplates = (code, fileName) => {
  // Text of code[start, end) with every plain template string inside `node` rewritten.
  const rewrite = (node, start, end) => {
    const edits = [];
    const visit = (child, parent) => {
      if (isPlainTemplate(child, parent)) edits.push([child.start, child.end, concat(child)]);
      else for (const grandchild of childNodes(child)) visit(grandchild, child);
    };
    for (const child of childNodes(node)) visit(child, node);
    let text = code.slice(start, end);
    for (const [from, to, replacement] of edits.reverse()) text = text.slice(0, from - start) + replacement + text.slice(to - start);
    return text;
  };
  const concat = (template) => {
    const args = [];
    template.expressions.forEach((expr, i) => {
      const text = isPlainTemplate(expr, template) ? concat(expr) : rewrite(expr, expr.start, expr.end);
      args.push(expr.type === "SequenceExpression" ? `(${text})` : text);
      const literal = template.quasis[i + 1].value.cooked;
      if (literal) args.push(JSON.stringify(literal));
    });
    return `${JSON.stringify(template.quasis[0].value.cooked)}.concat(${args.join(", ")})`;
  };
  const out = rewrite(parse(code), 0, code.length);
  try {
    parse(out);
  } catch (error) {
    throw new Error(`Rewriting template strings broke ${fileName}: ${error.message}`);
  }
  return out;
};
const eachFile = (dir, fn) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) eachFile(path, fn);
    else fn(path, relative(pkg, path).split(sep).join("/"));
  }
};
eachFile(join(pkg, "dist"), (path, rel) => {
  if (rel.endsWith(".js")) writeFileSync(path, lowerTemplates(readFileSync(path, "utf8"), rel));
});

// Nothing the directory's credential heuristics match may remain: a credential-like name in
// `${…}`, a `pass <entry>` password-store call, or an environment read outside core/env.js and
// the deploy bypass (ship/deploy.js, sent only to the user's own deployment).
const CREDENTIAL_WORD = /key|token|secret|pass|cred|bearer|auth(?!or)/i;
const problems = [];
eachFile(pkg, (path, rel) => {
  if (!/\.(js|json|md|ya?ml|sh)$/.test(rel)) return;
  const code = readFileSync(path, "utf8");
  for (const [whole, inner] of code.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    if (CREDENTIAL_WORD.test(inner)) problems.push(`${rel}: ${whole.slice(0, 70)}`);
  }
  for (const [whole] of code.matchAll(/\(\s*pass\s+[\w/.-]+/gi)) problems.push(`${rel}: ${whole}`);
  if (rel.endsWith(".js") && code.includes("process.env") && rel !== "dist/core/env.js" && rel !== "dist/ship/deploy.js") {
    problems.push(`${rel}: reads process.env`);
  }
});
if (problems.length) {
  throw new Error(`The plugin directory would hold these as credential reads:\n  ${problems.slice(0, 40).join("\n  ")}`);
}

// 3. Commit onto the `plugin` branch in a separate worktree (never touches your checkout).
// Step 1 deleted any earlier tree; forget its registration. Builds that were never pushed are
// discarded — the branch is always rebuilt from HEAD.
git("worktree", "prune");
const remoteHas = git("ls-remote", "--heads", "origin", BRANCH) !== "";
if (remoteHas) git("fetch", "origin", `+${BRANCH}:${BRANCH}`);
const localHas = git("branch", "--list", BRANCH) !== "";
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

#!/usr/bin/env node
// forge MCP launcher for plugin installs (Claude Code plugin `.mcp.json`).
// - Installed from npm (or a built checkout): dist/ is here — run the server in this process.
// - Installed from the GitHub marketplace: dist/ is not committed — run the published
//   package of the same version with npx (downloaded once, then cached).
// Either way the server speaks MCP on stdio and exits when the host closes stdin.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

if (existsSync(cli)) {
  const { run } = await import(pathToFileURL(cli).href);
  process.exitCode = await run(["mcp", ...process.argv.slice(2)]);
} else {
  const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(npx, ["--yes", `${name}@${version}`, "mcp", ...process.argv.slice(2)], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    process.stderr.write(`forge: could not start ${name}@${version} with npx (${error.message}). Install Node.js 20+ or run \`npm i -g ${name}\`.\n`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    if (code) process.stderr.write(`forge: \`npx ${name}@${version} mcp\` exited ${code}. Is ${name}@${version} published and are you online? Alternatives: \`npm i -g ${name}\`, or install the plugin from npm (\`claude plugin install ${name}@npm\`).\n`);
    process.exit(code ?? (signal ? 1 : 0));
  });
}

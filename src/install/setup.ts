import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { onPath } from "../build/stacks.js";

/**
 * `forge-engine setup`: install (or remove) the forge-engine plugin in the agent
 * hosts found on this machine, with their own plugin CLIs — Claude Code
 * (`claude plugin …`) and Codex (`codex plugin …`). Shows the exact commands first;
 * runs nothing without confirmation. Commands run as argument arrays (no shell).
 */

export const PLUGIN = "forge-engine";
export const REPO = "JRanjan-Biswal/forge-engine";
export type Host = "claude" | "codex";
export type Scope = "user" | "project" | "local";

export interface SetupStep {
  host: Host;
  label: string;
  argv: string[];
}

export interface SetupPlan {
  action: "install" | "remove";
  hosts: { host: Host; found: boolean }[];
  steps: SetupStep[];
  notes: string[];
}

export interface SetupOptions {
  hosts?: Host[];
  /** Marketplace source: a local path or owner/repo (default: the GitHub repo, for both hosts). */
  source?: string;
  scope?: Scope;
  remove?: boolean;
}

/** A local path becomes absolute; anything else (owner/repo, git URL) is passed through. */
function normalizeSource(source: string): string {
  if (source.startsWith("~/")) return resolve(homedir(), source.slice(2));
  if (source.startsWith(".") || source.startsWith("/") || existsSync(source)) return resolve(source);
  return source;
}

export function setupPlan(options: SetupOptions = {}): SetupPlan {
  const wanted: Host[] = options.hosts?.length ? options.hosts : ["claude", "codex"];
  const hosts = wanted.map((host) => ({ host, found: onPath(host) }));
  const scope = options.scope ?? "user";
  const source = options.source ? normalizeSource(options.source) : undefined;
  const steps: SetupStep[] = [];
  const notes: string[] = [];

  for (const { host, found } of hosts) {
    if (!found) {
      notes.push(`${host === "claude" ? "Claude Code (`claude`)" : "Codex (`codex`)"} is not installed — skipped`);
      continue;
    }
    if (host === "claude") {
      if (options.remove) {
        steps.push({ host, label: "Uninstall the Claude Code plugin", argv: ["claude", "plugin", "uninstall", PLUGIN, "--scope", scope] });
      } else {
        // The GitHub marketplace works for every account; `forge-engine@npm` installs are not enabled for all accounts.
        const from = source ?? REPO;
        steps.push({ host, label: `Install the Claude Code plugin from the ${from} marketplace (${scope} scope)`, argv: ["claude", "plugin", "install", PLUGIN, "--marketplace", from, "--scope", scope] });
      }
    } else if (options.remove) {
      steps.push({ host, label: "Remove the Codex plugin", argv: ["codex", "plugin", "remove", `${PLUGIN}@${PLUGIN}`] });
      steps.push({ host, label: "Remove the forge-engine Codex marketplace", argv: ["codex", "plugin", "marketplace", "remove", PLUGIN] });
    } else {
      const from = source ?? REPO;
      steps.push({ host, label: `Add the forge-engine Codex marketplace (${from})`, argv: ["codex", "plugin", "marketplace", "add", from] });
      steps.push({ host, label: "Install the Codex plugin", argv: ["codex", "plugin", "add", `${PLUGIN}@${PLUGIN}`] });
      if (options.scope && options.scope !== "user") notes.push("Codex has no install scopes — the plugin is enabled for every Codex session using this CODEX_HOME");
    }
  }
  if (!steps.length) notes.push("Nothing to do: install Claude Code or Codex first, or use any MCP client with `forge-engine mcp` (see INSTALL.md)");
  return { action: options.remove ? "remove" : "install", hosts, steps, notes };
}

export interface StepResult extends SetupStep {
  ok: boolean;
  output: string;
}

export interface SetupResult {
  plan: SetupPlan;
  results: StepResult[];
  verified: { host: Host; installed: boolean; detail: string }[];
}

function runArgv(argv: string[], timeout = 300_000): { ok: boolean; output: string } {
  const [command, ...args] = argv;
  if (!command) return { ok: false, output: "empty command" };
  const result = spawnSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`.trim();
  return { ok: result.status === 0, output };
}

/** Is the plugin installed (and enabled) according to the host's own CLI? */
export function verifyHost(host: Host): { installed: boolean; detail: string } {
  if (host === "claude") {
    const { ok, output } = runArgv(["claude", "plugin", "list", "--json"], 60_000);
    if (!ok) return { installed: false, detail: output.slice(0, 300) };
    const found = new RegExp(`"(?:id|name|plugin|pluginId)"\\s*:\\s*"${PLUGIN}(?:@[\\w.-]+)?"`).test(output);
    return { installed: found, detail: found ? `${PLUGIN} is listed by \`claude plugin list\`` : `${PLUGIN} is not listed by \`claude plugin list\`` };
  }
  const { ok, output } = runArgv(["codex", "plugin", "list", "--json"], 60_000);
  if (!ok) return { installed: false, detail: output.slice(0, 300) };
  try {
    const list = JSON.parse(output) as { installed?: { pluginId?: string; enabled?: boolean }[] };
    const entry = list.installed?.find((p) => p.pluginId === `${PLUGIN}@${PLUGIN}`);
    return { installed: Boolean(entry?.enabled), detail: entry ? `${entry.pluginId} installed${entry.enabled ? " and enabled" : " but disabled"}` : `${PLUGIN}@${PLUGIN} is not installed` };
  } catch {
    return { installed: output.includes(`${PLUGIN}@${PLUGIN}`), detail: output.slice(0, 200) };
  }
}

/** Run every step in order; a failed step stops that host's remaining steps. Then verify each host. */
export function runSetup(plan: SetupPlan, onStep?: (step: SetupStep) => void): SetupResult {
  const results: StepResult[] = [];
  const failedHosts = new Set<Host>();
  for (const step of plan.steps) {
    if (failedHosts.has(step.host)) continue;
    onStep?.(step);
    const { ok, output } = runArgv(step.argv);
    // Re-adding an existing marketplace is not worth stopping for.
    const benign = !ok && /already (?:added|exists|configured|installed)/i.test(output);
    results.push({ ...step, ok: ok || benign, output });
    if (!ok && !benign) failedHosts.add(step.host);
  }
  const touched = [...new Set(plan.steps.map((s) => s.host))];
  const verified = touched.map((host) => {
    const state = verifyHost(host);
    const expected = plan.action === "install";
    return { host, installed: state.installed, detail: expected === state.installed ? state.detail : `${state.detail} (expected it to be ${expected ? "installed" : "removed"})` };
  });
  return { plan, results, verified };
}

export const quoteArgv = (argv: string[]) => argv.map((a) => (/^[\w@./:=-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");

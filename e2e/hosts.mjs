#!/usr/bin/env node
// forge on real agent hosts. Each host gets one short agent task, so this costs a little.
// Usage (from the open-source folder):  node e2e/hosts.mjs [claude] [codex] [opencode]
// Writes e2e/runs/<timestamp>-hosts/REPORT.md and e2e/LATEST-hosts.md.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, E2E, FORGE, Suite, makeRunDir, readJson, sh, shAsync, tail, writeJson, writeText } from "./lib.mjs";

const suite = new Suite("agent hosts — Claude Code plugin · Codex MCP · OpenCode MCP");
const RUN = makeRunDir("hosts");
const wanted = process.argv.slice(2);
const enabled = (host) => (!wanted.length && host !== "claude-validate") || wanted.includes(host);
const FORGE_HOME = join(RUN, "forge-home");

const TASK = `You are testing the forge MCP server. Use ONLY the forge MCP tools — no shell commands and no file edits.
1. Call project_init with name "host-test".
2. Call stage_start with stage "brainstorm".
3. Call artifact_write with name "brainstorm" and data: an object with "theme": "habit tracking", "ideas": an array of exactly 3 ideas (each {"id": "I-1" | "I-2" | "I-3", "title", "oneLiner"}), and "chosenId" set to one of those ids.
4. Call stage_complete with stage "brainstorm". If the gate fails, fix the artifact and call stage_complete again.
5. Call ledger_add with a one-sentence summary of why you chose that idea.
Finally reply with exactly one line: GATE=passed or GATE=failed.`;

function verifyProject(host, dir, transcript) {
  const statePath = join(dir, ".forge/state.json");
  const initialised = existsSync(statePath);
  suite.check(`${host}: agent initialised the project through MCP`, initialised, tail(transcript, 15));
  if (!initialised) return;
  const state = readJson(statePath);
  suite.check(`${host}: brainstorm gate passed (verified on disk)`, state.stages.brainstorm?.status === "passed", JSON.stringify(state.stages.brainstorm));
  const artifactPath = join(dir, ".forge/artifacts/brainstorm.json");
  const brainstorm = existsSync(artifactPath) ? readJson(artifactPath) : null;
  suite.check(`${host}: artifact has 3 ideas and a valid chosenId`, brainstorm?.ideas?.length === 3 && brainstorm.ideas.some((i) => i.id === brainstorm.chosenId), JSON.stringify(brainstorm));
  const ledger = readFileSync(join(dir, ".forge/ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  suite.check(`${host}: agent recorded its decision in the ledger`, ledger.some((e) => e.kind === "decision" && e.by === "agent"), ledger.map((e) => `${e.id} ${e.kind}: ${e.summary}`).join(" | "));
  suite.check(`${host}: agent reported GATE=passed`, /GATE=passed/.test(transcript), tail(transcript, 5));
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// ── Claude Code ──────────────────────────────────────────────────────────────
if (enabled("claude")) {
  suite.begin("Claude Code — plugin loaded with --plugin-dir (session only)");
  await suite.guard("claude", async () => {
    const dir = join(RUN, "claude");
    mkdirSync(dir, { recursive: true });
    // FORGE_ROOT pins the MCP server to this test project whatever cwd the host gives it.
    const env = { ...process.env, FORGE_HOME, FORGE_ROOT: dir };
    const base = ["--plugin-dir", FORGE, "--model", "sonnet", "--max-budget-usd", "1"];

    let r = await shAsync("claude", ["-p", "Reply with OK.", ...base, "--output-format", "stream-json", "--verbose"], { cwd: dir, env, timeoutMs: 180_000 });
    const events = r.out.split("\n").map(parse).filter(Boolean);
    const init = events.find((e) => e.type === "system" && e.subtype === "init");
    writeJson(join(dir, "init-event.json"), init ?? { raw: r.all.slice(0, 5000) });
    suite.check("plugin loads (init event lists forge)", JSON.stringify(init?.plugins ?? []).includes("forge"), JSON.stringify(init?.plugins));
    const server = (init?.mcp_servers ?? []).find((s) => /forge/.test(s.name));
    suite.check("forge MCP server connects", server?.status === "connected", JSON.stringify(init?.mcp_servers));
    const tools = (init?.tools ?? []).filter((t) => t.startsWith("mcp__") && /forge/.test(t));
    suite.check("all 45 forge tools are exposed to the model", tools.length === 45, `${tools.length}: ${tools.slice(0, 3).join(", ")}`);
    const slash = (init?.slash_commands ?? []).filter((c) => /forge/.test(c));
    suite.check("/forge slash command is registered", slash.length > 0, JSON.stringify(slash));
    const agents = (init?.agents ?? []).filter((a) => /conductor/.test(a));
    suite.check("conductor agent is registered", agents.length > 0, JSON.stringify(init?.agents));
    const toolPrefix = tools[0]?.split("__").slice(0, 2).join("__") ?? "mcp__plugin_forge_forge";

    r = await shAsync("claude", ["-p", TASK, ...base, "--allowedTools", toolPrefix, "--output-format", "json"], { cwd: dir, env, timeoutMs: 420_000 });
    writeText(join(dir, "task-output.json"), r.all);
    const result = parse(r.out);
    suite.note("task cost", result?.total_cost_usd !== undefined ? `$${result.total_cost_usd.toFixed(3)} · ${result.num_turns} turns` : r.all.slice(0, 300));
    verifyProject("claude", dir, result?.result ?? r.all);

    if (slash[0]) {
      r = await shAsync("claude", ["-p", `/${slash[0]} status`, ...base, "--allowedTools", toolPrefix, "--output-format", "json"], { cwd: dir, env, timeoutMs: 300_000 });
      const out = parse(r.out)?.result ?? r.all;
      writeText(join(dir, "slash-status.txt"), out);
      suite.check(`/${slash[0]} status reports brainstorm passed and vision next`, /brainstorm/i.test(out) && /vision/i.test(out), tail(out, 12));
    }
  });
}

// ── Claude Code: a real validation (opt-in: real research, costs ~$1–4) ──────
if (wanted.includes("claude-validate")) {
  suite.begin("Claude Code — real /forge:validate run (research, subagents, evidence store, gate)");
  await suite.guard("claude-validate", async () => {
    const dir = join(RUN, "claude-validate");
    mkdirSync(dir, { recursive: true });
    const env = { ...process.env, FORGE_HOME, FORGE_ROOT: dir };
    const forge = (...args) => sh(process.execPath, [CLI, ...args], { cwd: dir, env });
    forge("init", "--name", "ram-guard");
    forge("skip", "brainstorm", "--reason", "e2e: idea supplied by the user");
    forge("skip", "vision", "--reason", "e2e: validate-only scenario");
    const idea =
      process.env.FORGE_E2E_IDEA ??
      "A CLI that finds and safely stops orphaned dev servers, file watchers and MCP server processes that eat RAM on developer laptops";
    const budget = process.env.FORGE_E2E_BUDGET ?? "4";
    suite.note("idea", idea);
    const r = await shAsync(
      "claude",
      [
        "-p", `/forge:validate ${idea}`,
        "--plugin-dir", FORGE,
        "--model", "sonnet",
        "--max-budget-usd", budget,
        "--allowedTools", "mcp__plugin_forge_forge,WebSearch,WebFetch,Task,Agent",
        "--output-format", "json",
      ],
      { cwd: dir, env, timeoutMs: 1_500_000 },
    );
    writeText(join(dir, "task-output.json"), r.all);
    const result = parse(r.out);
    suite.note("cost / turns", result ? `$${result.total_cost_usd?.toFixed(2)} · ${result.num_turns} turns · ${Math.round((result.duration_ms ?? 0) / 1000)}s` : r.all.slice(0, 300));

    const state = readJson(join(dir, ".forge/state.json"));
    const gateRuns = state.stages.validate?.gateRuns ?? 0;
    suite.check("agent ran the validate gate at least once", gateRuns > 0, JSON.stringify(state.stages.validate));
    const lastGate = gateRuns ? readJson(join(dir, `.forge/gates/validate-${gateRuns}.json`)) : null;
    const failing = (lastGate?.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
    suite.note("final gate", `run ${gateRuns}: failing = [${failing.join(", ")}]`);
    // An honest non-go verdict (pivot / kill / needs-experiment) is a correct outcome: the gate
    // must then stop at validation-verdictGo. Everything else — evidence, schema, scoring — must pass.
    const decisionOnly = new Set(["human-approval", "validation-verdictGo"]);
    suite.check(
      "agent satisfied every evidence, schema and scoring check (only the verdict decision / human approval remain)",
      failing.every((id) => decisionOnly.has(id)),
      (lastGate?.checks ?? []).filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.message.split("\n")[0]}`).join(" | "),
    );
    for (const name of ["validation", "competitors"]) {
      const v = forge("artifact", "validate", name);
      suite.check(`${name} artifact is schema-valid`, v.code === 0, v.all);
    }
    const evidence = existsSync(join(dir, ".forge/evidence/evidence.json")) ? readJson(join(dir, ".forge/evidence/evidence.json")).items : [];
    const verified = evidence.filter((e) => e.verification.status === "verified").length;
    suite.note("evidence store", `${evidence.length} items, ${verified} verified (${evidence.length ? Math.round((100 * verified) / evidence.length) : 0}%)`);
    suite.check("agent saved real evidence through the store", evidence.length >= 5, String(evidence.length));
    const validation = existsSync(join(dir, ".forge/artifacts/validation.json")) ? readJson(join(dir, ".forge/artifacts/validation.json")) : null;
    if (validation) {
      const answers = validation.criteria.reduce((acc, c) => ({ ...acc, [c.answer]: (acc[c.answer] ?? 0) + 1 }), {});
      suite.note("verdict", `${validation.verdict} · score ${validation.score} · answers ${JSON.stringify(answers)}`);
    }
    const competitors = existsSync(join(dir, ".forge/artifacts/competitors.json")) ? readJson(join(dir, ".forge/artifacts/competitors.json")).competitors : [];
    suite.note("competitors", competitors.map((c) => `${c.name} (${c.segment})`).join(", "));
  });
}

// ── Codex ────────────────────────────────────────────────────────────────────
if (enabled("codex")) {
  suite.begin("Codex CLI — forge MCP server via -c config overrides");
  await suite.guard("codex", async () => {
    const dir = join(RUN, "codex");
    mkdirSync(dir, { recursive: true });
    const args = [
      "exec",
      "--skip-git-repo-check",
      "-C", dir,
      "-s", "workspace-write",
      "-c", `mcp_servers.forge.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.forge.args=[${JSON.stringify(CLI)},"mcp"]`,
      "-c", `mcp_servers.forge.env={FORGE_ROOT=${JSON.stringify(dir)},FORGE_HOME=${JSON.stringify(FORGE_HOME)}}`,
      "-c", 'approval_policy="never"',
      TASK,
    ];
    const r = await shAsync("codex", args, { cwd: dir, env: process.env, timeoutMs: 600_000, input: "" });
    writeText(join(dir, "codex-output.txt"), r.all);
    verifyProject("codex", dir, r.all);
  });
}

// ── OpenCode ─────────────────────────────────────────────────────────────────
if (enabled("opencode")) {
  suite.begin("OpenCode — forge MCP server via opencode.json");
  await suite.guard("opencode", async () => {
    const dir = join(RUN, "opencode");
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, "opencode.json"), {
      $schema: "https://opencode.ai/config.json",
      mcp: { forge: { type: "local", command: [process.execPath, CLI, "mcp"], enabled: true, environment: { FORGE_ROOT: dir, FORGE_HOME } } },
    });
    // e.g. FORGE_E2E_OPENCODE_MODEL=xai/grok-4.7 to run the same test on Grok.
    const model = process.env.FORGE_E2E_OPENCODE_MODEL ?? "opencode/big-pickle";
    suite.note("model", model);
    const r = await shAsync("opencode", ["run", "-m", model, TASK, "--dir", dir], { cwd: dir, env: process.env, timeoutMs: 600_000, input: "" });
    writeText(join(dir, "opencode-output.txt"), r.all);
    verifyProject("opencode", dir, r.all);
  });
}

const report = suite.report({ forge: readJson(join(FORGE, "package.json")).version, "Run directory": RUN.replace(`${E2E}/`, "e2e/") });
writeText(join(RUN, "REPORT.md"), report);
writeText(join(E2E, "LATEST-hosts.md"), report);
console.log(`\n${suite.failed.length ? `FAILED (${suite.failed.length})` : "PASSED"} — ${join(RUN, "REPORT.md")}`);
process.exitCode = suite.failed.length ? 1 : 0;

import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath, setting } from "../core/env.js";
import { forgeHome, nowIso, writeJsonAtomic } from "../core/paths.js";
import { findGraphify } from "../memory/graphify.js";
/** "Not now" and failed installs are offered again after this long. */
export const ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 15 * 60 * 1000;
const STEP_TIMEOUT_MS = 300_000;
const HOST_NAME = { claude: "Claude Code", codex: "Codex" };
const DECISIONS = ["installed", "declined", "later", "failed"];
const onboardingFile = () => join(forgeHome(), "onboarding.json");
const lockFile = () => join(forgeHome(), "graphify-install.lock");
export const graphifyLogFile = () => join(forgeHome(), "logs", "graphify-install.log");
export function readOnboarding() {
    try {
        const data = JSON.parse(readFileSync(onboardingFile(), "utf8"));
        const g = data.graphify;
        return g && DECISIONS.includes(g.decision) && typeof g.at === "string" ? { graphify: { ...g, hosts: Array.isArray(g.hosts) ? g.hosts : [] } } : {};
    }
    catch {
        return {};
    }
}
export function recordGraphifyDecision(decision, hosts, detail) {
    const record = { ...readOnboarding(), graphify: { decision, at: nowIso(), hosts, ...(detail ? { detail } : {}) } };
    mkdirSync(forgeHome(), { recursive: true });
    writeJsonAtomic(onboardingFile(), record);
    return record;
}
/** Where `graphify install --platform <host>` puts graphify's skill. */
export function graphifySkillFile(host) {
    return join(homedir(), host === "claude" ? ".claude" : ".codex", "skills", "graphify", "SKILL.md");
}
export function detectGraphify() {
    return { cli: findGraphify(), skills: { claude: existsSync(graphifySkillFile("claude")), codex: existsSync(graphifySkillFile("codex")) } };
}
/** What installing graphify for these hosts would run — the CLI if missing, then each missing skill. */
export function graphifyPlan(hosts) {
    const state = detectGraphify();
    const steps = [];
    let blocker;
    if (!state.cli) {
        if (findOnPath("uv", { executable: true }))
            steps.push({ label: "Install the graphify CLI", argv: ["uv", "tool", "install", "graphifyy"] });
        else if (findOnPath("pipx", { executable: true }))
            steps.push({ label: "Install the graphify CLI", argv: ["pipx", "install", "graphifyy"] });
        else if (findOnPath("python3", { executable: true }))
            steps.push({ label: "Install the graphify CLI", argv: ["python3", "-m", "pip", "install", "--user", "graphifyy"] });
        else
            blocker = "graphify needs Python: install uv (docs.astral.sh/uv), then run `uv tool install graphifyy`";
    }
    for (const host of hosts) {
        if (!state.skills[host])
            steps.push({ label: "Add graphify's /graphify skill to ".concat(HOST_NAME[host]), argv: ["graphify", "install", "--platform", host] });
    }
    return { hosts, state, steps, ...(blocker ? { blocker } : {}) };
}
/** The graphify binary right after a fresh install, which may not be on this process's PATH yet. */
function graphifyCommand(installedWith) {
    const found = findGraphify();
    if (found)
        return [found];
    return installedWith === "python3" ? ["python3", "-m", "graphify"] : ["graphify"];
}
function acquireLock() {
    mkdirSync(forgeHome(), { recursive: true });
    const file = lockFile();
    try {
        if (existsSync(file) && Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS)
            rmSync(file, { force: true });
        closeSync(openSync(file, "wx"));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Install graphify for these hosts: one command at a time (argv, no shell), each bounded, output
 * appended to the log. Only one install runs per machine (lock file). Records the outcome.
 */
export function installGraphify(hosts, onStep) {
    const log = graphifyLogFile();
    const plan = graphifyPlan(hosts);
    if (plan.blocker) {
        recordGraphifyDecision("failed", hosts, plan.blocker);
        return { ok: false, blocker: plan.blocker, steps: [], state: plan.state, log };
    }
    if (!plan.steps.length)
        return { ok: true, steps: [], state: plan.state, log };
    if (!acquireLock())
        return { ok: false, busy: true, steps: [], state: plan.state, log };
    mkdirSync(join(forgeHome(), "logs"), { recursive: true });
    const results = [];
    try {
        const first = plan.steps[0]?.argv[0];
        const installer = first === "graphify" ? undefined : first;
        for (const step of plan.steps) {
            const argv = step.argv[0] === "graphify" ? [...graphifyCommand(installer), ...step.argv.slice(1)] : step.argv;
            onStep?.({ ...step, argv });
            const [command, ...args] = argv;
            const run = spawnSync(command, args, { encoding: "utf8", timeout: STEP_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
            const output = "".concat(run.stdout ?? "", run.stderr ?? "", run.error ? String(run.error) : "").trim();
            appendFileSync(log, "\n[".concat(nowIso(), "] $ ", argv.join(" "), "\n", output, "\n(exit ", run.status ?? "none", ")\n"));
            results.push({ ...step, argv, ok: run.status === 0, output });
            if (run.status !== 0)
                break;
        }
    }
    finally {
        rmSync(lockFile(), { force: true });
    }
    const state = detectGraphify();
    const ok = results.every((r) => r.ok) && hosts.every((h) => state.skills[h]);
    const failed = results.find((r) => !r.ok);
    recordGraphifyDecision(ok ? "installed" : "failed", hosts, failed ? "`".concat(failed.argv.join(" "), "` failed — see ", log) : undefined);
    return { ok, steps: results, state, log };
}
/** Should this host offer graphify now? Never in CI, never twice, never when it is already set up. */
export function graphifyOnboardingDue(host, now = Date.now()) {
    const state = detectGraphify();
    if (setting("FORGE_NO_ONBOARDING") || setting("CI"))
        return { due: false, reason: "onboarding is off (CI or FORGE_NO_ONBOARDING)", state };
    if (state.cli && state.skills[host])
        return { due: false, reason: "graphify is installed", state };
    const record = readOnboarding().graphify;
    if (record?.decision === "declined")
        return { due: false, reason: "declined on ".concat(record.at), state };
    if (record?.decision === "installed" && !state.cli)
        return { due: false, reason: "installed on ".concat(record.at, " and removed since — not asking again"), state };
    if ((record?.decision === "later" || record?.decision === "failed") && now - Date.parse(record.at) < ASK_AGAIN_MS) {
        return { due: false, reason: "".concat(record.decision === "later" ? "postponed" : "install failed", " on ", record.at, " — asking again 14 days later"), state };
    }
    if (existsSync(lockFile()))
        return { due: false, reason: "an install is running", state };
    return { due: true, reason: state.cli ? "graphify's skill is not set up for ".concat(HOST_NAME[host]) : "graphify is not installed", state };
}
/**
 * The one-time graphify offer `forge_status` hands the model, or nothing when it is not due.
 * Nothing is installed here: the model asks, then calls graphify_setup with the answer.
 */
export function graphifyOffer(host) {
    const due = graphifyOnboardingDue(host);
    if (!due.due)
        return undefined;
    const what = due.state.cli
        ? "graphify is installed, but its /graphify skill is not set up for ".concat(HOST_NAME[host], " (runs `graphify install --platform ", host, "`)")
        : "graphify (code-graph memory for forge's graph_* tools, product map and reviews) is not installed (runs `uv tool install graphifyy`, then `graphify install --platform ".concat(host, "`", host === "claude" ? ", which adds the /graphify skill and a short graphify section to ~/.claude/CLAUDE.md" : "", ")");
    return [
        "forge-engine onboarding: ".concat(what, "."),
        "If a person is in this session, ask them once, early and in one short question, whether to install it — options: install now / not now / never.",
        "Then call the forge-engine MCP tool graphify_setup with action \"install\" (hosts [\"".concat(host, "\"]), \"later\" or \"decline\", and tell them the result."),
        "If nobody can answer (an automated or non-interactive run), do not ask and do not install.",
    ].join(" ");
}

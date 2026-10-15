import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse, stringify } from "../vendor/yaml.js";
import { loadPack, packageManager, stackCommands } from "../build/stacks.js";
import { loadConfig } from "../core/config.js";
import { appendLedger } from "../core/ledger.js";
/**
 * GitHub Actions workflow generated from the configured stacks: one job per stack
 * that installs with its lockfile and runs exactly the gate commands forge would run
 * (build, lint, test, audit, e2e), plus a job running forge's security scan.
 */
export const WORKFLOW_PATH = ".github/workflows/forge.yml";
const INSTALL = {
    pnpm: "pnpm install --frozen-lockfile",
    npm: "npm ci",
    yarn: "yarn install --immutable",
    bun: "bun install --frozen-lockfile",
};
function readText(file) {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
}
function nodeVersion(root, dir) {
    for (const base of [resolve(root, dir), root]) {
        const pinned = readText(join(base, ".nvmrc")).trim() || readText(join(base, ".node-version")).trim();
        if (pinned)
            return pinned.replace(/^v/, "");
    }
    return "22";
}
function nodeSetup(root, dir, pm) {
    const steps = [];
    const declared = [resolve(root, dir), root].some((base) => /"packageManager"\s*:/.test(readText(join(base, "package.json"))));
    if (pm === "pnpm")
        steps.push({ uses: "pnpm/action-setup@v4", ...(declared ? {} : { with: { version: 10 } }) });
    if (pm === "bun")
        steps.push({ uses: "oven-sh/setup-bun@v2" });
    const lock = { pnpm: "pnpm-lock.yaml", npm: "package-lock.json", yarn: "yarn.lock", bun: "" }[pm];
    const lockPath = lock ? [join(dir, lock), lock].find((p) => existsSync(join(root, p))) : undefined;
    steps.push({
        uses: "actions/setup-node@v4",
        with: { "node-version": nodeVersion(root, dir), ...(pm !== "bun" && lockPath ? { cache: pm, "cache-dependency-path": lockPath } : {}) },
    });
    steps.push({ name: "Install", run: INSTALL[pm] });
    return steps;
}
function pythonSetup(root, dir) {
    const base = resolve(root, dir);
    if (existsSync(join(base, "uv.lock")))
        return [{ uses: "astral-sh/setup-uv@v6", with: { "enable-cache": true } }, { name: "Install", run: "uv sync --frozen" }];
    if (existsSync(join(base, "poetry.lock"))) {
        return [{ uses: "actions/setup-python@v5", with: { "python-version": "3.12" } }, { run: "pipx install poetry" }, { name: "Install", run: "poetry install --no-interaction" }];
    }
    return [
        { uses: "actions/setup-python@v5", with: { "python-version": "3.12", cache: "pip" } },
        { name: "Install", run: existsSync(join(base, "requirements.txt")) ? "pip install -r requirements.txt" : "pip install -e ." },
    ];
}
export function generateWorkflow(root) {
    const config = loadConfig(root);
    if (!config.stacks.length)
        throw new Error("No stacks configured — run `forge stack use` first");
    const jobs = {};
    const notes = [];
    for (const { pack: id, dir } of config.stacks) {
        const { pack } = loadPack(id, root);
        const { commands, missing } = stackCommands(root, id, dir);
        const name = `${id}${dir === "." ? "" : `-${dir.replace(/[^\w-]+/g, "-")}`}`;
        if (pack.language === "sql") {
            notes.push(`${id}: database tests need the local Supabase stack (Docker) — add supabase/setup-cli and \`supabase start\` to run them in CI`);
            continue;
        }
        const setup = pack.language === "python" ? pythonSetup(root, dir) : nodeSetup(root, dir, packageManager(root, dir));
        const run = [];
        for (const key of ["build", "lint", "test", "audit"]) {
            const command = commands[key];
            if (command)
                run.push({ name: key[0]?.toUpperCase() + key.slice(1), run: command });
        }
        const e2e = commands.e2e;
        if (e2e && /maestro/.test(e2e))
            notes.push(`${id}: Maestro flows need a simulator — run them on a macOS runner or Maestro Cloud`);
        else if (e2e) {
            if (/playwright test/.test(e2e))
                run.push({ name: "Install Playwright browsers", run: e2e.replace(/playwright test.*$/, "playwright install --with-deps chromium") });
            run.push({ name: "E2E", run: e2e });
        }
        for (const m of missing)
            notes.push(`${id}: no ${m.key} step (${m.why})`);
        jobs[name] = {
            "runs-on": "ubuntu-latest",
            "timeout-minutes": 30,
            defaults: { run: { "working-directory": dir } },
            steps: [{ uses: "actions/checkout@v4" }, ...setup, ...run],
        };
    }
    jobs.security = {
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 10,
        steps: [
            { uses: "actions/checkout@v4" },
            { uses: "actions/setup-node@v4", with: { "node-version": "22" } },
            { name: "forge security scan (injection sinks, secrets, env files)", run: "npx --yes forge-engine security scan" },
        ],
    };
    const workflow = {
        name: "forge",
        on: { push: { branches: ["main"] }, pull_request: {} },
        permissions: { contents: "read" },
        concurrency: { group: "forge-${{ github.ref }}", "cancel-in-progress": true },
        jobs,
    };
    const yaml = `# Generated by \`forge ci\` from forge.config.yaml stacks and commands. Re-run it after \`forge stack use\`.\n${stringify(workflow, { lineWidth: 0 })}`;
    parse(yaml); // must round-trip
    return { yaml, jobs: Object.keys(jobs), notes };
}
export function writeWorkflow(root, options = {}) {
    const { yaml, jobs, notes } = generateWorkflow(root);
    const file = join(root, WORKFLOW_PATH);
    if (existsSync(file) && !options.force) {
        const same = readFileSync(file, "utf8") === yaml;
        return { path: WORKFLOW_PATH, written: false, jobs, notes: same ? notes : [`${WORKFLOW_PATH} exists and differs — pass --force to replace it`, ...notes], yaml };
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, yaml);
    appendLedger(root, { kind: "decision", stage: "ship", summary: `CI workflow ${WORKFLOW_PATH}: ${jobs.join(", ")}`, why: "generated by forge ci from the configured stacks and gate commands" });
    return { path: WORKFLOW_PATH, written: true, jobs, notes, yaml };
}

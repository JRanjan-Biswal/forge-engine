import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseDocument } from "yaml";
import { loadConfig } from "../core/config.js";
import { appendLedger } from "../core/ledger.js";
import { withLock } from "../core/lock.js";
import { layout } from "../core/paths.js";
import { runCommand, withCommandSlot } from "../core/proc.js";
import { formatIssues, tail } from "../core/util.js";
import { GATE_COMMANDS, StackPack } from "../schemas/stack.js";
/**
 * Stack packs: recognise the stacks in a repo, derive gate commands only from what
 * the repo actually has (scripts, dependencies, files), record them in
 * forge.config.yaml, and put each stack's conventions into task briefs.
 */
/** The installed forge package (dist/build/stacks.js and src/build/stacks.ts are both two levels down). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILTIN_DIR = join(PACKAGE_ROOT, "stack-packs");
const LENS_FILE = "review-lens.md";
/** Project packs (`.forge/stack-packs/<id>/pack.yaml`) override built-ins with the same id. */
export function listPacks(root) {
    const found = new Map();
    const sources = [[BUILTIN_DIR, "builtin"]];
    if (root)
        sources.push([join(layout(root).forge, "stack-packs"), "project"]);
    for (const [base, source] of sources) {
        if (!existsSync(base))
            continue;
        for (const id of readdirSync(base).sort()) {
            const file = join(base, id, "pack.yaml");
            if (!existsSync(file))
                continue;
            const pack = parsePack(file);
            if (pack.id !== id)
                throw new Error(`${file}: id "${pack.id}" must match its directory "${id}"`);
            found.set(id, { pack, dir: join(base, id), source });
        }
    }
    return [...found.values()];
}
function parsePack(file) {
    const result = StackPack.safeParse(parse(readFileSync(file, "utf8")) ?? {});
    if (!result.success)
        throw new Error(`Invalid ${file}:\n${formatIssues(result.error)}`);
    return result.data;
}
export function loadPack(id, root) {
    const all = listPacks(root);
    const hit = all.find((p) => p.pack.id === id);
    if (!hit)
        throw new Error(`Unknown stack pack "${id}". Available: ${all.map((p) => p.pack.id).join(", ")}`);
    return hit;
}
/** The pack's conventions and review lens (markdown). */
export function readLens(id, root) {
    const file = join(loadPack(id, root).dir, LENS_FILE);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
}
/** One `## Heading` section of a markdown document, without the heading. */
export function lensSection(markdown, heading) {
    const lines = markdown.split("\n");
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
    if (start < 0)
        return "";
    const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
    return lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join("\n")
        .trim();
}
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "venv", "env", "__pycache__", "target", "vendor"]);
const NESTED_PARENTS = ["apps", "packages", "services"];
function readJson(file) {
    try {
        const value = JSON.parse(readFileSync(file, "utf8"));
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
function keys(value) {
    return value && typeof value === "object" ? Object.keys(value) : [];
}
const normalizePy = (name) => name.toLowerCase().replace(/[_.]+/g, "-");
/** Dependency names from pyproject.toml (PEP 621, dependency groups, Poetry) and requirements*.txt. */
function pythonDeps(abs, pyproject) {
    const deps = new Set();
    let section = "";
    let inArray = false;
    for (const raw of pyproject.split("\n")) {
        const line = raw.replace(/#.*$/, "").trim();
        const header = /^\[+([^\]]+)\]+$/.exec(line);
        if (header?.[1]) {
            section = header[1].trim();
            inArray = false;
            continue;
        }
        const depSection = /dependencies|dependency-groups/.test(section);
        const opensArray = /^[A-Za-z0-9_.-]+\s*=\s*\[/.test(line);
        if (opensArray && (/^[A-Za-z0-9_.-]*dependencies\s*=/.test(line) || depSection))
            inArray = true;
        if (inArray) {
            for (const match of line.matchAll(/["']([A-Za-z0-9][A-Za-z0-9_.-]*)/g))
                if (match[1])
                    deps.add(normalizePy(match[1]));
            if (line.includes("]"))
                inArray = false;
            continue;
        }
        // Poetry tables: `fastapi = "^0.115"` under [tool.poetry.dependencies].
        if (depSection) {
            const key = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=/.exec(line)?.[1];
            if (key && key !== "python")
                deps.add(normalizePy(key));
        }
    }
    for (const file of safeReaddir(abs).filter((f) => /^requirements.*\.txt$/.test(f))) {
        for (const raw of readFileSync(join(abs, file), "utf8").split("\n")) {
            const name = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/.exec(raw.replace(/#.*$/, ""))?.[1];
            if (name)
                deps.add(normalizePy(name));
        }
    }
    return deps;
}
function safeReaddir(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        return [];
    }
}
function factsFor(root, dir) {
    const abs = resolve(root, dir);
    const pkg = readJson(join(abs, "package.json"));
    const pyprojectFile = join(abs, "pyproject.toml");
    const pyproject = existsSync(pyprojectFile) ? readFileSync(pyprojectFile, "utf8") : "";
    return {
        dir,
        abs,
        npmDeps: new Set([...keys(pkg.dependencies), ...keys(pkg.devDependencies), ...keys(pkg.peerDependencies)]),
        scripts: new Set(keys(pkg.scripts)),
        pyDeps: pythonDeps(abs, pyproject),
        pyproject,
    };
}
/** The root, its top-level directories, and the children of apps/, packages/ and services/. */
function candidateDirs(root) {
    const subdirs = (rel) => safeReaddir(join(root, rel))
        .sort()
        .filter((name) => !name.startsWith(".") && !SKIP_DIRS.has(name))
        .map((name) => (rel === "." ? name : `${rel}/${name}`))
        .filter((path) => {
        try {
            return statSync(join(root, path)).isDirectory();
        }
        catch {
            return false;
        }
    });
    const top = subdirs(".");
    const nested = top.filter((dir) => NESTED_PARENTS.includes(dir)).flatMap(subdirs);
    return [".", ...top, ...nested];
}
export function detectStacks(root) {
    const packs = listPacks(root);
    const found = [];
    for (const dir of candidateDirs(root)) {
        const facts = factsFor(root, dir);
        for (const { pack } of packs) {
            const { packageDeps, pythonDeps: pyDeps, files, unlessDeps } = pack.detect;
            if (unlessDeps.some((dep) => facts.npmDeps.has(dep)))
                continue;
            const evidence = [
                ...packageDeps.filter((dep) => facts.npmDeps.has(dep)).map((dep) => `dependency ${dep}`),
                ...pyDeps.filter((dep) => facts.pyDeps.has(normalizePy(dep))).map((dep) => `python dependency ${dep}`),
                ...files.filter((file) => existsSync(join(facts.abs, file))).map((file) => `file ${file}`),
            ];
            if (evidence.length)
                found.push({ pack: pack.id, dir, evidence });
        }
    }
    return found;
}
const RUNNERS = {
    pnpm: { run: "pnpm", exec: "pnpm exec", dlx: "pnpm dlx", audit: "pnpm audit --prod --audit-level high" },
    npm: { run: "npm run", exec: "npx", dlx: "npx", audit: "npm audit --omit=dev --audit-level=high" },
    yarn: { run: "yarn", exec: "yarn", dlx: "yarn dlx", audit: "yarn npm audit --environment production --severity high" },
    bun: { run: "bun run", exec: "bunx", dlx: "bunx", audit: "bun audit --audit-level=high" },
};
const LOCKFILES = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
];
export function onPath(bin) {
    const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
    return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && exts.some((ext) => existsSync(join(dir, bin + ext))));
}
/** Lockfile in the stack directory or any parent up to the root, then `packageManager`, then what is installed. */
export function packageManager(root, dir = ".") {
    const top = resolve(root);
    let current = resolve(root, dir);
    for (;;) {
        for (const [file, pm] of LOCKFILES)
            if (existsSync(join(current, file)))
                return pm;
        const declared = readJson(join(current, "package.json")).packageManager;
        if (typeof declared === "string") {
            const name = declared.split("@")[0] ?? "";
            if (name in RUNNERS)
                return name;
        }
        if (current === top || !current.startsWith(top))
            break;
        current = dirname(current);
    }
    return onPath("pnpm") ? "pnpm" : "npm";
}
function pythonRunner(facts) {
    const has = (file) => existsSync(join(facts.abs, file));
    if (has("uv.lock"))
        return "uv run python";
    if (has("poetry.lock") || /^\[tool\.poetry\]/m.test(facts.pyproject))
        return "poetry run python";
    if (has(".venv/bin/python"))
        return ".venv/bin/python";
    if (facts.pyproject && onPath("uv"))
        return "uv run python";
    return "python3";
}
function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (whole, name) => values[name] ?? whole);
}
function unmet(req, facts) {
    if (req.script && !facts.scripts.has(req.script))
        return `no "${req.script}" script in package.json`;
    if (req.dep && !facts.npmDeps.has(req.dep) && !facts.pyDeps.has(normalizePy(req.dep)))
        return `${req.dep} is not a dependency`;
    if (req.file && !existsSync(join(facts.abs, req.file)))
        return `${req.file} does not exist`;
    if (req.bin && !onPath(req.bin))
        return `${req.bin} is not on PATH`;
    return undefined;
}
export function stackCommands(root, packId, dir = ".") {
    const { pack } = loadPack(packId, root);
    const facts = factsFor(root, dir);
    const pm = packageManager(root, dir);
    const values = { ...RUNNERS[pm], pm, python: pythonRunner(facts) };
    const commands = {};
    const missing = [];
    for (const key of GATE_COMMANDS) {
        const options = pack.commands[key];
        if (!options.length)
            continue;
        const reasons = [];
        const chosen = options.find((option) => {
            const why = unmet(option.requires, facts);
            if (why)
                reasons.push(why);
            return !why;
        });
        if (chosen)
            commands[key] = fill(chosen.run, values);
        else {
            const fix = pack.fixes[key];
            missing.push({ key, why: [...new Set(reasons)].join("; "), ...(fix ? { fix: fill(fix, values) } : {}) });
        }
    }
    return { pack: pack.id, dir, packageManager: pm, commands, missing };
}
const quote = (path) => (/^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);
/** One root-level command per gate key across all stacks (each runs in its own directory). */
export function combineCommands(stacks) {
    const combined = {};
    for (const key of GATE_COMMANDS) {
        const parts = stacks.flatMap((s) => {
            const command = s.commands[key];
            if (!command)
                return [];
            return [s.dir === "." ? command : `cd ${quote(s.dir)} && ${command}`];
        });
        if (!parts.length)
            continue;
        combined[key] = parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(" && ");
    }
    return combined;
}
/**
 * Record stacks in forge.config.yaml and fill empty gate commands from them. Without
 * `pack`, uses what `detectStacks` finds. Existing commands are kept unless `force`.
 */
export function useStacks(root, options = {}) {
    const configFile = layout(root).config;
    if (!existsSync(configFile))
        throw new Error("No forge.config.yaml here — run `forge init` (or `forge adopt`) first");
    const detected = detectStacks(root);
    let chosen;
    if (options.pack) {
        loadPack(options.pack, root);
        const dir = normalizeDir(root, options.dir ?? detected.find((d) => d.pack === options.pack)?.dir ?? ".");
        const configured = loadConfig(root).stacks.filter((s) => !(s.pack === options.pack && s.dir === dir));
        chosen = [...configured, { pack: options.pack, dir }];
    }
    else {
        if (!detected.length) {
            const ids = listPacks(root).map((p) => p.pack.id);
            throw new Error(`No known stack found in ${root}. Name one with \`forge stack use <pack> --dir <dir>\`, or scaffold one with \`forge stack scaffold <pack>\`. Packs: ${ids.join(", ")}`);
        }
        chosen = detected.map(({ pack, dir }) => ({ pack, dir }));
    }
    const stacks = chosen.map((s) => stackCommands(root, s.pack, s.dir));
    const combined = combineCommands(stacks);
    return withLock(root, () => {
        const doc = parseDocument(readFileSync(configFile, "utf8"));
        const current = loadConfig(root).commands;
        const set = {};
        const kept = {};
        for (const key of GATE_COMMANDS) {
            const suggested = combined[key];
            if (!suggested || current[key] === suggested)
                continue;
            const existing = current[key];
            if (existing && !options.force) {
                kept[key] = { current: existing, suggested };
                continue;
            }
            doc.setIn(["commands", key], suggested);
            set[key] = suggested;
        }
        doc.set("stacks", doc.createNode(chosen.map(({ pack, dir }) => ({ pack, dir }))));
        writeFileSync(configFile, doc.toString());
        loadConfig(root); // fail loudly if the edit produced an invalid config
        const why = [
            ...detected.filter((d) => chosen.some((c) => c.pack === d.pack && c.dir === d.dir)).map((d) => `${d.pack} in ${d.dir}: ${d.evidence.join(", ")}`),
            ...Object.entries(set).map(([key, value]) => `commands.${key} = ${value}`),
        ].join("; ");
        appendLedger(root, {
            kind: "decision",
            stage: "architect",
            summary: `Stacks: ${chosen.map((s) => `${s.pack} (${s.dir})`).join(", ")}`.slice(0, 1_000),
            ...(why ? { why: why.slice(0, 2_000) } : {}),
        });
        return { stacks, set, kept, detected };
    });
}
function normalizeDir(root, dir) {
    const rel = relative(resolve(root), resolve(root, dir));
    if (rel.startsWith("..") || resolve(rel) === rel)
        throw new Error(`--dir must be inside the project: ${dir}`);
    return rel === "" ? "." : rel.split(sep).join("/");
}
/** Configured stacks that a task touches: by file paths first, then by department, else the only one. */
export function stacksForTask(root, task) {
    const stacks = loadConfig(root).stacks;
    const byFiles = stacks.filter((s) => s.dir !== "." && task.files.some((file) => file === s.dir || file.startsWith(`${s.dir}/`)));
    if (byFiles.length)
        return byFiles;
    const byDept = stacks.filter((s) => {
        try {
            return loadPack(s.pack, root).pack.depts.includes(task.dept);
        }
        catch {
            return false;
        }
    });
    if (byDept.length)
        return byDept;
    return stacks.length === 1 ? stacks : [];
}
const DESIGN_EXPORTS = {
    css: "design/dist/tokens.css (CSS variables)",
    tailwind: "design/dist/tailwind.css (Tailwind v4 @theme) with design/dist/tokens.css",
    ts: "design/dist/theme.ts",
    flutter: "design/dist/tokens.dart",
    swiftui: "design/dist/ForgeTokens.swift",
    compose: "design/dist/ForgeTokens.kt",
    none: "",
};
/** Markdown for the "Stack" part of a task brief. */
export function stackBrief(root, task) {
    const lines = [];
    for (const { pack: id, dir } of stacksForTask(root, task)) {
        let pack;
        try {
            pack = loadPack(id, root).pack;
        }
        catch {
            lines.push("", `## Stack: ${id} — unknown pack; run \`forge stack list\``);
            continue;
        }
        const { commands, missing } = stackCommands(root, id, dir);
        const where = dir === "." ? "the project root" : `${dir}/`;
        lines.push("", `## Stack: ${pack.name} in ${where}`);
        const places = Object.entries(pack.layout).map(([what, path]) => `${what} → ${dir === "." ? path : `${dir}/${path}`}`);
        if (places.length)
            lines.push(`- Where things go: ${places.join("; ")}`);
        const runs = Object.entries(commands).map(([key, command]) => `${key} \`${command}\``);
        if (runs.length)
            lines.push(`- Run from ${where} before you report: ${runs.join(" · ")}`);
        for (const m of missing)
            lines.push(`- No ${m.key} command yet (${m.why})${m.fix ? ` — ${m.fix}` : ""}`);
        if (DESIGN_EXPORTS[pack.tokens])
            lines.push(`- Design tokens: ${DESIGN_EXPORTS[pack.tokens]} — run \`forge design build\`; never hard-code values.`);
        lines.push(`- QA: ${pack.qa}`);
        const conventions = lensSection(readLens(id, root), "Conventions");
        if (conventions)
            lines.push("", conventions.length > 3_000 ? `${conventions.slice(0, 3_000)}\n…(full: \`forge stack show ${id}\`)` : conventions);
    }
    return lines;
}
export function scaffoldPlan(root, packId, options = {}) {
    const { pack } = loadPack(packId, root);
    const native = pack.platforms.some((p) => p === "ios" || p === "android");
    const fallbackDir = pack.kind === "service" ? "api" : pack.kind === "data" ? "." : native ? "mobile" : "web";
    const dir = normalizeDir(root, options.dir ?? fallbackDir);
    if (options.pm && !(options.pm in RUNNERS))
        throw new Error(`--pm must be one of ${Object.keys(RUNNERS).join(", ")}`);
    const pm = options.pm ?? packageManager(root, ".");
    const values = { ...RUNNERS[pm], pm, dir: quote(dir) };
    return {
        pack: pack.id,
        dir,
        packageManager: pm,
        command: fill(pack.scaffold.command, values),
        then: pack.scaffold.then.map((step) => fill(step, values)),
        docs: pack.scaffold.docs,
    };
}
/**
 * Run the official generator (network, installs dependencies — one heavy job, in its
 * own process group, holding the project's command slot), then record the stack.
 */
export async function scaffoldStack(root, packId, options = {}) {
    const plan = scaffoldPlan(root, packId, options);
    const target = resolve(root, plan.dir);
    if (plan.dir !== "." && existsSync(target) && safeReaddir(target).length) {
        throw new Error(`${plan.dir}/ already exists and is not empty — scaffold into a new directory (--dir)`);
    }
    const { resources } = loadConfig(root);
    const timeoutMs = options.timeoutMs ?? 900_000;
    const steps = [[plan.command, root], ...plan.then.map((step) => [step, target])];
    let output = "";
    for (const [command, cwd] of steps) {
        const result = await withCommandSlot(root, { max: resources.maxConcurrentCommands, waitMs: resources.commandWaitMs, task: `forge stack scaffold ${packId}`, onWait: options.onWait }, () => runCommand(command, cwd, { timeoutMs }));
        output += `$ ${command}\n${tail(result.output.trim(), 4_000)}\n`;
        if (result.code !== 0 || result.timedOut)
            return { ...plan, ok: false, failedStep: command, output };
    }
    return { ...plan, ok: true, output, use: useStacks(root, { pack: packId, dir: plan.dir }) };
}

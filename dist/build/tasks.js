import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact, writeArtifact } from "../core/artifacts.js";
import { appendLedger } from "../core/ledger.js";
import { withLock } from "../core/lock.js";
import { listLearnings } from "../memory/learnings.js";
import { readLedger } from "../core/ledger.js";
import { stackBrief } from "./stacks.js";
export function loadTasks(root) {
    const tasks = loadArtifact(root, "tasks");
    if (!tasks)
        throw new Error("No tasks artifact yet — run the plan stage (artifact_write tasks)");
    return tasks.tasks;
}
/**
 * Waves of tasks that can run in parallel: a task joins the earliest wave after all
 * of its dependencies, and never shares a wave with a task that touches the same file.
 */
export function planWaves(tasks) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const level = new Map();
    const visiting = new Set();
    const depth = (id) => {
        const known = level.get(id);
        if (known !== undefined)
            return known;
        if (visiting.has(id))
            throw new Error(`dependency cycle through ${id}`);
        visiting.add(id);
        const task = byId.get(id);
        if (!task)
            throw new Error(`unknown task ${id}`);
        const value = task.deps.length ? Math.max(...task.deps.map((dep) => depth(dep) + 1)) : 0;
        visiting.delete(id);
        level.set(id, value);
        return value;
    };
    for (const task of tasks)
        depth(task.id);
    const waves = [];
    const waveOf = new Map();
    const ordered = [...tasks].sort((a, b) => (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0) || a.id.localeCompare(b.id));
    for (const task of ordered) {
        let index = task.deps.length ? Math.max(...task.deps.map((dep) => (waveOf.get(dep) ?? 0) + 1)) : 0;
        while (waves[index] && task.files.some((file) => waves[index]?.files.has(file)))
            index++;
        waves[index] ??= { ids: [], files: new Set() };
        waves[index]?.ids.push(task.id);
        for (const file of task.files)
            waves[index]?.files.add(file);
        waveOf.set(task.id, index);
    }
    return waves.map((wave) => wave.ids);
}
/** Tasks that are `todo` and whose dependencies are all `done`, in wave order. */
export function nextTasks(tasks) {
    const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
    const ready = new Set(tasks.filter((t) => t.status === "todo" && t.deps.every((d) => done.has(d))).map((t) => t.id));
    const first = planWaves(tasks).map((wave) => wave.filter((id) => ready.has(id))).find((wave) => wave.length) ?? [];
    return first.map((id) => tasks.find((t) => t.id === id));
}
export function updateTask(root, id, status, note) {
    return withLock(root, () => {
        const tasks = loadTasks(root);
        const task = tasks.find((t) => t.id === id);
        if (!task)
            throw new Error(`No task ${id}`);
        task.status = status;
        writeArtifact(root, "tasks", { tasks });
        appendLedger(root, { kind: "note", summary: `Task ${id} → ${status}${note ? `: ${note}` : ""}`.slice(0, 1_000) });
        return task;
    });
}
/** Everything one task needs, in one markdown document — for a subagent or a headless worker. */
export function taskBrief(root, id) {
    const tasks = loadTasks(root);
    const task = tasks.find((t) => t.id === id);
    if (!task)
        throw new Error(`No task ${id}`);
    const prd = safe(() => loadArtifact(root, "prd"));
    const screens = safe(() => loadArtifact(root, "screens"));
    const motion = safe(() => loadArtifact(root, "motion"));
    const stories = (prd?.stories ?? []).filter((s) => task.storyIds.includes(s.id));
    const taskScreens = (screens?.screens ?? []).filter((s) => s.storyIds.some((id) => task.storyIds.includes(id)));
    const taskMotion = (motion?.specs ?? []).filter((m) => m.storyIds.some((id) => task.storyIds.includes(id)));
    const contractFile = join(root, "contracts", "openapi.yaml");
    const contract = existsSync(contractFile) ? readFileSync(contractFile, "utf8") : "";
    const words = new Set(`${task.title} ${task.files.join(" ")}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const decisions = readLedger(root)
        .filter((e) => e.kind === "decision" && [...words].some((w) => `${e.summary} ${e.why ?? ""}`.toLowerCase().includes(w)))
        .slice(-6);
    const deps = task.deps.map((dep) => `${dep} (${tasks.find((t) => t.id === dep)?.status ?? "?"})`);
    const lines = [
        `# Task ${task.id}: ${task.title}`,
        "",
        `Department: ${task.dept}${task.agent ? ` · agent: ${task.agent}` : ""} · dependencies: ${deps.join(", ") || "none"}`,
        task.files.length ? `Files you own for this task: ${task.files.join(", ")} — do not edit files owned by other tasks in this wave.` : "",
        "",
        "## Acceptance",
        ...(task.acceptance.length ? task.acceptance.map((a) => `- ${a}`) : ["- (see stories below)"]),
        ...stories.flatMap((s) => [
            "",
            `## Story ${s.id}: as ${s.as}, I want ${s.iWant}, so that ${s.soThat}`,
            ...s.acceptance.map((a) => `- Given ${a.given}, when ${a.when}, then ${a.then}`),
        ]),
        ...(taskScreens.length
            ? ["", "## Screens", ...taskScreens.map((s) => `- ${s.id} (${s.route}, ${s.platform}): states ${s.states.join("/") || "—"}; components ${s.components.join(", ") || "—"}`)]
            : []),
        ...(taskMotion.length
            ? ["", "## Motion specs", ...taskMotion.map((m) => `- ${m.id}: ${m.trigger} → ${m.targets.join(", ")} (${m.kind}; reduced motion: ${m.reducedMotion?.kind ?? "MISSING"})`)]
            : []),
        ...(contract ? ["", "## API contract (contracts/openapi.yaml)", "```yaml", contract.slice(0, 6_000), "```"] : []),
        ...(decisions.length ? ["", "## Related decisions", ...decisions.map((d) => `- ${d.id}: ${d.summary}${d.why ? ` — ${d.why}` : ""}`)] : []),
        ...safe(() => stackBrief(root, task)) ?? [],
        ...((() => {
            const learnings = listLearnings(root).slice(-5);
            return learnings.length ? ["", "## Learnings", ...learnings.map((l) => l.text)] : [];
        })()),
        "",
        "## Rules",
        "- Write a failing test for each acceptance item first, then make it pass (TDD).",
        "- Use design tokens only (no hard-coded colours), the API contract as written, and no placeholder/mock data in product code.",
        "- Missing key, account or decision → record a blocker instead of faking it.",
        "- Start no long-lived processes you do not stop; one heavy job at a time (rules/process-lifecycle.md).",
        "- When done: run the project's build and tests, then report what changed, the tests you added, and anything left open.",
    ];
    return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}
function safe(fn) {
    try {
        return fn();
    }
    catch {
        return undefined;
    }
}

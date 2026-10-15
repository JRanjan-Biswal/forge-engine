import { spawnSync } from "node:child_process";
import { readlinkSync, realpathSync } from "node:fs";
import { freemem, hostname, totalmem, userInfo } from "node:os";
import { sep } from "node:path";
import { redactSecrets } from "../memory/secrets.js";
function readProcessTable() {
    const ps = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,user=,rss=,lstart=,command="], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (ps.status !== 0)
        throw new Error(`ps failed: ${ps.stderr || ps.error?.message}`);
    const rows = [];
    for (const line of ps.stdout.split("\n")) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length < 11)
            continue;
        const [pid, ppid, pgid, user, rss] = tokens;
        rows.push({
            pid: Number(pid),
            ppid: Number(ppid),
            pgid: Number(pgid),
            user: user ?? "",
            rssKb: Number(rss),
            started: tokens.slice(5, 10).join(" "),
            command: tokens.slice(10).join(" "),
        });
    }
    return { rows, psPid: ps.pid };
}
/** Working directory of each process: /proc on Linux, one `lsof` call on macOS. */
function readCwds(pids) {
    const cwds = new Map();
    if (process.platform === "linux") {
        for (const pid of pids) {
            try {
                cwds.set(pid, readlinkSync(`/proc/${pid}/cwd`));
            }
            catch {
                // gone, or not ours to read
            }
        }
        return cwds;
    }
    const lsof = spawnSync("lsof", ["-d", "cwd", "-Fpn"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let current;
    for (const line of lsof.stdout?.split("\n") ?? []) {
        if (line.startsWith("p"))
            current = Number(line.slice(1));
        else if (line.startsWith("n") && current !== undefined)
            cwds.set(current, line.slice(1));
    }
    return cwds;
}
function safeRealpath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
export function listProjectProcesses(root) {
    if (process.platform === "win32")
        throw new Error("forge procs is not supported on Windows yet");
    const { rows, psPid } = readProcessTable();
    const cwds = readCwds(rows.map((row) => row.pid));
    // lsof and /proc report real paths (macOS: /var → /private/var), so match both spellings.
    const roots = [...new Set([root, safeRealpath(root)])];
    const inside = (path) => roots.some((r) => path === r || path.startsWith(r + sep));
    const self = new Set([process.pid, psPid]);
    const matched = new Map();
    const add = (row, reason) => matched.set(row.pid, { ...row, command: redactSecrets(row.command).slice(0, 400), cwd: cwds.get(row.pid) ?? null, reason });
    for (const row of rows) {
        if (self.has(row.pid))
            continue;
        const cwd = cwds.get(row.pid);
        if (cwd && inside(cwd))
            add(row, "cwd");
        else if (roots.some((r) => row.command.includes(r)))
            add(row, "command");
    }
    for (let grew = true; grew;) {
        grew = false;
        for (const row of rows) {
            if (!matched.has(row.pid) && !self.has(row.pid) && matched.has(row.ppid)) {
                add(row, "descendant");
                grew = true;
            }
        }
    }
    return [...matched.values()].sort((a, b) => a.pid - b.pid);
}
export function memorySnapshot() {
    const totalGb = totalmem() / 1024 ** 3;
    if (process.platform === "darwin") {
        const result = spawnSync("memory_pressure", [], { encoding: "utf8" });
        const match = /free percentage:\s*(\d+)%/.exec(result.stdout ?? "");
        if (match)
            return { totalGb, freePercent: Number(match[1]), source: "memory_pressure" };
    }
    // os.freemem excludes reclaimable cache on macOS, so it understates what is available there.
    return { totalGb, freePercent: Math.round((100 * freemem()) / totalmem()), source: "os.freemem" };
}
/** Starter AGENT_PROCESSES.md for a project (see rules/process-lifecycle.md). */
export function registryTemplate(root, at = new Date().toISOString()) {
    const memory = memorySnapshot();
    return `# Agent process registry

Local process-control record shared by every agent working in this project. Keep it out of version control. Protocol: forge \`rules/process-lifecycle.md\`.

## 1. Process rules

- **Project root:** \`${root}\`
- **Host budget (measured ${at}):** ${hostname()}, user ${userInfo().username}, ${memory.totalGb.toFixed(1)} GB RAM, ${memory.freePercent}% free (${memory.source}).
- **Concurrency budget:** one heavy job (build, typecheck, test suite, e2e) at a time; test runners capped at 2 workers; no watchers or dev servers unless the task needs one.
- **Before launching** a server, watcher, test runner or browser: run \`forge procs\` and reuse what is already running.
- **Cleanup:** whoever starts a process stops it — and its children — and records the verified exit below.

## 2. Active processes

| Resource ID | Host/user | Task/session owner | Purpose | State | Started UTC | Verified UTC | PID/PPID/PGID + start-time fingerprint | Executable and redacted command | CWD/root | Bind/port | Children/count | Observed memory + metric | Log/snapshot | Cleanup or handoff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## 3. Lifecycle history

| Timestamp UTC | Resource ID | Agent/task | Transition/event | Live evidence or result |
| --- | --- | --- | --- | --- |
| ${at} | registry | forge procs init | Registry created | — |
`;
}

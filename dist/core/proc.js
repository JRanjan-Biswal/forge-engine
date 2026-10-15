import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tryAcquire } from "./lock.js";
import { layout } from "./paths.js";
/**
 * Running gate commands (builds, test suites) without leaking processes.
 *
 * - Every command runs in its own process group (POSIX) / process tree (Windows).
 * - When the command exits, times out, or forge itself is interrupted, the whole
 *   group is stopped — not just the shell wrapper — including background jobs the
 *   command left behind (e.g. a dev server started with `&`).
 * - A per-project command slot bounds how many heavy commands run at once, across
 *   every process and agent using the project (default: one).
 */
const IS_WINDOWS = process.platform === "win32";
const activeGroups = new Set();
let handlersInstalled = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function signalGroup(pgid, signal) {
    if (IS_WINDOWS) {
        spawnSync("taskkill", ["/pid", String(pgid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    try {
        process.kill(-pgid, signal);
    }
    catch {
        // group already gone
    }
}
function groupAlive(pgid) {
    try {
        process.kill(-pgid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
/** PIDs currently in a process group (POSIX). */
export function groupMembers(pgid) {
    if (IS_WINDOWS)
        return [];
    const result = spawnSync("ps", ["-axo", "pid=,pgid="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return result.stdout
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([pid, group]) => group === pgid && pid !== undefined && pid > 0)
        .map(([pid]) => pid);
}
/** SIGTERM the group, wait up to graceMs, then SIGKILL whatever is left. */
async function stopGroup(pgid, graceMs) {
    if (IS_WINDOWS) {
        signalGroup(pgid, "SIGKILL");
        return;
    }
    if (!groupAlive(pgid))
        return;
    signalGroup(pgid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (groupAlive(pgid) && Date.now() < deadline)
        await sleep(50);
    if (groupAlive(pgid))
        signalGroup(pgid, "SIGKILL");
}
function installHandlers() {
    if (handlersInstalled)
        return;
    handlersInstalled = true;
    // Last-chance cleanup; synchronous so it also runs on process.exit().
    process.on("exit", () => {
        for (const pgid of activeGroups)
            signalGroup(pgid, "SIGKILL");
    });
    const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
    for (const signal of Object.keys(codes)) {
        process.on(signal, () => {
            for (const pgid of activeGroups)
                signalGroup(pgid, "SIGKILL");
            activeGroups.clear();
            process.exit(codes[signal]);
        });
    }
}
export async function runCommand(command, cwd, options) {
    installHandlers();
    const graceMs = options.graceMs ?? 3_000;
    const maxOutput = options.maxOutputChars ?? 200_000;
    // forge-security-ignore js.spawn-shell -- gate commands are shell strings the project owner configured in forge.config.yaml
    const child = spawn(command, { cwd, shell: true, env: options.env, detached: !IS_WINDOWS, windowsHide: true });
    const pgid = child.pid;
    if (pgid !== undefined)
        activeGroups.add(pgid);
    let output = "";
    let timedOut = false;
    const collect = (chunk) => {
        output += chunk.toString();
        if (output.length > maxOutput)
            output = output.slice(-Math.floor(maxOutput / 2));
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const closed = new Promise((resolve) => child.on("close", () => resolve()));
    // Resolve on "exit" (the shell ended), not "close": background jobs that inherited
    // stdout would otherwise keep the pipes open and hang the gate until the timeout.
    const code = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            timedOut = true;
            if (pgid !== undefined)
                void stopGroup(pgid, graceMs);
        }, options.timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timer);
            output += error.message;
            resolve(127);
        });
        child.on("exit", (exitCode) => {
            clearTimeout(timer);
            resolve(exitCode);
        });
    });
    let leftovers = 0;
    if (pgid !== undefined) {
        leftovers = groupMembers(pgid).length;
        await stopGroup(pgid, graceMs);
        activeGroups.delete(pgid);
    }
    await Promise.race([closed, sleep(1_000)]); // flush remaining output
    return { code, output, timedOut, leftovers };
}
/**
 * Run `fn` while holding one of `max` per-project command slots. Waits (bounded by
 * waitMs) while every slot is held by a live process; reclaims slots whose owner died.
 */
export async function withCommandSlot(root, options, fn) {
    const dir = layout(root).forge;
    mkdirSync(dir, { recursive: true });
    const deadline = Date.now() + options.waitMs;
    let notified = false;
    for (;;) {
        for (let slot = 0; slot < options.max; slot++) {
            const file = join(dir, `.command-slot-${slot}.lock`);
            if (tryAcquire(file, options.task)) {
                try {
                    return await fn();
                }
                finally {
                    rmSync(file, { force: true });
                }
            }
        }
        if (Date.now() > deadline) {
            throw new Error(`All ${options.max} command slot(s) for this project stayed busy for ${Math.round(options.waitMs / 1000)}s ` +
                "(another agent is running a build or test). Raise resources.commandWaitMs or check `forge procs`.");
        }
        if (!notified) {
            notified = true;
            options.onWait?.();
        }
        await sleep(500);
    }
}

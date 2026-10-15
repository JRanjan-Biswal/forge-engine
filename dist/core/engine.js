import { existsSync } from "node:fs";
import { join } from "node:path";
import { State, StageState, TERMINAL_STATUSES, } from "../schemas/runtime.js";
import { redactSecrets } from "../memory/secrets.js";
import { loadConfig } from "./config.js";
import { runGate } from "./gates.js";
import { initProject } from "./init.js";
import { appendLedger } from "./ledger.js";
import { withLock } from "./lock.js";
import { findRoot, layout, nowIso, readJson, writeJsonAtomic } from "./paths.js";
import { enabledStages, findStage } from "./stages.js";
import { errorMessage, firstLine, formatIssues } from "./util.js";
export class ForgeError extends Error {
    name = "ForgeError";
}
const isTerminal = (status) => TERMINAL_STATUSES.includes(status);
/**
 * The deterministic spine of forge. Agents decide *how* to do a stage;
 * this class decides *whether* a stage is done, and what comes next.
 * State is re-read from disk on every call and every mutation runs under a
 * cross-process lock, so the CLI, the MCP server and parallel workers can
 * share one project safely.
 */
export class Forge {
    root;
    paths;
    constructor(root) {
        this.root = findRoot(root);
        this.paths = layout(this.root);
    }
    static init(root, options = {}) {
        return initProject(root, options);
    }
    get initialized() {
        return existsSync(this.paths.state);
    }
    config() {
        return loadConfig(this.root);
    }
    stages() {
        return enabledStages(this.config());
    }
    stage(id) {
        const stage = this.stages().find((candidate) => candidate.id === id);
        if (stage)
            return stage;
        const known = findStage(id);
        throw new ForgeError(known
            ? `Stage "${id}" is disabled for this project (${known.pack ? `enable pack "${known.pack}"` : "remove it from stages.skip"} in forge.config.yaml)`
            : `Unknown stage "${id}". Stages: ${this.stages().map((s) => s.id).join(", ")}`);
    }
    readState() {
        if (!this.initialized)
            throw new ForgeError(`No forge project at ${this.root}. Run \`forge init\` first.`);
        let raw;
        try {
            raw = readJson(this.paths.state);
        }
        catch (error) {
            throw new ForgeError(`.forge/state.json is not valid JSON (${errorMessage(error)}). Restore it from git, or run \`forge init --force\` to reset progress (the ledger is kept).`);
        }
        const parsed = State.safeParse(raw);
        if (!parsed.success)
            throw new ForgeError(`.forge/state.json is corrupt:\n${formatIssues(parsed.error)}`);
        // Stages from packs enabled after init start out pending.
        for (const stage of this.stages())
            parsed.data.stages[stage.id] ??= StageState.parse({});
        return parsed.data;
    }
    writeState(state) {
        state.updatedAt = nowIso();
        writeJsonAtomic(this.paths.state, state);
    }
    /** Read state, apply `change`, write it back — all under the project lock. */
    mutate(change) {
        return withLock(this.root, () => {
            const state = this.readState();
            const result = change(state);
            this.writeState(state);
            return result;
        });
    }
    stageState(state, id) {
        const stageState = state.stages[id];
        if (!stageState)
            throw new ForgeError(`Stage "${id}" is missing from state.json`);
        return stageState;
    }
    assertOpen(state) {
        if (state.archived) {
            throw new ForgeError(`Project is archived (${state.archived.reason}). Reopen a stage to continue.`);
        }
    }
    /** Earlier enabled stages that are not yet passed, skipped or overridden. */
    unfinishedBefore(state, id) {
        const stages = this.stages();
        const index = stages.findIndex((stage) => stage.id === id);
        return stages
            .slice(0, Math.max(index, 0))
            .filter((stage) => !isTerminal(this.stageState(state, stage.id).status))
            .map((stage) => stage.id);
    }
    next(state = this.readState()) {
        if (state.archived)
            return null;
        return this.stages().find((stage) => !isTerminal(this.stageState(state, stage.id).status)) ?? null;
    }
    status() {
        const state = this.readState();
        const next = this.next(state);
        return {
            root: this.root,
            project: state.project,
            autonomy: this.config().autonomy,
            current: state.current,
            next: next?.id ?? null,
            nextCommand: next?.command ?? null,
            archived: state.archived ?? null,
            blockers: state.blockers,
            stages: this.stages().map((stage) => {
                const s = this.stageState(state, stage.id);
                return {
                    id: stage.id,
                    title: stage.title,
                    command: stage.command,
                    status: s.status,
                    gateRuns: s.gateRuns,
                    lastFailures: s.lastGate && !s.lastGate.passed ? s.lastGate.failures : [],
                };
            }),
        };
    }
    start(id, options = {}) {
        return this.mutate((state) => {
            this.assertOpen(state);
            this.stage(id);
            const stageState = this.stageState(state, id);
            if (isTerminal(stageState.status)) {
                throw new ForgeError(`Stage "${id}" is already ${stageState.status}. Use \`forge reopen ${id}\` to work on it again.`);
            }
            const unfinished = this.unfinishedBefore(state, id);
            if (unfinished.length && !options.force) {
                throw new ForgeError(`Earlier stages are not finished: ${unfinished.join(", ")}. Complete, skip or override them first, or pass --force.`);
            }
            if (stageState.status === "pending")
                stageState.startedAt = nowIso();
            stageState.status = "active";
            state.current = id;
            appendLedger(this.root, {
                kind: "stage",
                stage: id,
                summary: `Started stage ${id}${unfinished.length ? ` (forced past unfinished: ${unfinished.join(", ")})` : ""}`,
            });
            return stageState;
        });
    }
    assertCompletable(state, id) {
        this.assertOpen(state);
        const stageState = this.stageState(state, id);
        if (stageState.status === "pending")
            throw new ForgeError(`Stage "${id}" has not been started. Run \`forge start ${id}\`.`);
        if (isTerminal(stageState.status))
            throw new ForgeError(`Stage "${id}" is already ${stageState.status}.`);
        return stageState;
    }
    /**
     * Run the stage gate. The stage passes only if no check fails. Gate commands
     * (builds, test suites) run outside the lock; the result is then applied to
     * freshly read state under the lock.
     */
    async complete(id) {
        const stage = this.stage(id);
        const snapshot = this.readState();
        const run = this.assertCompletable(snapshot, id).gateRuns + 1;
        const result = await runGate({ root: this.root, config: this.config(), stage, state: snapshot }, run);
        const failures = result.checks
            .filter((check) => check.status === "fail")
            .map((check) => `${check.id}: ${firstLine(check.message)}`);
        return this.mutate((state) => {
            const stageState = this.assertCompletable(state, id);
            result.run = stageState.gateRuns + 1; // another process may have run the gate meanwhile
            stageState.gateRuns = result.run;
            stageState.lastGate = { passed: result.passed, at: result.at, failures };
            if (result.passed) {
                stageState.status = "passed";
                stageState.completedAt = result.at;
                if (state.current === id)
                    state.current = null;
            }
            else {
                stageState.status = result.escalate ? "blocked" : "failed";
            }
            writeJsonAtomic(join(this.paths.gates, `${id}-${result.run}.json`), result);
            appendLedger(this.root, {
                kind: "gate",
                stage: id,
                summary: redactSecrets(result.passed
                    ? `Gate passed for ${id} (run ${result.run})`
                    : `Gate failed for ${id} (run ${result.run})${result.escalate ? ", escalated" : ""}: ${failures.join("; ")}`).slice(0, 2000),
                links: [`.forge/gates/${id}-${result.run}.json`],
            });
            return result;
        });
    }
    skip(id, reason, by) {
        return this.settle(id, "skipped", reason, by);
    }
    /** Mark a stage done despite its gate. Always recorded with the reason. */
    override(id, reason, by) {
        return this.settle(id, "overridden", reason, by);
    }
    settle(id, status, reason, by) {
        if (!reason.trim())
            throw new ForgeError(`A reason is required to ${status === "skipped" ? "skip" : "override"} a stage`);
        return this.mutate((state) => {
            this.assertOpen(state);
            this.stage(id);
            const stageState = this.stageState(state, id);
            if (stageState.status === "passed")
                throw new ForgeError(`Stage "${id}" already passed`);
            stageState.status = status;
            stageState.completedAt = nowIso();
            if (state.current === id)
                state.current = null;
            appendLedger(this.root, {
                kind: status === "skipped" ? "skip" : "override",
                stage: id,
                summary: status === "skipped" ? `Skipped stage ${id}` : `Overrode the gate for ${id}`,
                why: reason,
                by,
            });
            return stageState;
        });
    }
    approve(id, by = "human", note) {
        this.mutate((state) => {
            this.stage(id);
            state.approvals[id] = { by, at: nowIso(), ...(note ? { note } : {}) };
            appendLedger(this.root, { kind: "approval", stage: id, summary: `Approved stage ${id}`, why: note, by });
        });
    }
    /** Re-open a stage (and optionally every later stage) for another iteration. */
    reopen(id, reason, options = {}) {
        if (!reason.trim())
            throw new ForgeError("A reason is required to reopen a stage");
        return this.mutate((state) => {
            this.stage(id);
            const stages = this.stages();
            const index = stages.findIndex((stage) => stage.id === id);
            const reopened = (options.cascade ? stages.slice(index) : [stages[index]]).map((stage) => stage.id);
            for (const stageId of reopened) {
                state.stages[stageId] = StageState.parse({});
                delete state.approvals[stageId];
            }
            if (state.current && reopened.includes(state.current))
                state.current = null;
            delete state.archived;
            appendLedger(this.root, { kind: "reopen", stage: id, summary: `Reopened ${reopened.join(", ")}`, why: reason });
            return reopened;
        });
    }
    archive(reason) {
        if (!reason.trim())
            throw new ForgeError("A reason is required to archive a project");
        this.mutate((state) => {
            state.archived = { at: nowIso(), reason };
            state.current = null;
            appendLedger(this.root, { kind: "archive", summary: "Archived the project", why: reason });
        });
    }
    addBlocker(need, stage) {
        if (!need.trim())
            throw new ForgeError("Describe what is needed to unblock");
        if (stage)
            this.stage(stage);
        return this.mutate((state) => {
            const lastId = state.blockers.reduce((max, blocker) => Math.max(max, Number(blocker.id.slice(2))), 0);
            const blocker = { id: `B-${lastId + 1}`, need, since: nowIso(), ...(stage ? { stage } : {}) };
            state.blockers.push(blocker);
            appendLedger(this.root, { kind: "blocker", stage, summary: `Blocked (${blocker.id}): ${need}` });
            return blocker;
        });
    }
    resolveBlocker(id, note) {
        return this.mutate((state) => {
            const blocker = state.blockers.find((candidate) => candidate.id === id);
            if (!blocker)
                throw new ForgeError(`No open blocker ${id}`);
            state.blockers = state.blockers.filter((candidate) => candidate.id !== id);
            appendLedger(this.root, { kind: "blocker", stage: blocker.stage, summary: `Resolved ${id}: ${blocker.need}`, why: note });
            return blocker;
        });
    }
}

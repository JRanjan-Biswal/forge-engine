import { z } from "../vendor/zod.js";
import { IsoDate } from "./common.js";
export const StageStatus = z.enum([
    "pending",
    "active",
    "passed",
    "failed",
    "blocked",
    "skipped",
    "overridden",
]);
/** Statuses that let the pipeline move past a stage. */
export const TERMINAL_STATUSES = ["passed", "skipped", "overridden"];
export const StageState = z.object({
    status: StageStatus.default("pending"),
    gateRuns: z.number().int().min(0).default(0),
    startedAt: IsoDate.optional(),
    completedAt: IsoDate.optional(),
    lastGate: z
        .object({ passed: z.boolean(), at: IsoDate, failures: z.array(z.string()) })
        .optional(),
});
export const Approval = z.object({
    by: z.string().min(1),
    at: IsoDate,
    note: z.string().optional(),
});
export const Blocker = z.object({
    id: z.string().regex(/^B-\d+$/),
    need: z.string().min(1),
    stage: z.string().optional(),
    since: IsoDate,
});
export const State = z.object({
    version: z.literal(1),
    project: z.string().min(1),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    current: z.string().nullable(),
    stages: z.record(z.string(), StageState),
    approvals: z.record(z.string(), Approval).default({}),
    blockers: z.array(Blocker).default([]),
    archived: z.object({ at: IsoDate, reason: z.string().min(1) }).optional(),
});
// ── Gates ────────────────────────────────────────────────────────────────────
/** A number, or a reference to a forge.config.yaml value such as "gates.validate.minScore". */
export const NumberOrConfig = z.union([z.number(), z.object({ config: z.string().min(1) })]);
const checkBase = {
    id: z.string().min(1),
    description: z.string().min(1),
    /** Optional checks are skipped (not failed) when their inputs are not configured. */
    optional: z.boolean().default(false),
};
export const GateCheck = z.discriminatedUnion("type", [
    z.object({ type: z.literal("artifact"), artifact: z.string().min(1), ...checkBase }),
    z.object({
        type: z.literal("file"),
        path: z.string().min(1),
        nonEmpty: z.boolean().default(true),
        ...checkBase,
    }),
    z.object({
        type: z.literal("metric"),
        artifact: z.string().min(1),
        pointer: z.string().min(1),
        op: z.enum([">=", "<=", ">", "<", "==", "!="]),
        value: NumberOrConfig,
        ...checkBase,
    }),
    z.object({
        type: z.literal("command"),
        command: z.string().optional(),
        /** Read the command from forge.config.yaml, e.g. "commands.test". */
        configKey: z.string().optional(),
        timeoutMs: z.number().int().positive().default(600_000),
        ...checkBase,
    }),
    z.object({ type: z.literal("builtin"), name: z.string().min(1), ...checkBase }),
    z.object({ type: z.literal("rubric"), minPassRatio: NumberOrConfig.default(0.9), ...checkBase }),
    z.object({ type: z.literal("human"), ...checkBase }),
]);
export const CheckResult = z.object({
    id: z.string(),
    type: z.string(),
    status: z.enum(["pass", "fail", "skip"]),
    message: z.string(),
});
export const GateResult = z.object({
    stage: z.string(),
    run: z.number().int().positive(),
    passed: z.boolean(),
    at: IsoDate,
    checks: z.array(CheckResult),
    /** True when the stage has failed maxIterations times and needs a human decision. */
    escalate: z.boolean(),
    memo: z.string().optional(),
});
// ── Ledger ───────────────────────────────────────────────────────────────────
export const LedgerKind = z.enum([
    "init",
    "stage",
    "gate",
    "decision",
    "override",
    "skip",
    "approval",
    "blocker",
    "reopen",
    "archive",
    "note",
]);
export const LedgerEntry = z.object({
    id: z.string().regex(/^D-\d+$/),
    at: IsoDate,
    kind: LedgerKind,
    stage: z.string().optional(),
    summary: z.string().min(1),
    why: z.string().optional(),
    rejected: z.array(z.string()).default([]),
    by: z.string().optional(),
    links: z.array(z.string()).default([]),
});

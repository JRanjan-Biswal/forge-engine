import { z } from "zod";
export declare const StageStatus: z.ZodEnum<{
    active: "active";
    blocked: "blocked";
    failed: "failed";
    overridden: "overridden";
    passed: "passed";
    pending: "pending";
    skipped: "skipped";
}>;
export type StageStatus = z.infer<typeof StageStatus>;
/** Statuses that let the pipeline move past a stage. */
export declare const TERMINAL_STATUSES: readonly StageStatus[];
export declare const StageState: z.ZodObject<{
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        blocked: "blocked";
        failed: "failed";
        overridden: "overridden";
        passed: "passed";
        pending: "pending";
        skipped: "skipped";
    }>>;
    gateRuns: z.ZodDefault<z.ZodNumber>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
    lastGate: z.ZodOptional<z.ZodObject<{
        passed: z.ZodBoolean;
        at: z.ZodISODateTime;
        failures: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type StageState = z.infer<typeof StageState>;
export declare const Approval: z.ZodObject<{
    by: z.ZodString;
    at: z.ZodISODateTime;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const Blocker: z.ZodObject<{
    id: z.ZodString;
    need: z.ZodString;
    stage: z.ZodOptional<z.ZodString>;
    since: z.ZodISODateTime;
}, z.core.$strip>;
export type Blocker = z.infer<typeof Blocker>;
export declare const State: z.ZodObject<{
    version: z.ZodLiteral<1>;
    project: z.ZodString;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    current: z.ZodNullable<z.ZodString>;
    stages: z.ZodRecord<z.ZodString, z.ZodObject<{
        status: z.ZodDefault<z.ZodEnum<{
            active: "active";
            blocked: "blocked";
            failed: "failed";
            overridden: "overridden";
            passed: "passed";
            pending: "pending";
            skipped: "skipped";
        }>>;
        gateRuns: z.ZodDefault<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        completedAt: z.ZodOptional<z.ZodISODateTime>;
        lastGate: z.ZodOptional<z.ZodObject<{
            passed: z.ZodBoolean;
            at: z.ZodISODateTime;
            failures: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    approvals: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        by: z.ZodString;
        at: z.ZodISODateTime;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    blockers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        need: z.ZodString;
        stage: z.ZodOptional<z.ZodString>;
        since: z.ZodISODateTime;
    }, z.core.$strip>>>;
    archived: z.ZodOptional<z.ZodObject<{
        at: z.ZodISODateTime;
        reason: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type State = z.infer<typeof State>;
/** A number, or a reference to a forge.config.yaml value such as "gates.validate.minScore". */
export declare const NumberOrConfig: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
    config: z.ZodString;
}, z.core.$strip>]>;
export type NumberOrConfig = z.infer<typeof NumberOrConfig>;
export declare const GateCheck: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"artifact">;
    artifact: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"file">;
    path: z.ZodString;
    nonEmpty: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"metric">;
    artifact: z.ZodString;
    pointer: z.ZodString;
    op: z.ZodEnum<{
        "!=": "!=";
        "<": "<";
        "<=": "<=";
        "==": "==";
        ">": ">";
        ">=": ">=";
    }>;
    value: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        config: z.ZodString;
    }, z.core.$strip>]>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"command">;
    command: z.ZodOptional<z.ZodString>;
    configKey: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"builtin">;
    name: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"rubric">;
    minPassRatio: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        config: z.ZodString;
    }, z.core.$strip>]>>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
    type: z.ZodLiteral<"human">;
}, z.core.$strip>], "type">;
export type GateCheck = z.infer<typeof GateCheck>;
export type GateCheckInput = z.input<typeof GateCheck>;
export declare const CheckResult: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    status: z.ZodEnum<{
        fail: "fail";
        pass: "pass";
        skip: "skip";
    }>;
    message: z.ZodString;
}, z.core.$strip>;
export type CheckResult = z.infer<typeof CheckResult>;
export declare const GateResult: z.ZodObject<{
    stage: z.ZodString;
    run: z.ZodNumber;
    passed: z.ZodBoolean;
    at: z.ZodISODateTime;
    checks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        status: z.ZodEnum<{
            fail: "fail";
            pass: "pass";
            skip: "skip";
        }>;
        message: z.ZodString;
    }, z.core.$strip>>;
    escalate: z.ZodBoolean;
    memo: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type GateResult = z.infer<typeof GateResult>;
export declare const LedgerKind: z.ZodEnum<{
    approval: "approval";
    archive: "archive";
    blocker: "blocker";
    decision: "decision";
    gate: "gate";
    init: "init";
    note: "note";
    override: "override";
    reopen: "reopen";
    skip: "skip";
    stage: "stage";
}>;
export type LedgerKind = z.infer<typeof LedgerKind>;
export declare const LedgerEntry: z.ZodObject<{
    id: z.ZodString;
    at: z.ZodISODateTime;
    kind: z.ZodEnum<{
        approval: "approval";
        archive: "archive";
        blocker: "blocker";
        decision: "decision";
        gate: "gate";
        init: "init";
        note: "note";
        override: "override";
        reopen: "reopen";
        skip: "skip";
        stage: "stage";
    }>;
    stage: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    why: z.ZodOptional<z.ZodString>;
    rejected: z.ZodDefault<z.ZodArray<z.ZodString>>;
    by: z.ZodOptional<z.ZodString>;
    links: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type LedgerEntry = z.infer<typeof LedgerEntry>;

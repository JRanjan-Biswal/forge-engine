import { z } from "zod";
import { Evidence, Id, IsoDate } from "./common.js";
// ── Strategy & vision ────────────────────────────────────────────────────────
export const BrainstormIdea = z.object({
    id: Id,
    title: z.string().min(1),
    oneLiner: z.string().min(1),
    angle: z.string().optional(),
    technique: z.string().optional(),
    novelty: z.number().min(0).max(10).optional(),
    cluster: z.string().optional(),
});
export const Brainstorm = z.object({
    theme: z.string().optional(),
    ideas: z.array(BrainstormIdea).min(1),
    shortlist: z.array(Id).default([]),
    chosenId: Id.optional(),
});
export const Vision = z.object({
    northStar: z.string().min(1),
    problem: z.string().min(1),
    audience: z.string().min(1),
    principles: z.array(z.string().min(1)).min(1),
    antiGoals: z.array(z.string().min(1)),
    futurePicture: z.string().optional(),
    narrative: z.string().optional(),
    successMetrics: z
        .array(z.object({ name: z.string().min(1), target: z.string().optional() }))
        .min(1),
});
// ── Discovery & validation ───────────────────────────────────────────────────
export const Answer = z.enum(["yes", "no", "unknown"]);
export const ValidationCriterion = z.object({
    id: Id,
    group: z.enum([
        "problem",
        "market",
        "competition",
        "differentiation",
        "feasibility",
        "distribution",
        "monetization",
        "risk",
    ]),
    question: z.string().min(1),
    weight: z.number().positive().default(1),
    answer: Answer,
    evidence: z.array(Evidence).default([]),
    note: z.string().optional(),
});
export const Validation = z.object({
    idea: z.string().min(1),
    criteria: z.array(ValidationCriterion).min(1),
    score: z.number().min(0).max(100),
    verdict: z.enum(["go", "pivot", "kill", "needs-experiment"]),
    risks: z
        .array(z.object({ risk: z.string().min(1), severity: z.enum(["low", "medium", "high"]) }))
        .default([]),
    experiments: z
        .array(z.object({
        name: z.string().min(1),
        cost: z.string().optional(),
        signal: z.string().min(1),
    }))
        .default([]),
});
export const Competitor = z.object({
    name: z.string().min(1),
    url: z.url().optional(),
    segment: z.enum(["direct", "indirect", "substitute"]),
    pricing: z.string().optional(),
    features: z.array(z.string()).default([]),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    reviewComplaints: z.array(z.object({ source: z.url(), quote: z.string().min(1) })).default([]),
    gapOpportunities: z.array(z.string()).default([]),
    evidence: z.array(Evidence).default([]),
});
export const Competitors = z.object({ competitors: z.array(Competitor) });
export const Personas = z.object({
    personas: z.array(z.object({
        id: Id,
        name: z.string().min(1),
        jobsToBeDone: z.array(z.string().min(1)).min(1),
        pains: z.array(z.string()).default([]),
        evidence: z.array(Evidence).default([]),
        /** Synthetic personas are allowed but must be labelled as such. */
        synthetic: z.boolean(),
    })),
});
// ── Product ──────────────────────────────────────────────────────────────────
export const Acceptance = z.object({
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
});
export const Story = z.object({
    id: Id,
    as: z.string().min(1),
    iWant: z.string().min(1),
    soThat: z.string().min(1),
    priority: z.enum(["must", "should", "could", "wont"]),
    mvp: z.boolean().default(false),
    acceptance: z.array(Acceptance).default([]),
});
export const Prd = z.object({
    title: z.string().min(1),
    goals: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()).default([]),
    stories: z.array(Story).min(1),
    metrics: z
        .array(z.object({
        name: z.string().min(1),
        definition: z.string().min(1),
        target: z.string().optional(),
    }))
        .default([]),
    openQuestions: z.array(z.string()).default([]),
});
// ── Design & motion ──────────────────────────────────────────────────────────
export const UiState = z.enum(["empty", "loading", "error", "success"]);
export const Platform = z.enum(["web", "ios", "android"]);
export const Screen = z.object({
    id: Id,
    storyIds: z.array(Id).min(1),
    route: z.string().min(1),
    platform: Platform,
    components: z.array(z.string()).default([]),
    states: z.array(UiState).default([]),
    /** Screens with no data dependencies (e.g. a static about page) may opt out of state coverage. */
    stateless: z.boolean().default(false),
    copyKeys: z.array(z.string()).default([]),
});
export const Screens = z.object({ screens: z.array(Screen).min(1) });
export const MotionSpec = z.object({
    id: Id,
    storyIds: z.array(Id).default([]),
    trigger: z.string().min(1),
    targets: z.array(z.string().min(1)).min(1),
    kind: z.enum([
        "transition",
        "spring",
        "keyframes",
        "route",
        "shared-element",
        "scroll",
        "lottie",
        "rive",
    ]),
    durationToken: z.string().optional(),
    easingToken: z.string().optional(),
    springToken: z.string().optional(),
    keyframes: z.record(z.string(), z.array(z.union([z.number(), z.string()]))).optional(),
    reducedMotion: z
        .object({
        kind: z.enum(["none", "fade", "instant"]),
        durationToken: z.string().optional(),
    })
        .optional(),
    platforms: z.array(Platform).default(["web"]),
});
export const Motion = z.object({ specs: z.array(MotionSpec).min(1) });
// ── Planning & verification ──────────────────────────────────────────────────
export const Task = z.object({
    id: Id,
    title: z.string().min(1),
    storyIds: z.array(Id).default([]),
    dept: z.string().min(1),
    agent: z.string().optional(),
    deps: z.array(Id).default([]),
    files: z.array(z.string()).default([]),
    acceptance: z.array(z.string()).default([]),
    estimate: z.string().optional(),
    status: z.enum(["todo", "doing", "done", "blocked"]).default("todo"),
});
export const Tasks = z.object({ tasks: z.array(Task).min(1) });
export const Finding = z.object({
    id: Id,
    severity: z.enum(["critical", "high", "medium", "low"]),
    category: z.string().min(1),
    file: z.string().min(1),
    line: z.number().int().positive().optional(),
    claim: z.string().min(1),
    evidence: z.string().optional(),
    suggestedFix: z.string().optional(),
    verifiedBy: z.string().optional(),
    status: z.enum(["open", "fixed", "wontfix", "false-positive"]).default("open"),
});
export const Reviews = z.object({ findings: z.array(Finding) });
// ── Traceability ─────────────────────────────────────────────────────────────
export const TraceNodeType = z.enum([
    "vision",
    "story",
    "screen",
    "motion",
    "component",
    "endpoint",
    "code",
    "test",
    "release",
]);
export const TraceEdgeType = z.enum([
    "designedBy",
    "animatedBy",
    "implementedBy",
    "calls",
    "verifiedBy",
    "releasedIn",
    "uses",
]);
export const Trace = z.object({
    nodes: z
        .array(z.object({
        id: z.string().min(1),
        type: TraceNodeType,
        label: z.string().optional(),
        /** Node id in graphify-out/graph.json, linking product nodes to the code graph. */
        graphifyNode: z.string().optional(),
        /** Set by generators (e.g. "product-map") so they can refresh their own part of the graph. */
        origin: z.string().optional(),
    }))
        .default([]),
    edges: z
        .array(z.object({ from: z.string().min(1), to: z.string().min(1), type: TraceEdgeType, origin: z.string().optional() }))
        .default([]),
});
// ── Ship ─────────────────────────────────────────────────────────────────────
export const Release = z.object({
    version: z.string().min(1),
    commit: z.string().optional(),
    env: z.string().min(1),
    url: z.url().optional(),
    at: IsoDate,
    checks: z
        .array(z.object({ name: z.string().min(1), pass: z.boolean(), detail: z.string().optional() }))
        .min(1),
    rollback: z.string().min(1),
    /** Deploy target (pack target id, e.g. vercel) and who produced this record. */
    target: z.string().optional(),
    source: z.enum(["forge-deploy", "agent"]).optional(),
    /** Release notes file, relative to the project root. */
    notes: z.string().optional(),
});
// ── Gate support ─────────────────────────────────────────────────────────────
/** Written by a judge agent to .forge/gates/<stage>.rubric.json; read by rubric checks. */
export const RubricResult = z.object({
    judge: z.string().optional(),
    producer: z.string().optional(),
    criteria: z
        .array(z.object({
        id: Id,
        question: z.string().min(1),
        pass: z.boolean(),
        note: z.string().optional(),
    }))
        .min(1),
});

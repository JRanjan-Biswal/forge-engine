import { GateCheck, type GateCheckInput } from "../schemas/runtime.js";
import type { ForgeConfig } from "./config.js";

export interface StageDef {
  id: string;
  title: string;
  department: string;
  /** Slash command that runs this stage's team. */
  command: string;
  /** Only enabled when this pack is listed in forge.config.yaml `packs`. */
  pack?: string;
  outputs: string[];
  /** In autonomy=checkpoint, stages marked checkpoint need human approval. */
  checkpoint: boolean;
  summary: string;
  gate: GateCheck[];
}

type StageInput = Omit<StageDef, "gate" | "checkpoint" | "command"> & {
  checkpoint?: boolean;
  gate: GateCheckInput[];
};

const human: GateCheckInput = {
  type: "human",
  id: "human-approval",
  description: "A human approved this stage (forge approve <stage>)",
};

const artifact = (name: string): GateCheckInput => ({
  type: "artifact",
  id: `${name}-valid`,
  description: `${name} artifact exists and matches its schema`,
  artifact: name,
});

const builtin = (name: string, description: string): GateCheckInput => ({
  type: "builtin",
  id: name.replace(/\./g, "-"),
  description,
  name,
});

const STAGE_INPUTS: StageInput[] = [
  {
    id: "understand",
    title: "Understand the existing product",
    department: "product",
    pack: "adopt",
    outputs: ["product"],
    summary: "Map every page and endpoint, model features and gaps from the code (brownfield projects)",
    gate: [
      artifact("product"),
      builtin("product.mapFresh", "The product map matches the current code (run forge sync)"),
      builtin("product.coverage", "Every page and endpoint in the product map belongs to a feature or is ignored with a reason"),
    ],
  },
  {
    id: "brainstorm",
    title: "Brainstorm",
    department: "strategy",
    outputs: ["brainstorm"],
    summary: "Diverge on many ideas, converge on one",
    gate: [artifact("brainstorm"), builtin("brainstorm.chosen", "One idea is chosen and exists in ideas[]")],
  },
  {
    id: "vision",
    title: "Product vision",
    department: "strategy",
    outputs: ["vision"],
    checkpoint: true,
    summary: "North star, principles, anti-goals, success metrics",
    gate: [
      artifact("vision"),
      {
        type: "metric",
        id: "anti-goals",
        description: "At least 3 anti-goals are stated",
        artifact: "vision",
        pointer: "antiGoals.length",
        op: ">=",
        value: 3,
      },
      human,
    ],
  },
  {
    id: "validate",
    title: "Validate idea & competitors",
    department: "discovery",
    outputs: ["validation", "competitors"],
    checkpoint: true,
    summary: "Evidence-backed scorecard, competitor teardown, go/pivot/kill",
    gate: [
      artifact("validation"),
      artifact("competitors"),
      builtin("validation.evidenceRule", "Every 'yes' answer cites evidence"),
      builtin("validation.scoreConsistent", "Score matches the weighted yes/no answers"),
      {
        type: "metric",
        id: "min-score",
        description: "Validation score meets gates.validate.minScore",
        artifact: "validation",
        pointer: "score",
        op: ">=",
        value: { config: "gates.validate.minScore" },
      },
      builtin("validation.minEvidence", "Enough distinct cited sources (gates.validate.minEvidence)"),
      builtin("evidence.registered", "Every cited quote was saved — and checked — through the evidence store"),
      builtin("evidence.verifiedShare", "Enough cited quotes verified against their source (gates.validate.minVerifiedShare)"),
      {
        type: "metric",
        id: "min-competitors",
        description: "Enough competitors analysed (gates.validate.minCompetitors)",
        artifact: "competitors",
        pointer: "competitors.length",
        op: ">=",
        value: { config: "gates.validate.minCompetitors" },
      },
      builtin("validation.verdictGo", "Verdict is go (pivot, kill and needs-experiment need a decision)"),
      human,
    ],
  },
  {
    id: "spec",
    title: "Product spec",
    department: "product",
    outputs: ["prd"],
    summary: "PRD with stories, acceptance criteria and an MVP cut",
    gate: [
      artifact("prd"),
      builtin("prd.acceptance", "Every story (except wont) has Given/When/Then acceptance criteria"),
      builtin("prd.mvpCut", "At least one story is marked mvp"),
    ],
  },
  {
    id: "design",
    title: "UX/UI design",
    department: "design",
    outputs: ["screens"],
    checkpoint: true,
    summary: "Design tokens, components and screens for every MVP story",
    gate: [
      artifact("screens"),
      {
        type: "file",
        id: "design-tokens",
        description: "Design tokens exist in design/tokens/",
        path: "design/tokens",
      },
      builtin("design.storyCoverage", "Every MVP story has at least one screen"),
      builtin("design.states", "Every screen designs empty, loading, error and success states"),
      {
        type: "rubric",
        id: "design-critique",
        description: "Design critic rubric pass ratio meets gates.design.rubricMinPass",
        minPassRatio: { config: "gates.design.rubricMinPass" },
      },
      human,
    ],
  },
  {
    id: "motion",
    title: "Motion design",
    department: "motion",
    pack: "motion",
    outputs: ["motion"],
    summary: "Motion system and per-screen choreography",
    gate: [artifact("motion"), builtin("motion.reducedMotion", "Every motion spec has a reduced-motion fallback")],
  },
  {
    id: "architect",
    title: "Architecture",
    department: "architecture",
    outputs: ["architecture", "openapi"],
    summary: "Stack, boundaries, API contract, ADRs",
    gate: [
      artifact("architecture"),
      artifact("openapi"),
      {
        type: "file",
        id: "adrs",
        description: "At least one ADR in .forge/adr/",
        path: ".forge/adr",
      },
    ],
  },
  {
    id: "plan",
    title: "Plan",
    department: "product",
    outputs: ["tasks"],
    summary: "Task DAG linked to stories",
    gate: [
      artifact("tasks"),
      builtin("tasks.dag", "Task ids are unique, dependencies exist and there are no cycles"),
      builtin("tasks.storyCoverage", "Every MVP story is covered by at least one task"),
    ],
  },
  {
    id: "build",
    title: "Build",
    department: "engineering",
    outputs: [],
    summary: "Frontend, backend, web and mobile teams implement the task DAG",
    gate: [
      { type: "command", id: "build", description: "commands.build exits 0", configKey: "commands.build" },
      { type: "command", id: "test", description: "commands.test exits 0", configKey: "commands.test" },
    ],
  },
  {
    id: "verify",
    title: "Verify",
    department: "quality",
    outputs: ["reviews"],
    summary: "Review, QA, debug and fix until nothing blocking is open",
    gate: [
      artifact("reviews"),
      builtin("review.noBlocking", "No open critical or high findings"),
      { type: "command", id: "e2e", description: "commands.e2e exits 0", configKey: "commands.e2e", optional: true },
      { type: "command", id: "lint", description: "commands.lint exits 0", configKey: "commands.lint", optional: true },
    ],
  },
  {
    id: "gap",
    title: "Gap analysis",
    department: "gap",
    outputs: ["trace"],
    summary: "Every MVP story traced to design, code and tests; no placeholder data",
    gate: [
      artifact("trace"),
      builtin("trace.coverage", "Trace coverage meets gates.gap.minCoverage"),
      builtin("gap.noPlaceholders", "No placeholder, fake or mock data in product code"),
      builtin("pages.noMustFix", "Every audited page has no open must-fix atoms (pro-page-complete)"),
    ],
  },
  {
    id: "ship",
    title: "Ship",
    department: "devops",
    outputs: ["release"],
    checkpoint: true,
    summary: "Deploy with passing release checks and a rollback plan",
    gate: [artifact("release"), builtin("release.checksPass", "Every release check passed"), human],
  },
  {
    id: "launch",
    title: "Launch",
    department: "growth",
    pack: "growth",
    outputs: ["launch"],
    summary: "Landing page, analytics and launch kit",
    gate: [artifact("launch")],
  },
  {
    id: "learn",
    title: "Learn",
    department: "memory",
    outputs: [],
    summary: "Retro: save the episode and promote learnings",
    gate: [builtin("memory.episodeSinceStart", "An episode was saved after this stage started")],
  },
];

export const STAGES: readonly StageDef[] = STAGE_INPUTS.map((stage) => ({
  ...stage,
  // Every stage is driven through the one shipped command until per-stage commands exist.
  command: `/forge ${stage.id}`,
  checkpoint: stage.checkpoint ?? false,
  gate: stage.gate.map((check) => GateCheck.parse(check)),
}));

export function findStage(id: string): StageDef | undefined {
  return STAGES.find((stage) => stage.id === id);
}

/** Stages in pipeline order, minus packs that are not enabled and stages listed in stages.skip. */
export function enabledStages(config: ForgeConfig): StageDef[] {
  return STAGES.filter(
    (stage) => (!stage.pack || config.packs.includes(stage.pack)) && !config.stages.skip.includes(stage.id),
  );
}

export const HUMAN_CHECK: GateCheck = GateCheck.parse(human);

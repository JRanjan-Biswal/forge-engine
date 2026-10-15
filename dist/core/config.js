import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { layout } from "./paths.js";
import { formatIssues } from "./util.js";
/** Empty YAML values (`build:`) arrive as null; treat them as "not configured". */
const OptionalCommand = z
    .string()
    .nullish()
    .transform((value) => (value && value.trim() ? value : undefined));
export const ForgeConfig = z.object({
    project: z.string().min(1).default("untitled"),
    platforms: z.array(z.enum(["web", "ios", "android", "desktop", "api"])).default(["web"]),
    packs: z.array(z.string()).default([]),
    /** Stack packs in use and the directory each one lives in (`forge stack use`). */
    stacks: z
        .array(z.object({ pack: z.string().min(1), dir: z.string().min(1).default(".") }).strict())
        .default([]),
    autonomy: z.enum(["auto", "checkpoint", "strict"]).default("checkpoint"),
    maxIterations: z.number().int().positive().default(3),
    commands: z
        .object({
        build: OptionalCommand,
        test: OptionalCommand,
        e2e: OptionalCommand,
        lint: OptionalCommand,
        /** Dependency vulnerability audit (e.g. pnpm audit --audit-level high). */
        audit: OptionalCommand,
    })
        .prefault({}),
    gates: z
        .object({
        validate: z
            .object({
            minScore: z.number().min(0).max(100).default(65),
            minEvidence: z.number().int().min(0).default(10),
            minCompetitors: z.number().int().min(0).default(5),
            /** Every cited quote must have been saved (and checked) through the evidence store. */
            requireEvidenceStore: z.boolean().default(true),
            /** Share of cited quotes that must be verified against their source page/result. */
            minVerifiedShare: z.number().min(0).max(1).default(0.6),
        })
            .prefault({}),
        design: z
            .object({
            rubricMinPass: z.number().min(0).max(1).default(0.9),
            /** Require fresh prototype screenshots (and a critique newer than them) — needs a local Chromium-family browser. */
            screenshots: z.boolean().default(true),
        })
            .prefault({}),
        qa: z
            .object({
            /** Share of MVP acceptance criteria that must have a tagged test (@S-1/AC1). */
            minCoverage: z.number().min(0).max(1).default(1),
        })
            .prefault({}),
        gap: z
            .object({
            minCoverage: z.number().min(0).max(1).default(0.95),
            scanDirs: z.array(z.string()).default(["src", "app", "lib", "packages"]),
            /** Implemented endpoints allowed outside the contract, as "METHOD /path". */
            contractIgnore: z.array(z.string()).default(["GET /health", "GET /healthz", "GET /readyz", "GET /livez"]),
            /** MVP stories that are deliberately on one platform only (parity check). */
            parityExempt: z.array(z.string()).default([]),
        })
            .prefault({}),
    })
        .prefault({}),
    security: z
        .object({
        /** Lowest severity that fails the verify gate (static scan and header check). */
        failOn: z.enum(["critical", "high", "medium", "low"]).default("high"),
        /** Running app (local or preview) whose response headers, cookies and CORS the verify gate checks. */
        url: z
            .string()
            .nullish()
            .transform((value) => (value && value.trim() ? value.trim() : undefined)),
        /** Paths (globs) the static scan skips, e.g. vendored code. */
        ignore: z.array(z.string()).default([]),
    })
        .prefault({}),
    deploy: z
        .object({
        /** Deploy target per stack pack, e.g. { nextjs: vercel }; default: the pack's first target whose CLI is installed. */
        targets: z.record(z.string(), z.string()).default({}),
        /** Path the post-deploy smoke test requests. */
        healthPath: z.string().default("/"),
        /** Run commands.e2e against the deployed URL (as BASE_URL / PLAYWRIGHT_BASE_URL). */
        e2e: z.boolean().default(true),
    })
        .prefault({}),
    stages: z.object({ skip: z.array(z.string()).default([]) }).prefault({}),
    workers: z
        .object({
        /** Agent CLI used by `forge workers run`: claude | codex | gemini | opencode. */
        host: z.string().default("claude"),
        /** Headless workers alive at once (RAM protection — raise only with headroom). */
        maxConcurrent: z.number().int().min(1).max(8).default(1),
        timeoutMs: z.number().int().positive().default(1_800_000),
        /** Extra CLI arguments for the host (e.g. --allowedTools …); empty uses forge's safe default. */
        args: z.string().default(""),
    })
        .prefault({}),
    resources: z
        .object({
        /** Heavy gate commands (builds, test suites) allowed at once across all agents. */
        maxConcurrentCommands: z.number().int().min(1).max(8).default(1),
        /** How long a gate waits for a free command slot before failing. */
        commandWaitMs: z.number().int().positive().default(900_000),
    })
        .prefault({}),
});
export function loadConfig(root) {
    const path = layout(root).config;
    if (!existsSync(path))
        return ForgeConfig.parse({});
    const raw = parse(readFileSync(path, "utf8")) ?? {};
    const result = ForgeConfig.safeParse(raw);
    if (!result.success)
        throw new Error(`Invalid ${path}:\n${formatIssues(result.error)}`);
    return result.data;
}
export function defaultConfigYaml(project) {
    return `# forge project configuration
project: ${JSON.stringify(project)}
platforms: [web]          # web | ios | android | desktop | api
packs: []                 # optional departments, e.g. [motion, mobile, growth]
stacks: []                # stack packs and their directories; \`forge stack use\` detects and fills these
autonomy: checkpoint      # auto | checkpoint (human approves key stages) | strict (every stage)
maxIterations: 3          # gate failures before forge escalates with a decision memo

# Commands used by the build and verify gates. Leave them empty until the app exists:
# forge fails a gate whose command is not configured rather than assuming it passed.
commands:
  build:
  test:
  e2e:
  lint:
  audit:                  # dependency vulnerabilities, e.g. pnpm audit --audit-level high

gates:
  validate:
    minScore: 65          # weighted share of "yes" answers, 0-100
    minEvidence: 10       # distinct cited sources across criteria and competitors
    minCompetitors: 5
    requireEvidenceStore: true  # cited quotes must go through evidence_save (checked against the source)
    minVerifiedShare: 0.6       # share of cited quotes verified against their page or search result
  design:
    rubricMinPass: 0.9    # share of design-critic rubric criteria that must pass
    screenshots: true     # require fresh \`forge design shots\` of every screen × state, critiqued after they were taken
  qa:
    minCoverage: 1        # share of MVP acceptance criteria with a tagged test (@S-1/AC1) — forge qa coverage
  gap:
    minCoverage: 0.95     # share of MVP story requirements traced to design, code and tests
    scanDirs: [src, app, lib, packages]
    contractIgnore: [GET /health, GET /healthz, GET /readyz, GET /livez]  # endpoints allowed outside contracts/openapi.yaml
    parityExempt: []      # MVP stories deliberately on one platform (web vs mobile parity)

security:
  failOn: high            # critical | high | medium | low — static scan + header check severity that fails verify
  url:                    # running app (local or preview) to check headers, cookies and CORS; empty skips that check
  ignore: []              # globs the static scan skips, e.g. [vendor/**]

deploy:
  targets: {}             # per stack pack, e.g. { nextjs: vercel, fastapi: fly }; default: first installed CLI
  healthPath: /           # smoke-tested after every deploy
  e2e: true               # run commands.e2e against the deployed URL (BASE_URL / PLAYWRIGHT_BASE_URL)

stages:
  skip: []                # stage ids to leave out of this project's pipeline

# RAM protection: gate commands run in their own process group (stopped on exit,
# timeout or Ctrl-C) and share a per-project slot, so parallel agents cannot stack
# builds or test suites. Raise maxConcurrentCommands only on a machine with headroom.
resources:
  maxConcurrentCommands: 1
  commandWaitMs: 900000   # wait up to 15 min for a free slot
`;
}

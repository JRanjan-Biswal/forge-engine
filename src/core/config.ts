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
  autonomy: z.enum(["auto", "checkpoint", "strict"]).default("checkpoint"),
  maxIterations: z.number().int().positive().default(3),
  commands: z
    .object({
      build: OptionalCommand,
      test: OptionalCommand,
      e2e: OptionalCommand,
      lint: OptionalCommand,
    })
    .prefault({}),
  gates: z
    .object({
      validate: z
        .object({
          minScore: z.number().min(0).max(100).default(65),
          minEvidence: z.number().int().min(0).default(10),
          minCompetitors: z.number().int().min(0).default(5),
        })
        .prefault({}),
      design: z
        .object({ rubricMinPass: z.number().min(0).max(1).default(0.9) })
        .prefault({}),
      gap: z
        .object({
          minCoverage: z.number().min(0).max(1).default(0.95),
          scanDirs: z.array(z.string()).default(["src", "app", "lib", "packages"]),
        })
        .prefault({}),
    })
    .prefault({}),
  stages: z.object({ skip: z.array(z.string()).default([]) }).prefault({}),
});
export type ForgeConfig = z.infer<typeof ForgeConfig>;

export function loadConfig(root: string): ForgeConfig {
  const path = layout(root).config;
  if (!existsSync(path)) return ForgeConfig.parse({});
  const raw: unknown = parse(readFileSync(path, "utf8")) ?? {};
  const result = ForgeConfig.safeParse(raw);
  if (!result.success) throw new Error(`Invalid ${path}:\n${formatIssues(result.error)}`);
  return result.data;
}

export function defaultConfigYaml(project: string): string {
  return `# forge project configuration
project: ${JSON.stringify(project)}
platforms: [web]          # web | ios | android | desktop | api
packs: []                 # optional departments, e.g. [motion, mobile, growth]
autonomy: checkpoint      # auto | checkpoint (human approves key stages) | strict (every stage)
maxIterations: 3          # gate failures before forge escalates with a decision memo

# Commands used by the build and verify gates. Leave them empty until the app exists:
# forge fails a gate whose command is not configured rather than assuming it passed.
commands:
  build:
  test:
  e2e:
  lint:

gates:
  validate:
    minScore: 65          # weighted share of "yes" answers, 0-100
    minEvidence: 10       # distinct cited sources across criteria and competitors
    minCompetitors: 5
  design:
    rubricMinPass: 0.9    # share of design-critic rubric criteria that must pass
  gap:
    minCoverage: 0.95     # share of MVP story requirements traced to design, code and tests
    scanDirs: [src, app, lib, packages]

stages:
  skip: []                # stage ids to leave out of this project's pipeline
`;
}

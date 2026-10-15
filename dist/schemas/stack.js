import { z } from "zod";
/**
 * A stack pack (`stack-packs/<id>/pack.yaml`): how forge recognises a stack in a repo,
 * which gate commands it can run there (only when their prerequisites exist), how to
 * scaffold it with the official generator, and where its conventions/review lens live.
 */
const Names = z.array(z.string().min(1)).default([]);
/** Every listed prerequisite must hold in the stack's directory. */
export const StackRequirement = z
    .object({
    /** package.json script name. */
    script: z.string().min(1).optional(),
    /** npm or Python dependency name. */
    dep: z.string().min(1).optional(),
    /** Path relative to the stack directory. */
    file: z.string().min(1).optional(),
    /** Executable on PATH (e.g. a CLI installed outside the project). */
    bin: z.string().min(1).optional(),
})
    .strict();
export const StackCommand = z
    .object({
    /**
     * Shell command, with placeholders filled from the detected tooling:
     * `{run}` package script runner (`pnpm`, `npm run`, `yarn`, `bun run`),
     * `{exec}` package binary runner (`pnpm exec`, `npx`, `yarn`, `bunx`),
     * `{audit}` the package manager's audit of production dependencies at high severity
     *   (dev tooling never ships; audit it separately when you want to),
     * `{python}` the project's Python (`uv run python`, `poetry run python`, `.venv/bin/python`, `python3`).
     */
    run: z.string().min(1),
    requires: StackRequirement.default({}),
})
    .strict();
const CommandOptions = z.array(StackCommand).default([]);
export const COMMAND_KEYS = ["build", "test", "e2e", "lint", "audit"];
/** A place this stack can be deployed with its official CLI. Commands run in the stack directory. */
export const DeployTarget = z
    .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    /** CLI that must be on PATH. */
    bin: z.string().min(1),
    /** Exits 0 only when the CLI is logged in (never prompts). */
    auth: z.string().min(1),
    /** How to log in when `auth` fails. */
    login: z.string().min(1),
    /** Files that must exist first (e.g. fly.toml, eas.json), with how to create them. */
    requires: z.array(z.object({ file: z.string().min(1), create: z.string().min(1) }).strict()).default([]),
    /** Deploy commands; a target without `preview` only deploys to production. */
    preview: z.string().min(1).optional(),
    production: z.string().min(1),
    /** Regex that finds the deployed URL in the command's output (last match wins). */
    url: z.string().min(1).optional(),
    /** Header that lets the smoke test through deployment protection, from an env var. */
    bypass: z.object({ header: z.string().min(1), env: z.string().min(1) }).strict().optional(),
    rollback: z.string().min(1),
    docs: z.url(),
})
    .strict();
export const StackPack = z
    .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    summary: z.string().min(1),
    /** app = UI the user sees, service = API/backend, data = database/platform. */
    kind: z.enum(["app", "service", "data"]),
    platforms: z.array(z.enum(["web", "ios", "android", "desktop", "api"])).min(1),
    /** Task departments this stack serves (task briefs pick packs by dept). */
    depts: z.array(z.string().min(1)).min(1),
    language: z.enum(["typescript", "python", "sql", "dart", "swift", "kotlin"]),
    detect: z
        .object({
        /** Matches when any of these npm dependencies is declared. */
        packageDeps: Names,
        /** Matches when any of these Python dependencies is declared. */
        pythonDeps: Names,
        /** Matches when any of these files exists. */
        files: Names,
        /** …unless one of these npm dependencies is also declared (a more specific pack owns it). */
        unlessDeps: Names,
    })
        .strict()
        .prefault({}),
    /** Gate commands, keyed like forge.config.yaml `commands`; the first option whose prerequisites hold wins. */
    commands: z
        .object({ build: CommandOptions, test: CommandOptions, e2e: CommandOptions, lint: CommandOptions, audit: CommandOptions })
        .strict()
        .prefault({}),
    /** What to do when no option for a command is available yet. */
    fixes: z.partialRecord(z.enum(COMMAND_KEYS), z.string().min(1)).default({}),
    scaffold: z
        .object({
        /**
         * Official generator, run from the project root: `{dir}` target directory, `{pm}` package
         * manager, `{dlx}` one-off package runner (`pnpm dlx`, `npx`, `yarn dlx`, `bunx`).
         */
        command: z.string().min(1),
        docs: z.url(),
        /** Follow-up commands run inside the new directory. */
        then: Names,
    })
        .strict(),
    /** Which `forge design build` output the UI consumes. */
    tokens: z.enum(["css", "tailwind", "ts", "flutter", "swiftui", "compose", "none"]).default("none"),
    /** End-to-end / QA tool the qa-engineer uses for this stack. */
    qa: z.string().min(1),
    /** Where things go — surfaced in task briefs. */
    layout: z.record(z.string(), z.string()).default({}),
    docs: z.array(z.url()).default([]),
    deploy: z.array(DeployTarget).default([]),
})
    .strict();

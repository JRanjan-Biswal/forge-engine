import { z } from "zod";
export declare const ForgeConfig: z.ZodObject<{
    project: z.ZodDefault<z.ZodString>;
    platforms: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        android: "android";
        api: "api";
        desktop: "desktop";
        ios: "ios";
        web: "web";
    }>>>;
    packs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    stacks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        pack: z.ZodString;
        dir: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>>>;
    autonomy: z.ZodDefault<z.ZodEnum<{
        auto: "auto";
        checkpoint: "checkpoint";
        strict: "strict";
    }>>;
    maxIterations: z.ZodDefault<z.ZodNumber>;
    commands: z.ZodPrefault<z.ZodObject<{
        build: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
        test: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
        e2e: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
        lint: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
        audit: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
    }, z.core.$strip>>;
    gates: z.ZodPrefault<z.ZodObject<{
        validate: z.ZodPrefault<z.ZodObject<{
            minScore: z.ZodDefault<z.ZodNumber>;
            minEvidence: z.ZodDefault<z.ZodNumber>;
            minCompetitors: z.ZodDefault<z.ZodNumber>;
            requireEvidenceStore: z.ZodDefault<z.ZodBoolean>;
            minVerifiedShare: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        design: z.ZodPrefault<z.ZodObject<{
            rubricMinPass: z.ZodDefault<z.ZodNumber>;
            screenshots: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        qa: z.ZodPrefault<z.ZodObject<{
            minCoverage: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        gap: z.ZodPrefault<z.ZodObject<{
            minCoverage: z.ZodDefault<z.ZodNumber>;
            scanDirs: z.ZodDefault<z.ZodArray<z.ZodString>>;
            contractIgnore: z.ZodDefault<z.ZodArray<z.ZodString>>;
            parityExempt: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    security: z.ZodPrefault<z.ZodObject<{
        failOn: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            high: "high";
            low: "low";
            medium: "medium";
        }>>;
        url: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | undefined, string | null | undefined>>;
        ignore: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    deploy: z.ZodPrefault<z.ZodObject<{
        targets: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        healthPath: z.ZodDefault<z.ZodString>;
        e2e: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    stages: z.ZodPrefault<z.ZodObject<{
        skip: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    workers: z.ZodPrefault<z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        args: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    resources: z.ZodPrefault<z.ZodObject<{
        maxConcurrentCommands: z.ZodDefault<z.ZodNumber>;
        commandWaitMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ForgeConfig = z.infer<typeof ForgeConfig>;
export declare function loadConfig(root: string): ForgeConfig;
export declare function defaultConfigYaml(project: string): string;

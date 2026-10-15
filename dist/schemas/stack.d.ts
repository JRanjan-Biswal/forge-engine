import { z } from "zod";
/** Every listed prerequisite must hold in the stack's directory. */
export declare const StackRequirement: z.ZodObject<{
    script: z.ZodOptional<z.ZodString>;
    dep: z.ZodOptional<z.ZodString>;
    file: z.ZodOptional<z.ZodString>;
    bin: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type StackRequirement = z.infer<typeof StackRequirement>;
export declare const StackCommand: z.ZodObject<{
    run: z.ZodString;
    requires: z.ZodDefault<z.ZodObject<{
        script: z.ZodOptional<z.ZodString>;
        dep: z.ZodOptional<z.ZodString>;
        file: z.ZodOptional<z.ZodString>;
        bin: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type StackCommand = z.infer<typeof StackCommand>;
export declare const COMMAND_KEYS: readonly ["build", "test", "e2e", "lint", "audit"];
export type CommandKey = (typeof COMMAND_KEYS)[number];
/** A place this stack can be deployed with its official CLI. Commands run in the stack directory. */
export declare const DeployTarget: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    bin: z.ZodString;
    auth: z.ZodString;
    login: z.ZodString;
    requires: z.ZodDefault<z.ZodArray<z.ZodObject<{
        file: z.ZodString;
        create: z.ZodString;
    }, z.core.$strict>>>;
    preview: z.ZodOptional<z.ZodString>;
    production: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    bypass: z.ZodOptional<z.ZodObject<{
        header: z.ZodString;
        env: z.ZodString;
    }, z.core.$strict>>;
    rollback: z.ZodString;
    docs: z.ZodURL;
}, z.core.$strict>;
export type DeployTarget = z.infer<typeof DeployTarget>;
export declare const StackPack: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    summary: z.ZodString;
    kind: z.ZodEnum<{
        app: "app";
        data: "data";
        service: "service";
    }>;
    platforms: z.ZodArray<z.ZodEnum<{
        android: "android";
        api: "api";
        desktop: "desktop";
        ios: "ios";
        web: "web";
    }>>;
    depts: z.ZodArray<z.ZodString>;
    language: z.ZodEnum<{
        dart: "dart";
        kotlin: "kotlin";
        python: "python";
        sql: "sql";
        swift: "swift";
        typescript: "typescript";
    }>;
    detect: z.ZodPrefault<z.ZodObject<{
        packageDeps: z.ZodDefault<z.ZodArray<z.ZodString>>;
        pythonDeps: z.ZodDefault<z.ZodArray<z.ZodString>>;
        files: z.ZodDefault<z.ZodArray<z.ZodString>>;
        unlessDeps: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    commands: z.ZodPrefault<z.ZodObject<{
        build: z.ZodDefault<z.ZodArray<z.ZodObject<{
            run: z.ZodString;
            requires: z.ZodDefault<z.ZodObject<{
                script: z.ZodOptional<z.ZodString>;
                dep: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                bin: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        test: z.ZodDefault<z.ZodArray<z.ZodObject<{
            run: z.ZodString;
            requires: z.ZodDefault<z.ZodObject<{
                script: z.ZodOptional<z.ZodString>;
                dep: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                bin: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        e2e: z.ZodDefault<z.ZodArray<z.ZodObject<{
            run: z.ZodString;
            requires: z.ZodDefault<z.ZodObject<{
                script: z.ZodOptional<z.ZodString>;
                dep: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                bin: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        lint: z.ZodDefault<z.ZodArray<z.ZodObject<{
            run: z.ZodString;
            requires: z.ZodDefault<z.ZodObject<{
                script: z.ZodOptional<z.ZodString>;
                dep: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                bin: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        audit: z.ZodDefault<z.ZodArray<z.ZodObject<{
            run: z.ZodString;
            requires: z.ZodDefault<z.ZodObject<{
                script: z.ZodOptional<z.ZodString>;
                dep: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                bin: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    fixes: z.ZodDefault<z.ZodRecord<z.ZodEnum<{
        audit: "audit";
        build: "build";
        e2e: "e2e";
        lint: "lint";
        test: "test";
    }> & z.core.$partial, z.ZodString>>;
    scaffold: z.ZodObject<{
        command: z.ZodString;
        docs: z.ZodURL;
        then: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    tokens: z.ZodDefault<z.ZodEnum<{
        compose: "compose";
        css: "css";
        flutter: "flutter";
        none: "none";
        swiftui: "swiftui";
        tailwind: "tailwind";
        ts: "ts";
    }>>;
    qa: z.ZodString;
    layout: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    docs: z.ZodDefault<z.ZodArray<z.ZodURL>>;
    deploy: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        bin: z.ZodString;
        auth: z.ZodString;
        login: z.ZodString;
        requires: z.ZodDefault<z.ZodArray<z.ZodObject<{
            file: z.ZodString;
            create: z.ZodString;
        }, z.core.$strict>>>;
        preview: z.ZodOptional<z.ZodString>;
        production: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        bypass: z.ZodOptional<z.ZodObject<{
            header: z.ZodString;
            env: z.ZodString;
        }, z.core.$strict>>;
        rollback: z.ZodString;
        docs: z.ZodURL;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type StackPack = z.infer<typeof StackPack>;
export type StackPackInput = z.input<typeof StackPack>;

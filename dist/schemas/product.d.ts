import { z } from "zod";
export declare const Surface: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        endpoint: "endpoint";
        page: "page";
    }>;
    route: z.ZodString;
    method: z.ZodOptional<z.ZodString>;
    file: z.ZodString;
    framework: z.ZodString;
    graphifyNode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Surface = z.infer<typeof Surface>;
export declare const ProductMap: z.ZodObject<{
    version: z.ZodLiteral<1>;
    generatedAt: z.ZodISODateTime;
    fingerprint: z.ZodObject<{
        files: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strip>;
    frameworks: z.ZodArray<z.ZodString>;
    surfaces: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            endpoint: "endpoint";
            page: "page";
        }>;
        route: z.ZodString;
        method: z.ZodOptional<z.ZodString>;
        file: z.ZodString;
        framework: z.ZodString;
        graphifyNode: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    calls: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        literal: z.ZodString;
    }, z.core.$strip>>;
    docs: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        title: z.ZodString;
        bytes: z.ZodNumber;
    }, z.core.$strip>>;
    graph: z.ZodObject<{
        status: z.ZodEnum<{
            failed: "failed";
            skipped: "skipped";
            unavailable: "unavailable";
            unchanged: "unchanged";
            updated: "updated";
        }>;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ProductMap = z.infer<typeof ProductMap>;
export declare const FeatureStatus: z.ZodEnum<{
    broken: "broken";
    live: "live";
    partial: "partial";
    placeholder: "placeholder";
    unknown: "unknown";
}>;
export declare const ProductModel: z.ZodObject<{
    summary: z.ZodString;
    stage: z.ZodEnum<{
        growth: "growth";
        idea: "idea";
        pivot: "pivot";
        "pmf-search": "pmf-search";
        scale: "scale";
        unknown: "unknown";
        validation: "validation";
    }>;
    personas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        jobs: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    features: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        surfaces: z.ZodDefault<z.ZodArray<z.ZodString>>;
        files: z.ZodDefault<z.ZodArray<z.ZodString>>;
        status: z.ZodEnum<{
            broken: "broken";
            live: "live";
            partial: "partial";
            placeholder: "placeholder";
            unknown: "unknown";
        }>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodString>>;
        personas: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    ignoredSurfaces: z.ZodDefault<z.ZodArray<z.ZodObject<{
        surface: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>>>;
    gaps: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        severity: z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>;
        feature: z.ZodOptional<z.ZodString>;
        surface: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    facts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    assumptions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    openQuestions: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ProductModel = z.infer<typeof ProductModel>;
export declare const AtomStatus: z.ZodEnum<{
    dead: "dead";
    live: "live";
    "missing-join": "missing-join";
    "permission-wrong": "permission-wrong";
    placeholder: "placeholder";
    unknown: "unknown";
}>;
export declare const AtomBreak: z.ZodEnum<{
    "dead-control": "dead-control";
    "dropped-field": "dropped-field";
    "mapper-lie": "mapper-lie";
    "mock-leftover": "mock-leftover";
    "orphan-url": "orphan-url";
    "permission-lie": "permission-lie";
    "placeholder-copy": "placeholder-copy";
    unconnected: "unconnected";
}>;
export declare const PageAudit: z.ZodObject<{
    page: z.ZodString;
    surface: z.ZodOptional<z.ZodString>;
    who: z.ZodString;
    job: z.ZodString;
    trust: z.ZodString;
    antiGoal: z.ZodString;
    atoms: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        class: z.ZodEnum<{
            action: "action";
            chrome: "chrome";
            content: "content";
            conversation: "conversation";
            feedback: "feedback";
            input: "input";
            media: "media";
            navigation: "navigation";
            people: "people";
            permission: "permission";
            state: "state";
        }>;
        type: z.ZodEnum<{
            button: "button";
            card: "card";
            empty: "empty";
            input: "input";
            link: "link";
            media: "media";
            other: "other";
            tab: "tab";
            text: "text";
        }>;
        job: z.ZodString;
        data: z.ZodString;
        clickPath: z.ZodString;
        status: z.ZodEnum<{
            dead: "dead";
            live: "live";
            "missing-join": "missing-join";
            "permission-wrong": "permission-wrong";
            placeholder: "placeholder";
            unknown: "unknown";
        }>;
        break: z.ZodOptional<z.ZodEnum<{
            "dead-control": "dead-control";
            "dropped-field": "dropped-field";
            "mapper-lie": "mapper-lie";
            "mock-leftover": "mock-leftover";
            "orphan-url": "orphan-url";
            "permission-lie": "permission-lie";
            "placeholder-copy": "placeholder-copy";
            unconnected: "unconnected";
        }>>;
        trace: z.ZodOptional<z.ZodString>;
        fix: z.ZodOptional<z.ZodString>;
        must: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    connections: z.ZodDefault<z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        kind: z.ZodEnum<{
            "already-exists": "already-exists";
            idea: "idea";
            "small-join": "small-join";
        }>;
    }, z.core.$strip>>>;
    ideas: z.ZodDefault<z.ZodArray<z.ZodObject<{
        idea: z.ZodString;
        why: z.ZodString;
        effort: z.ZodEnum<{
            L: "L";
            M: "M";
            S: "S";
        }>;
    }, z.core.$strip>>>;
    robustness: z.ZodDefault<z.ZodObject<{
        empty: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        error: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        loading: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        permissions: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        stale: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        smallScreen: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        media: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
        destructive: z.ZodOptional<z.ZodEnum<{
            gap: "gap";
            "n/a": "n/a";
            ok: "ok";
        }>>;
    }, z.core.$strip>>;
    proof: z.ZodDefault<z.ZodArray<z.ZodString>>;
    auditedAt: z.ZodISODateTime;
}, z.core.$strip>;
export type PageAudit = z.infer<typeof PageAudit>;

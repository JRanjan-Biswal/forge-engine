import { z } from "zod";
export declare const BrainstormIdea: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    oneLiner: z.ZodString;
    angle: z.ZodOptional<z.ZodString>;
    technique: z.ZodOptional<z.ZodString>;
    novelty: z.ZodOptional<z.ZodNumber>;
    cluster: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const Brainstorm: z.ZodObject<{
    theme: z.ZodOptional<z.ZodString>;
    ideas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        oneLiner: z.ZodString;
        angle: z.ZodOptional<z.ZodString>;
        technique: z.ZodOptional<z.ZodString>;
        novelty: z.ZodOptional<z.ZodNumber>;
        cluster: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    shortlist: z.ZodDefault<z.ZodArray<z.ZodString>>;
    chosenId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Brainstorm = z.infer<typeof Brainstorm>;
export declare const Vision: z.ZodObject<{
    northStar: z.ZodString;
    problem: z.ZodString;
    audience: z.ZodString;
    principles: z.ZodArray<z.ZodString>;
    antiGoals: z.ZodArray<z.ZodString>;
    futurePicture: z.ZodOptional<z.ZodString>;
    narrative: z.ZodOptional<z.ZodString>;
    successMetrics: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        target: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Vision = z.infer<typeof Vision>;
export declare const Answer: z.ZodEnum<{
    no: "no";
    unknown: "unknown";
    yes: "yes";
}>;
export declare const ValidationCriterion: z.ZodObject<{
    id: z.ZodString;
    group: z.ZodEnum<{
        competition: "competition";
        differentiation: "differentiation";
        distribution: "distribution";
        feasibility: "feasibility";
        market: "market";
        monetization: "monetization";
        problem: "problem";
        risk: "risk";
    }>;
    question: z.ZodString;
    weight: z.ZodDefault<z.ZodNumber>;
    answer: z.ZodEnum<{
        no: "no";
        unknown: "unknown";
        yes: "yes";
    }>;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        url: z.ZodURL;
        quote: z.ZodString;
        source: z.ZodOptional<z.ZodString>;
        retrievedAt: z.ZodISODateTime;
    }, z.core.$strip>>>;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const Validation: z.ZodObject<{
    idea: z.ZodString;
    criteria: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        group: z.ZodEnum<{
            competition: "competition";
            differentiation: "differentiation";
            distribution: "distribution";
            feasibility: "feasibility";
            market: "market";
            monetization: "monetization";
            problem: "problem";
            risk: "risk";
        }>;
        question: z.ZodString;
        weight: z.ZodDefault<z.ZodNumber>;
        answer: z.ZodEnum<{
            no: "no";
            unknown: "unknown";
            yes: "yes";
        }>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            url: z.ZodURL;
            quote: z.ZodString;
            source: z.ZodOptional<z.ZodString>;
            retrievedAt: z.ZodISODateTime;
        }, z.core.$strip>>>;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    score: z.ZodNumber;
    verdict: z.ZodEnum<{
        go: "go";
        kill: "kill";
        "needs-experiment": "needs-experiment";
        pivot: "pivot";
    }>;
    risks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        risk: z.ZodString;
        severity: z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>;
    }, z.core.$strip>>>;
    experiments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        cost: z.ZodOptional<z.ZodString>;
        signal: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Validation = z.infer<typeof Validation>;
export declare const Competitor: z.ZodObject<{
    name: z.ZodString;
    url: z.ZodOptional<z.ZodURL>;
    segment: z.ZodEnum<{
        direct: "direct";
        indirect: "indirect";
        substitute: "substitute";
    }>;
    pricing: z.ZodOptional<z.ZodString>;
    features: z.ZodDefault<z.ZodArray<z.ZodString>>;
    strengths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    weaknesses: z.ZodDefault<z.ZodArray<z.ZodString>>;
    reviewComplaints: z.ZodDefault<z.ZodArray<z.ZodObject<{
        source: z.ZodURL;
        quote: z.ZodString;
    }, z.core.$strip>>>;
    gapOpportunities: z.ZodDefault<z.ZodArray<z.ZodString>>;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        url: z.ZodURL;
        quote: z.ZodString;
        source: z.ZodOptional<z.ZodString>;
        retrievedAt: z.ZodISODateTime;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const Competitors: z.ZodObject<{
    competitors: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodOptional<z.ZodURL>;
        segment: z.ZodEnum<{
            direct: "direct";
            indirect: "indirect";
            substitute: "substitute";
        }>;
        pricing: z.ZodOptional<z.ZodString>;
        features: z.ZodDefault<z.ZodArray<z.ZodString>>;
        strengths: z.ZodDefault<z.ZodArray<z.ZodString>>;
        weaknesses: z.ZodDefault<z.ZodArray<z.ZodString>>;
        reviewComplaints: z.ZodDefault<z.ZodArray<z.ZodObject<{
            source: z.ZodURL;
            quote: z.ZodString;
        }, z.core.$strip>>>;
        gapOpportunities: z.ZodDefault<z.ZodArray<z.ZodString>>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            url: z.ZodURL;
            quote: z.ZodString;
            source: z.ZodOptional<z.ZodString>;
            retrievedAt: z.ZodISODateTime;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Competitors = z.infer<typeof Competitors>;
export declare const Personas: z.ZodObject<{
    personas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        jobsToBeDone: z.ZodArray<z.ZodString>;
        pains: z.ZodDefault<z.ZodArray<z.ZodString>>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            url: z.ZodURL;
            quote: z.ZodString;
            source: z.ZodOptional<z.ZodString>;
            retrievedAt: z.ZodISODateTime;
        }, z.core.$strip>>>;
        synthetic: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const Acceptance: z.ZodObject<{
    given: z.ZodString;
    when: z.ZodString;
    then: z.ZodString;
}, z.core.$strip>;
export declare const Story: z.ZodObject<{
    id: z.ZodString;
    as: z.ZodString;
    iWant: z.ZodString;
    soThat: z.ZodString;
    priority: z.ZodEnum<{
        could: "could";
        must: "must";
        should: "should";
        wont: "wont";
    }>;
    mvp: z.ZodDefault<z.ZodBoolean>;
    acceptance: z.ZodDefault<z.ZodArray<z.ZodObject<{
        given: z.ZodString;
        when: z.ZodString;
        then: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const Prd: z.ZodObject<{
    title: z.ZodString;
    goals: z.ZodArray<z.ZodString>;
    nonGoals: z.ZodDefault<z.ZodArray<z.ZodString>>;
    stories: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        as: z.ZodString;
        iWant: z.ZodString;
        soThat: z.ZodString;
        priority: z.ZodEnum<{
            could: "could";
            must: "must";
            should: "should";
            wont: "wont";
        }>;
        mvp: z.ZodDefault<z.ZodBoolean>;
        acceptance: z.ZodDefault<z.ZodArray<z.ZodObject<{
            given: z.ZodString;
            when: z.ZodString;
            then: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    metrics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        definition: z.ZodString;
        target: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    openQuestions: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type Prd = z.infer<typeof Prd>;
export declare const UiState: z.ZodEnum<{
    empty: "empty";
    error: "error";
    loading: "loading";
    success: "success";
}>;
export declare const Platform: z.ZodEnum<{
    android: "android";
    ios: "ios";
    web: "web";
}>;
export declare const Screen: z.ZodObject<{
    id: z.ZodString;
    storyIds: z.ZodArray<z.ZodString>;
    route: z.ZodString;
    platform: z.ZodEnum<{
        android: "android";
        ios: "ios";
        web: "web";
    }>;
    components: z.ZodDefault<z.ZodArray<z.ZodString>>;
    states: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        empty: "empty";
        error: "error";
        loading: "loading";
        success: "success";
    }>>>;
    stateless: z.ZodDefault<z.ZodBoolean>;
    copyKeys: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const Screens: z.ZodObject<{
    screens: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        storyIds: z.ZodArray<z.ZodString>;
        route: z.ZodString;
        platform: z.ZodEnum<{
            android: "android";
            ios: "ios";
            web: "web";
        }>;
        components: z.ZodDefault<z.ZodArray<z.ZodString>>;
        states: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            empty: "empty";
            error: "error";
            loading: "loading";
            success: "success";
        }>>>;
        stateless: z.ZodDefault<z.ZodBoolean>;
        copyKeys: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Screens = z.infer<typeof Screens>;
export declare const MotionSpec: z.ZodObject<{
    id: z.ZodString;
    storyIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    trigger: z.ZodString;
    targets: z.ZodArray<z.ZodString>;
    kind: z.ZodEnum<{
        keyframes: "keyframes";
        lottie: "lottie";
        rive: "rive";
        route: "route";
        scroll: "scroll";
        "shared-element": "shared-element";
        spring: "spring";
        transition: "transition";
    }>;
    durationToken: z.ZodOptional<z.ZodString>;
    easingToken: z.ZodOptional<z.ZodString>;
    springToken: z.ZodOptional<z.ZodString>;
    keyframes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>>;
    reducedMotion: z.ZodOptional<z.ZodObject<{
        kind: z.ZodEnum<{
            fade: "fade";
            instant: "instant";
            none: "none";
        }>;
        durationToken: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    platforms: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        android: "android";
        ios: "ios";
        web: "web";
    }>>>;
}, z.core.$strip>;
export declare const Motion: z.ZodObject<{
    specs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        storyIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
        trigger: z.ZodString;
        targets: z.ZodArray<z.ZodString>;
        kind: z.ZodEnum<{
            keyframes: "keyframes";
            lottie: "lottie";
            rive: "rive";
            route: "route";
            scroll: "scroll";
            "shared-element": "shared-element";
            spring: "spring";
            transition: "transition";
        }>;
        durationToken: z.ZodOptional<z.ZodString>;
        easingToken: z.ZodOptional<z.ZodString>;
        springToken: z.ZodOptional<z.ZodString>;
        keyframes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>>;
        reducedMotion: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                fade: "fade";
                instant: "instant";
                none: "none";
            }>;
            durationToken: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        platforms: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            android: "android";
            ios: "ios";
            web: "web";
        }>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Motion = z.infer<typeof Motion>;
export declare const Task: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    storyIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    dept: z.ZodString;
    agent: z.ZodOptional<z.ZodString>;
    deps: z.ZodDefault<z.ZodArray<z.ZodString>>;
    files: z.ZodDefault<z.ZodArray<z.ZodString>>;
    acceptance: z.ZodDefault<z.ZodArray<z.ZodString>>;
    estimate: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        blocked: "blocked";
        doing: "doing";
        done: "done";
        todo: "todo";
    }>>;
}, z.core.$strip>;
export declare const Tasks: z.ZodObject<{
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        storyIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
        dept: z.ZodString;
        agent: z.ZodOptional<z.ZodString>;
        deps: z.ZodDefault<z.ZodArray<z.ZodString>>;
        files: z.ZodDefault<z.ZodArray<z.ZodString>>;
        acceptance: z.ZodDefault<z.ZodArray<z.ZodString>>;
        estimate: z.ZodOptional<z.ZodString>;
        status: z.ZodDefault<z.ZodEnum<{
            blocked: "blocked";
            doing: "doing";
            done: "done";
            todo: "todo";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Tasks = z.infer<typeof Tasks>;
export declare const Finding: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<{
        critical: "critical";
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    category: z.ZodString;
    file: z.ZodString;
    line: z.ZodOptional<z.ZodNumber>;
    claim: z.ZodString;
    evidence: z.ZodOptional<z.ZodString>;
    suggestedFix: z.ZodOptional<z.ZodString>;
    verifiedBy: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        "false-positive": "false-positive";
        fixed: "fixed";
        open: "open";
        wontfix: "wontfix";
    }>>;
}, z.core.$strip>;
export declare const Reviews: z.ZodObject<{
    findings: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<{
            critical: "critical";
            high: "high";
            low: "low";
            medium: "medium";
        }>;
        category: z.ZodString;
        file: z.ZodString;
        line: z.ZodOptional<z.ZodNumber>;
        claim: z.ZodString;
        evidence: z.ZodOptional<z.ZodString>;
        suggestedFix: z.ZodOptional<z.ZodString>;
        verifiedBy: z.ZodOptional<z.ZodString>;
        status: z.ZodDefault<z.ZodEnum<{
            "false-positive": "false-positive";
            fixed: "fixed";
            open: "open";
            wontfix: "wontfix";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Reviews = z.infer<typeof Reviews>;
export declare const TraceNodeType: z.ZodEnum<{
    code: "code";
    component: "component";
    endpoint: "endpoint";
    motion: "motion";
    release: "release";
    screen: "screen";
    story: "story";
    test: "test";
    vision: "vision";
}>;
export declare const TraceEdgeType: z.ZodEnum<{
    animatedBy: "animatedBy";
    calls: "calls";
    designedBy: "designedBy";
    implementedBy: "implementedBy";
    releasedIn: "releasedIn";
    uses: "uses";
    verifiedBy: "verifiedBy";
}>;
export declare const Trace: z.ZodObject<{
    nodes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            code: "code";
            component: "component";
            endpoint: "endpoint";
            motion: "motion";
            release: "release";
            screen: "screen";
            story: "story";
            test: "test";
            vision: "vision";
        }>;
        label: z.ZodOptional<z.ZodString>;
        graphifyNode: z.ZodOptional<z.ZodString>;
        origin: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    edges: z.ZodDefault<z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        type: z.ZodEnum<{
            animatedBy: "animatedBy";
            calls: "calls";
            designedBy: "designedBy";
            implementedBy: "implementedBy";
            releasedIn: "releasedIn";
            uses: "uses";
            verifiedBy: "verifiedBy";
        }>;
        origin: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Trace = z.infer<typeof Trace>;
export declare const Release: z.ZodObject<{
    version: z.ZodString;
    commit: z.ZodOptional<z.ZodString>;
    env: z.ZodString;
    url: z.ZodOptional<z.ZodURL>;
    at: z.ZodISODateTime;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        pass: z.ZodBoolean;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    rollback: z.ZodString;
    target: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<{
        agent: "agent";
        "forge-deploy": "forge-deploy";
    }>>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Release = z.infer<typeof Release>;
/** Written by a judge agent to .forge/gates/<stage>.rubric.json; read by rubric checks. */
export declare const RubricResult: z.ZodObject<{
    judge: z.ZodOptional<z.ZodString>;
    producer: z.ZodOptional<z.ZodString>;
    criteria: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        question: z.ZodString;
        pass: z.ZodBoolean;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RubricResult = z.infer<typeof RubricResult>;

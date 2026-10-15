#!/usr/bin/env node
// forge local acceptance test — free and deterministic (no LLM calls).
// Usage (from the open-source folder):  node e2e/run.mjs
// Writes e2e/runs/<timestamp>-local/REPORT.md and e2e/LATEST-local.md.
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CLI, E2E, FORGE, Suite, forgeCli, makeRunDir, pidAlive, pruneRuns, startEvidenceServer, readJson, sh, shAsync, tail, writeJson, writeText } from "./lib.mjs";

const suite = new Suite("local acceptance — CLI · 14-stage pipeline · memory · graphify · robustness · MCP · schemas · packaging · process hygiene");
pruneRuns(6);
const RUN = makeRunDir("local");
const HOME = join(RUN, "forge-home"); // isolates ~/.forge
const ENV = { FORGE_HOME: HOME };
const forge = forgeCli(ENV);
const TMP = join(RUN, "tmp");
const json = (r) => {
  try {
    return JSON.parse(r.out);
  } catch {
    return undefined;
  }
};
const failing = (gate) => (gate?.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
const skipped = (gate) => (gate?.checks ?? []).filter((c) => c.status === "skip").map((c) => c.id);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const writeTmp = (name, text) => {
  const file = join(TMP, name);
  writeText(file, text);
  return file;
};

// Synthetic fixture evidence — exercises the gate logic, not real market research.
const AT = "2026-10-14T00:00:00.000Z";
// A local server plays "the web": fixture pages contain the quotes, so evidence is really
// verified through forge's evidence store — offline. Closed before the report is written.
const evidenceServer = await startEvidenceServer();
const EV_BASE = evidenceServer.base;
const ev = (i) => ({ url: `${EV_BASE}/e2e-source-${i}`, quote: `synthetic fixture quote ${i}`, source: "e2e fixture", retrievedAt: AT });
const review = (i) => ({ source: `${EV_BASE}/e2e-review-${i}`, quote: "too many notifications" });

// ── 0 ────────────────────────────────────────────────────────────────────────
suite.begin("0. Build & unit tests");
let r = sh("pnpm", ["build"], { cwd: FORGE });
suite.check("forge builds (tsc)", r.code === 0, tail(r.all));
r = sh("pnpm", ["test"], { cwd: FORGE });
suite.check("forge unit tests pass (vitest)", r.code === 0, tail(r.all, 6));
const VERSION = readJson(join(FORGE, "package.json")).version;

// ── 1 ────────────────────────────────────────────────────────────────────────
suite.begin("1. Packaging: npm pack → npm install → run the binaries");
await suite.guard("packaging", async () => {
  const packDir = join(RUN, "pack");
  mkdirSync(packDir, { recursive: true });
  const pack = sh("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: FORGE });
  suite.check("npm pack succeeds", pack.code === 0, tail(pack.all));
  const info = JSON.parse(pack.out)[0];
  const files = info.files.map((f) => f.path);
  for (const file of [
    "dist/cli.js",
    "dist/mcp/server.js",
    "agents/conductor.md",
    "commands/forge.md",
    "rules/no-fake-data.md",
    "rules/process-lifecycle.md",
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "schemas/validation.schema.json",
    "schemas/evidence-store.schema.json",
    "skills/validate-idea/SKILL.md",
    "rubrics/validation.md",
    "agents/validation-scorer.md",
    "commands/validate.md",
    "hooks/hooks.json",
    "skills/pro-page-complete/SKILL.md",
    "skills/design-system/SKILL.md",
    "agents/web-animation-developer.md",
    "README.md",
    "LICENSE",
  ]) {
    suite.check(`tarball contains ${file}`, files.includes(file));
  }
  const leaked = files.filter((f) => f.startsWith("src/") || f.startsWith("test/") || f.startsWith("node_modules/"));
  suite.check("tarball excludes src/, test/ and node_modules/", leaked.length === 0, leaked.join(", "));
  suite.note("tarball", `${info.filename} · ${files.length} files · ${Math.round(info.size / 1024)} KB packed`);

  const prefix = join(RUN, "install");
  const install = sh("npm", ["install", "--prefix", prefix, join(packDir, info.filename), "--no-audit", "--no-fund", "--loglevel=error"]);
  suite.check("tarball installs with npm (dependencies resolve)", install.code === 0, tail(install.all));
  for (const bin of ["forge", "forge-engine"]) {
    const v = sh(join(prefix, "node_modules", ".bin", bin), ["--version"]);
    suite.check(`installed \`${bin}\` binary runs and reports ${VERSION}`, v.code === 0 && v.out.trim() === VERSION, v.all);
  }
});

// ── 2 ────────────────────────────────────────────────────────────────────────
suite.begin("2. Full 14-stage pipeline on a real app (CLI)");
const P = join(RUN, "habit-coach");
cpSync(join(E2E, "fixtures", "app"), P, { recursive: true });
const put = (name, data) => {
  const ext = typeof data === "string" ? "txt" : "json";
  const file = writeTmp(`${name}-${Math.random().toString(36).slice(2, 8)}.${ext}`, typeof data === "string" ? data : JSON.stringify(data));
  const res = forge(P, "artifact", "write", name, "--file", file);
  if (res.code !== 0) throw new Error(`artifact write ${name} failed: ${res.all}`);
};
const editConfig = (dir, edit) => {
  const file = join(dir, "forge.config.yaml");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
};
const setCommand = (name, command) =>
  editConfig(P, (text) => text.replace(new RegExp(`^  ${name}:.*$`, "m"), `  ${name}: ${JSON.stringify(command)}`));
const complete = (dir, id) => {
  const res = forge(dir, "complete", id, "--json");
  return { res, gate: json(res) };
};

r = forge(P, "init", "--name", "habit-coach");
suite.check("init creates forge.config.yaml and .forge/", r.code === 0 && existsSync(join(P, ".forge", "state.json")), r.all);
editConfig(P, (text) => text.replace("packs: []", "packs: [motion, growth]"));
const stageList = json(forge(P, "stages", "--json"));
suite.check("all 14 stages enabled with the motion + growth packs", stageList?.length === 14, stageList?.map((s) => s.id).join(", "));

/** Real fix loop: assert an intermediate gate run fails on exactly `expected`. */
function expectFail(id, expected, label) {
  const { res, gate } = complete(P, id);
  const got = failing(gate).filter((x) => x !== "human-approval");
  suite.check(`${id}: ${label} → caught by ${expected.join(", ")}`, res.code === 1 && sameSet(got, expected), `got: ${got.join(", ")}`);
  return gate;
}

async function stage(id, { initial, produce, checkpoint = false }) {
  await suite.guard(`${id}: stage flow`, async () => {
    const start = forge(P, "start", id);
    suite.check(`${id}: start`, start.code === 0, start.all);
    let { res, gate } = complete(P, id);
    const first = failing(gate);
    suite.check(
      `${id}: gate fails before outputs exist → ${first.join(", ")}`,
      res.code === 1 && initial.every((x) => first.includes(x)),
      `expected ⊇ ${initial.join(", ")}; got ${first.join(", ")}`,
    );
    await produce();
    ({ res, gate } = complete(P, id));
    if (checkpoint) {
      suite.check(`${id}: only human approval outstanding`, sameSet(failing(gate), ["human-approval"]), failing(gate).join(", "));
      forge(P, "approve", id, "--note", "approved by the e2e harness");
      ({ res, gate } = complete(P, id));
    }
    suite.check(`${id}: gate passes (run ${gate?.run})`, res.code === 0 && gate?.passed === true, `${failing(gate).join(", ")} ${res.err}`);
  });
}

await stage("brainstorm", {
  initial: ["brainstorm-valid", "brainstorm-chosen"],
  produce: () => {
    const ideas = [
      { id: "I-1", title: "Habit coach", oneLiner: "Streak-based habit coach for busy professionals", technique: "jobs-to-be-done" },
      { id: "I-2", title: "Focus rooms", oneLiner: "Co-working focus sessions with friends", technique: "analogy" },
      { id: "I-3", title: "Sleep-debt tracker", oneLiner: "A weekly sleep-debt budget", technique: "inversion" },
    ];
    put("brainstorm", { theme: "personal habits", ideas });
    expectFail("brainstorm", ["brainstorm-chosen"], "no idea chosen");
    put("brainstorm", { theme: "personal habits", ideas, shortlist: ["I-1", "I-3"], chosenId: "I-1" });
  },
});

const visionDoc = (antiGoals) => ({
  northStar: "Weekly users with a 3+ day streak",
  problem: "Busy people drop new habits within a week",
  audience: "Busy professionals",
  principles: ["Tiny daily steps", "No guilt"],
  antiGoals,
  successMetrics: [{ name: "Week-1 retention", target: "40%" }],
});
await stage("vision", {
  checkpoint: true,
  initial: ["vision-valid", "anti-goals"],
  produce: () => {
    put("vision", visionDoc(["No social feed", "No ads"]));
    expectFail("vision", ["anti-goals"], "only 2 anti-goals");
    put("vision", visionDoc(["No social feed", "No ads", "No gamified punishment"]));
  },
});

const groups = ["problem", "problem", "market", "competition", "differentiation", "feasibility", "distribution", "monetization", "problem", "market"];
const criteria = (planted) => [
  ...groups.map((group, i) => ({
    id: `C-${i + 1}`,
    group,
    question: `Fixture criterion ${i + 1}?`,
    answer: "yes",
    evidence: planted && i === 0 ? [] : [ev(i + 1)],
  })),
  { id: "C-11", group: "risk", question: "No platform risk?", answer: "no", evidence: [ev(11)] },
  { id: "C-12", group: "monetization", question: "Proven willingness to pay?", answer: "unknown" },
];
await stage("validate", {
  checkpoint: true,
  initial: ["validation-valid", "competitors-valid"],
  produce: () => {
    const cited = [
      ...Array.from({ length: 11 }, (_, i) => ev(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => ev(20 + i)),
      ...Array.from({ length: 5 }, (_, i) => ({ url: review(i).source, quote: review(i).quote })),
    ];
    for (const item of cited) {
      const saved = forge(P, "evidence", "save", "--url", item.url, "--quote", item.quote);
      if (saved.code !== 0) throw new Error(saved.all);
    }
    const stored = json(forge(P, "evidence", "list", "--json")) ?? [];
    suite.check("validate: 21 cited quotes saved and verified against their pages", stored.length === 21 && stored.every((e) => e.verification.status === "verified"), JSON.stringify(stored.map((e) => e.verification.status)));
    put("competitors", {
      competitors: Array.from({ length: 5 }, (_, i) => ({
        name: `Fixture competitor ${i + 1}`,
        segment: i < 3 ? "direct" : "indirect",
        features: ["streaks"],
        reviewComplaints: [review(i)],
        gapOpportunities: ["gentle reminders"],
        evidence: [ev(20 + i)],
      })),
    });
    put("validation", { idea: "Streak-based habit coach", criteria: criteria(true), score: 70, verdict: "go" });
    expectFail("validate", ["validation-evidenceRule", "validation-scoreConsistent"], "unsupported 'yes' + wrong score");
    put("validation", {
      idea: "Streak-based habit coach",
      criteria: criteria(false),
      score: 91,
      verdict: "go",
      experiments: [{ name: "Landing page + waitlist", signal: "≥ 5% sign-up" }],
    });
  },
});

const story = (id, iWant, mvp, priority, withAcceptance = true) => ({
  id,
  as: "a busy professional",
  iWant,
  soThat: "I keep my habits",
  priority,
  mvp,
  acceptance: withAcceptance ? [{ given: "a habit", when: `I ${iWant}`, then: "it is saved" }] : [],
});
await stage("spec", {
  initial: ["prd-valid"],
  produce: () => {
    const prdDoc = (complete) => ({
      title: "Habit coach MVP",
      goals: ["Users keep a 3-day streak"],
      nonGoals: ["Social feed"],
      stories: [
        story("S-1", "check in to a habit", true, "must"),
        story("S-2", "see my streaks", true, "must", complete),
        story("S-3", "get gentle reminders", false, "could"),
      ],
      metrics: [{ name: "Week-1 retention", definition: "share of sign-ups active in week 2", target: "40%" }],
    });
    put("prd", prdDoc(false));
    expectFail("spec", ["prd-acceptance"], "story S-2 has no acceptance criteria");
    put("prd", prdDoc(true));
  },
});

await stage("design", {
  checkpoint: true,
  initial: ["screens-valid", "design-tokens", "design-critique"],
  produce: () => {
    writeJson(join(P, "design/tokens/primitive.tokens.json"), {
      color: { indigo: { 500: { $type: "color", $value: "#5B5BD6" } } },
      space: { 4: { $type: "dimension", $value: "16px" } },
    });
    writeJson(join(P, "design/tokens/semantic.tokens.json"), {
      color: { $type: "color", accent: { default: { $value: "{color.indigo.500}" } }, text: { default: { $value: "#1A1A2E" } }, bg: { default: { $value: "#FFFFFF" } } },
    });
    writeJson(join(P, "design/contrast.json"), { pairs: [{ fg: "color.text.default", bg: "color.bg.default" }, { fg: "color.accent.default", bg: "color.bg.default", min: 3 }] });
    const built = forge(P, "design", "build");
    suite.check("design: forge design build exports CSS, Tailwind, TS theme and JSON", built.code === 0 && ["tokens.css", "tailwind.css", "theme.ts", "tokens.dart", "ForgeTokens.swift", "ForgeTokens.kt"].every((f) => existsSync(join(P, "design/dist", f))), built.all);
    const audit = json(forge(P, "design", "audit", "--json"));
    suite.check("design: contrast pairs pass and no drift in the app", audit?.contrast?.results?.every((r) => r.pass) && audit.drift.length === 0, JSON.stringify(audit?.contrast?.results));
    const all = ["empty", "loading", "error", "success"];
    const screensDoc = (checkinStates) => ({
      screens: [
        { id: "checkin", storyIds: ["S-1"], route: "/checkin", platform: "web", components: ["HabitCard", "CheckInButton"], states: checkinStates },
        { id: "streaks", storyIds: ["S-2"], route: "/streaks", platform: "web", components: ["StreakList"], states: all },
      ],
    });
    const rubric = (passing) =>
      writeJson(join(P, ".forge/gates/design.rubric.json"), {
        judge: "e2e-judge",
        producer: "e2e-fixture",
        criteria: Array.from({ length: 10 }, (_, i) => ({ id: `R-${i + 1}`, question: `Rubric criterion ${i + 1}?`, pass: i < passing })),
      });
    put("screens", screensDoc(["success", "loading"]));
    rubric(8);
    expectFail("design", ["design-states", "design-critique"], "missing empty/error states + rubric 8/10");
    put("screens", screensDoc(all));
    const proto = forge(P, "design", "prototype");
    suite.check("design: prototype scaffold covers every screen × state", proto.code === 0 && (readFileSync(join(P, "design/prototype/index.html"), "utf8").match(/data-state=/g) ?? []).length === 8, proto.all);
    rubric(9);
  },
});

await stage("motion", {
  initial: ["motion-valid"],
  produce: () => {
    const specs = (withFallback) => ({
      specs: [
        {
          id: "streak-pop",
          storyIds: ["S-1"],
          trigger: "checkin.success",
          targets: ["#streak-badge"],
          kind: "spring",
          springToken: "spring.snappy",
          keyframes: { scale: [0.8, 1.1, 1] },
          ...(withFallback ? { reducedMotion: { kind: "fade", durationToken: "duration.fast" } } : {}),
        },
        { id: "route-fade", trigger: "route.change", targets: ["main"], kind: "route", durationToken: "duration.base", reducedMotion: { kind: "instant" } },
      ],
    });
    put("motion", specs(false));
    expectFail("motion", ["motion-reducedMotion"], "spring without a reduced-motion fallback");
    put("motion", specs(true));
  },
});

await stage("architect", {
  initial: ["architecture-valid", "openapi-valid", "adrs"],
  produce: () => {
    put("architecture", "# Architecture\n\nSingle Node.js `node:http` service with a file-backed store (`src/store.js`).\n");
    put(
      "openapi",
      "openapi: 3.1.0\ninfo: { title: habit-coach, version: 0.1.0 }\npaths:\n  /checkins: { post: { responses: { '201': { description: created } } } }\n  /streaks: { get: { responses: { '200': { description: ok } } } }\n  /health: { get: { responses: { '200': { description: ok } } } }\n",
    );
    writeText(join(P, ".forge/adr/0001-node-http.md"), "# ADR 0001: node:http, no framework\n\nStatus: accepted\n");
    const decision = forge(P, "ledger", "add", "--summary", "Use plain node:http instead of Express", "--why", "zero runtime dependencies for the MVP", "--rejected", "Express,Fastify", "--stage", "architect");
    suite.check("architect: decision recorded in the ledger", decision.code === 0, decision.all);
  },
});

await stage("plan", {
  initial: ["tasks-valid"],
  produce: () => {
    const tasks = (cyclic) => ({
      tasks: [
        { id: "T-1", title: "Streak store", dept: "backend", storyIds: ["S-1"], deps: cyclic ? ["T-3"] : [] },
        { id: "T-2", title: "Check-in + streaks API", dept: "backend", storyIds: ["S-1", "S-2"], deps: ["T-1"] },
        { id: "T-3", title: "Web screens", dept: "frontend", storyIds: ["S-2"], deps: ["T-2"] },
      ],
    });
    put("tasks", tasks(true));
    expectFail("plan", ["tasks-dag"], "dependency cycle T-1 → T-3 → T-2 → T-1");
    put("tasks", tasks(false));
    const waves = json(forge(P, "tasks", "waves", "--json"));
    suite.check("plan: tasks schedule into dependency waves", JSON.stringify(waves) === JSON.stringify([["T-1"], ["T-2"], ["T-3"]]), JSON.stringify(waves));
    const brief = forge(P, "tasks", "brief", "T-2").out;
    suite.check("plan: the task brief carries stories, acceptance and the contract", /Story S-2/.test(brief) && /Given a habit/.test(brief) && /\/checkins/.test(brief), brief.slice(0, 300));
  },
});

await stage("build", {
  initial: ["build", "test"],
  produce: () => {
    setCommand("build", "node --check src/server.js && node --check src/store.js && node --check src/copy.js");
    setCommand("test", "node --test");
    const gate = expectFail("build", ["test"], "planted streak bug fails the real test suite");
    const message = gate?.checks.find((c) => c.id === "test")?.message ?? "";
    suite.check("build: the failing test's name is surfaced in the gate output", /increments the streak/.test(message), tail(message, 4));
    cpSync(join(E2E, "fixtures/fixes/store.js"), join(P, "src/store.js")); // the fix
  },
});

await stage("verify", {
  initial: ["reviews-valid"],
  produce: () => {
    setCommand("lint", "node --check src/server.js");
    const findings = (status) => ({
      findings: [
        {
          id: "F-1",
          severity: "high",
          category: "correctness",
          file: "src/store.js",
          line: 4,
          claim: "Check-ins never increased the streak",
          suggestedFix: "persist and increment",
          status,
          ...(status === "fixed" ? { verifiedBy: "test/checkin.test.js" } : {}),
        },
        { id: "F-2", severity: "low", category: "style", file: "src/server.js", claim: "Inline route table", status: "open" },
      ],
    });
    put("reviews", findings("open"));
    const gate = expectFail("verify", ["review-noBlocking"], "open high-severity finding F-1");
    const statuses = Object.fromEntries((gate?.checks ?? []).map((c) => [c.id, c.status]));
    suite.check("verify: unconfigured e2e command is skipped, configured lint runs", statuses.e2e === "skip" && statuses.lint === "pass", JSON.stringify(statuses));
    put("reviews", findings("fixed"));
  },
});

await stage("gap", {
  initial: ["trace-coverage", "gap-noPlaceholders"],
  produce: () => {
    for (const [from, to, type] of [
      ["story:S-1", "code:src/store.js", "implementedBy"],
      ["story:S-1", "test:test/checkin.test.js", "verifiedBy"],
      ["story:S-2", "code:src/server.js", "implementedBy"],
      ["story:S-2", "test:test/streaks.test.js", "verifiedBy"],
    ]) {
      const link = forge(P, "trace", "link", from, to, type);
      if (link.code !== 0) throw new Error(link.all);
    }
    const gaps = forge(P, "gaps", "--json");
    const report = json(gaps);
    suite.check("gap: trace coverage is 100% (6/6) after linking", gaps.code === 0 && report?.coverage === 1 && report.required === 6, gaps.out);
    const gate = expectFail("gap", ["gap-noPlaceholders"], "lorem ipsum copy in src/copy.js");
    const message = gate?.checks.find((c) => c.id === "gap-noPlaceholders")?.message ?? "";
    suite.check("gap: the placeholder hit points at src/copy.js:2", /src\/copy\.js:2/.test(message), message);
    cpSync(join(E2E, "fixtures/fixes/copy.js"), join(P, "src/copy.js")); // real copy
  },
});

async function smokeTest(dir) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), HABIT_DB: join(RUN, "smoke-db.json") },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start within 10s")), 10_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const checks = [];
  try {
    const health = await fetch(`${base}/health`);
    checks.push({ name: "GET /health → 200", pass: health.status === 200 });
    await fetch(`${base}/checkins?habit=run`, { method: "POST" });
    const second = await fetch(`${base}/checkins?habit=run`, { method: "POST" });
    const body = await second.json();
    checks.push({ name: "two check-ins → streak 2", pass: second.status === 201 && body.streak === 2, detail: JSON.stringify(body) });
    const bad = await fetch(`${base}/checkins`, { method: "POST" });
    checks.push({ name: "missing habit → 400", pass: bad.status === 400 });
  } finally {
    child.kill();
  }
  return { url: base, checks };
}

await stage("ship", {
  checkpoint: true,
  initial: ["release-valid"],
  produce: async () => {
    const smoke = await smokeTest(P);
    suite.check("ship: real smoke test against the running server", smoke.checks.every((c) => c.pass), JSON.stringify(smoke.checks));
    put("release", {
      version: "0.1.0",
      env: "local",
      url: smoke.url,
      at: new Date().toISOString(),
      checks: smoke.checks,
      rollback: "Revert the release commit and restart the service",
    });
  },
});

await stage("launch", {
  initial: ["launch-valid"],
  produce: () => put("launch", "# Launch plan\n\n- Show HN post\n- Waitlist landing page\n"),
});

await stage("learn", {
  initial: ["memory-episodeSinceStart"],
  produce: () => {
    const file = writeTmp(
      "episode.json",
      JSON.stringify({
        goal: "Ship the habit-coach MVP through every forge gate",
        done: ["14 stages passed", "Streak bug fixed (F-1)", "Placeholder copy replaced"],
        decisions: ["node:http instead of Express"],
        openThreads: ["Reminders (S-3) are not in the MVP"],
        next: "Plan v0.2: reminders",
        stage: "learn",
      }),
    );
    const saved = forge(P, "memory", "episode", "--file", file);
    if (saved.code !== 0) throw new Error(saved.all);
  },
});

const final = json(forge(P, "status", "--json"));
suite.check(
  "pipeline complete: no next stage, all 14 stages passed",
  final?.next === null && final.stages.length === 14 && final.stages.every((s) => s.status === "passed"),
  JSON.stringify(final?.stages.map((s) => [s.id, s.status])),
);
const ledger = json(forge(P, "ledger", "list", "--limit", "1000", "--json")) ?? [];
suite.check("ledger recorded a gate pass for every stage", ledger.filter((e) => e.kind === "gate" && e.summary.startsWith("Gate passed")).length === 14, `${ledger.length} entries`);
suite.check("ledger ids are unique and sequential", ledger.every((e, i) => e.id === `D-${i + 1}`), ledger.map((e) => e.id).join(","));

// ── 3 ────────────────────────────────────────────────────────────────────────
suite.begin("3. Memory, ledger & secret scanning");
const ask = (question, ...extra) => json(forge(P, "memory", "query", question, "--json", ...extra));
let answer = ask("why did we use node:http instead of express?", "--no-graph");
suite.check("why-question answered from the ledger, with a citation", answer?.intent === "why" && /\[ledger D-\d+ \(architect\)\] Use plain node:http/.test(answer.text), answer?.text?.slice(0, 300));
answer = ask("is S-1 tested?", "--no-graph");
suite.check("coverage question answered from the trace graph (100%)", answer?.intent === "coverage" && /coverage 100%/.test(answer.text), answer?.text?.slice(0, 300));
answer = ask("what happened last session?", "--no-graph");
suite.check("history question answered from the saved episode", answer?.intent === "history" && answer.hits.some((h) => h.source === "episode"), answer?.text?.slice(0, 300));
answer = ask("what are the acceptance criteria for reminders?", "--no-graph");
suite.check("spec question answered from the PRD (story S-3)", answer?.hits?.[0]?.ref === "prd#S-3", answer?.hits?.slice(0, 3).map((h) => h.ref).join(", "));
answer = ask("what is blocked or next?", "--no-graph");
suite.check("status question answered from state", answer?.intent === "status" && /next stage: none/.test(answer.text), answer?.text?.slice(0, 200));

const learnProject = forge(P, "memory", "learn", "Write a failing test before fixing a bug", "--source", "build gate");
const learnGlobal = forge(P, "memory", "learn", "Configure commands.test before the build stage", "--global");
suite.check(
  "project and global learnings land in the right files",
  learnProject.code === 0 &&
    learnGlobal.code === 0 &&
    readFileSync(join(P, ".forge/learnings.md"), "utf8").includes("failing test") &&
    readFileSync(join(HOME, "global/learnings.md"), "utf8").includes("commands.test"),
);
const fakeAwsKey = `AKIA${"Q".repeat(16)}`;
let refused = forge(P, "ledger", "add", "--summary", `deploy with ${fakeAwsKey}`);
suite.check(
  "ledger refuses a summary containing an AWS-style key",
  refused.code === 1 && /secret/.test(refused.err) && !readFileSync(join(P, ".forge/ledger.jsonl"), "utf8").includes(fakeAwsKey),
  refused.err,
);
refused = forge(P, "artifact", "write", "launch", "--file", writeTmp("launch-secret.md", `token sk-ant-${"x".repeat(30)}`));
suite.check("artifact write refuses content containing an API key", refused.code === 1 && /secret/.test(refused.err), refused.err);
refused = forge(P, "evidence", "save", "--url", `${EV_BASE}/e2e-source-3`, "--quote", "this sentence is not on the page at all");
suite.check("evidence save rejects a quote that is not on the page", refused.code === 1 && /does not appear/.test(refused.err), refused.err);
const blocked = json(forge(P, "evidence", "save", "--url", `${EV_BASE}/blocked`, "--quote", "a quote we cannot check", "--json"));
suite.check("a blocked page is stored as unverifiable, with the reason", blocked?.verification?.status === "unverifiable" && blocked.verification.note === "HTTP 403", JSON.stringify(blocked));
const scored = json(forge(P, "validate", "score", "--json"));
suite.check("validate score recomputes the saved scorecard (91, go)", scored?.score === 91 && scored.suggestedVerdict === "go", JSON.stringify(scored));
const template = JSON.parse(forge(P, "validate", "template", "Habit coach").out);
suite.check("validate template emits the 12-criteria scorecard", template.criteria.length === 12 && template.criteria.every((c) => c.answer === "unknown"));

// ── 4 ────────────────────────────────────────────────────────────────────────
suite.begin("4. graphify code-graph memory (real graphify)");
const graph = json(forge(P, "graph", "status", "--json"));
if (!graph?.installed) {
  suite.note("graphify not installed", "graph checks skipped");
} else {
  const update = forge(P, "graph", "update");
  suite.check("graph update builds the code graph without an LLM", update.code === 0 && existsSync(join(P, "graphify-out/graph.json")), tail(update.all, 4));
  answer = ask("which function handles check-ins?");
  suite.check(
    "code question is routed to graphify and returns graph hits",
    answer?.intent === "code" && answer.hits[0]?.source === "graph" && /checkIn|createStore|store/i.test(answer.hits[0].text),
    answer?.text?.slice(0, 400),
  );
  const explain = forge(P, "graph", "explain", "createStore");
  suite.check("graph explain describes a node", explain.code === 0 && /createStore/.test(explain.out), tail(explain.all, 6));
  const path = forge(P, "graph", "path", "createApp", "createStore");
  suite.check("graph path connects two functions", path.code === 0 && path.out.trim().length > 0, tail(path.all, 6));
}

// ── 5 ────────────────────────────────────────────────────────────────────────
suite.begin("5. Robustness & edge cases");
const fresh = (name) => {
  const dir = join(RUN, name);
  mkdirSync(dir, { recursive: true });
  forge(dir, "init", "--name", name);
  return dir;
};
const nested = join(P, "src", "nested", "deeper");
mkdirSync(nested, { recursive: true });
suite.check("finds the project root from a nested directory", json(forge(nested, "status", "--json"))?.project === "habit-coach");
r = sh(process.execPath, [CLI, "status", "--json"], { cwd: RUN, env: { ...process.env, ...ENV, FORGE_ROOT: P } });
suite.check("FORGE_ROOT selects the project from any directory", json(r)?.project === "habit-coach", r.all);

let R = fresh("corrupt-state");
writeFileSync(join(R, ".forge/state.json"), "{ not json");
r = forge(R, "status");
suite.check("corrupt state.json → clear error that names the file", r.code === 1 && /state\.json/.test(r.err), r.err);

R = fresh("bad-config");
editConfig(R, (text) => text.replace("autonomy: checkpoint", "autonomy: yolo"));
r = forge(R, "status");
suite.check("invalid config value → error names the field", r.code === 1 && /autonomy/.test(r.err), r.err);

R = fresh("bad-ledger");
appendFileSync(join(R, ".forge/ledger.jsonl"), "this is not json\n");
r = forge(R, "ledger", "add", "--summary", "after a corrupt line");
const repaired = json(forge(R, "ledger", "list", "--json"));
suite.check("a corrupt ledger line is skipped and ids continue", r.code === 0 && repaired?.length === 2 && repaired[1].id === "D-2", JSON.stringify(repaired));

R = fresh("ordering");
r = forge(R, "start", "spec");
suite.check("starting a stage out of order is refused", r.code === 1 && /Earlier stages are not finished/.test(r.err), r.err);
r = forge(R, "start", "spec", "--force");
suite.check("--force starts out of order and is recorded in the ledger", r.code === 0 && (json(forge(R, "ledger", "list", "--json")) ?? []).some((e) => /forced past unfinished/.test(e.summary)), r.all);
r = forge(R, "start", "nope");
suite.check("unknown stage → error lists valid stages", r.code === 1 && /Unknown stage "nope"/.test(r.err), r.err);
r = forge(R, "start", "motion");
suite.check("pack stage without its pack → explains how to enable it", r.code === 1 && /enable pack "motion"/.test(r.err), r.err);
r = forge(R, "complete");
suite.check("missing argument → usage error, exit 2", r.code === 2, r.err);
r = forge(R, "override", "brainstorm");
suite.check("override without --reason → usage error, exit 2", r.code === 2 && /--reason/.test(r.err), r.err);
r = forge(R, "frobnicate");
suite.check("unknown command → usage error, exit 2", r.code === 2, r.err);

R = fresh("escalation");
editConfig(R, (text) => text.replace("maxIterations: 3", "maxIterations: 2"));
forge(R, "start", "brainstorm");
forge(R, "complete", "brainstorm");
r = forge(R, "complete", "brainstorm");
suite.check(
  "repeated gate failures escalate with a decision memo",
  r.code === 1 && /needs a human decision/.test(r.out) && json(forge(R, "status", "--json"))?.stages[0].status === "blocked",
  tail(r.out, 6),
);
r = forge(R, "override", "brainstorm", "--reason", "founder picked the idea offline");
const override = (json(forge(R, "ledger", "list", "--json")) ?? []).find((e) => e.kind === "override");
suite.check("override passes the stage and records the reason", r.code === 0 && override?.why === "founder picked the idea offline" && json(forge(R, "status", "--json"))?.next === "vision");
r = forge(R, "reopen", "brainstorm", "--reason", "new market data", "--cascade");
suite.check("cascading reopen resets the pipeline", r.code === 0 && json(forge(R, "status", "--json"))?.next === "brainstorm", r.all);
forge(R, "archive", "--reason", "validation verdict was kill");
r = forge(R, "start", "brainstorm");
suite.check("an archived project refuses new work", r.code === 1 && /archived/.test(r.err), r.err);
forge(R, "reopen", "brainstorm", "--reason", "pivot to a new segment");
r = forge(R, "start", "brainstorm");
suite.check("reopen un-archives the project", r.code === 0, r.all);
r = forge(R, "block", "STRIPE_SECRET_KEY (test mode) for payments", "--stage", "build");
suite.check("blockers are recorded and shown in status", r.code === 0 && json(forge(R, "status", "--json"))?.blockers[0]?.id === "B-1");
r = forge(R, "unblock", "B-1", "--note", "added to .env");
suite.check("blockers resolve", r.code === 0 && json(forge(R, "status", "--json"))?.blockers.length === 0);

R = fresh("strict");
editConfig(R, (text) => text.replace("autonomy: checkpoint", "autonomy: strict"));
forge(R, "start", "brainstorm");
writeJson(join(R, ".forge/artifacts/brainstorm.json"), { ideas: [{ id: "I-1", title: "x", oneLiner: "y" }], chosenId: "I-1" });
const strictGate = json(forge(R, "complete", "brainstorm", "--json"));
suite.check("autonomy=strict requires approval on every stage", sameSet(failing(strictGate), ["human-approval"]), failing(strictGate).join(", "));

r = sh("/bin/sh", ["-c", `"${process.execPath}" "${CLI}" stages | head -1`], { cwd: P });
suite.check("piping into head exits cleanly (no EPIPE crash)", r.code === 0 && !/EPIPE/.test(r.err), r.err);

R = fresh("concurrency");
const N = 8; // bounded burst of short-lived writers (RAM protocol: no unbounded spawning)
const parallel = await Promise.all(
  Array.from({ length: N }, (_, i) => shAsync(process.execPath, [CLI, "ledger", "add", "--summary", `parallel decision ${i}`], { cwd: R, env: { ...process.env, ...ENV } })),
);
const ids = (json(forge(R, "ledger", "list", "--limit", "100", "--json")) ?? []).map((e) => e.id);
suite.check(
  `${N} concurrent ledger writes all succeed with unique ids`,
  parallel.every((x) => x.code === 0) && ids.length === N + 1 && new Set(ids).size === ids.length,
  `exit codes: ${parallel.map((x) => x.code).join(",")} · ids: ${ids.join(",")}`,
);
const parallelStarts = await Promise.all(
  Array.from({ length: 6 }, () => shAsync(process.execPath, [CLI, "block", "parallel blocker"], { cwd: R, env: { ...process.env, ...ENV } })),
);
const blockers = json(forge(R, "status", "--json"))?.blockers ?? [];
suite.check(
  "6 concurrent state writes (blockers) are all kept",
  parallelStarts.every((x) => x.code === 0) && blockers.length === 6 && new Set(blockers.map((b) => b.id)).size === 6,
  `blockers kept: ${blockers.map((b) => b.id).join(",")}`,
);

// ── 6 ────────────────────────────────────────────────────────────────────────
suite.begin("6. MCP server over real stdio (official MCP SDK client)");
await suite.guard("MCP session", async () => {
  const req = createRequire(join(FORGE, "package.json"));
  const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");
  const M = join(RUN, "mcp-project");
  mkdirSync(M, { recursive: true });
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: M, env: { ...process.env, ...ENV }, stderr: "pipe" });
  const client = new Client({ name: "forge-e2e", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { text: res.content?.[0]?.text ?? "", isError: res.isError === true };
  };
  const tools = (await client.listTools()).tools;
  suite.check("server lists 45 tools, each with an object input schema", tools.length === 45 && tools.every((t) => t.inputSchema?.type === "object"), String(tools.length));
  suite.check("server sends usage instructions on initialize", /Never fabricate/.test(client.getInstructions() ?? ""));
  let t = await call("guide", { name: "skills/validate-idea" });
  suite.check("guide serves the validate-idea playbook from the installed package", /evidence_save/.test(t.text) && !t.isError, t.text.slice(0, 120));
  t = await call("forge_status");
  suite.check("before init: a tool error, not a crash", t.isError && /forge init/.test(t.text), t.text);
  t = await call("project_init", { name: "mcp-app" });
  suite.check("project_init", !t.isError && existsSync(join(M, ".forge/state.json")), t.text);
  t = await call("stage_start", { stage: "brainstorm" });
  suite.check("stage_start", !t.isError, t.text);
  t = await call("artifact_write", { name: "brainstorm", data: { ideas: [] } });
  suite.check("invalid artifact is rejected with schema errors", t.isError && /ideas/.test(t.text), t.text);
  t = await call("artifact_write", { name: "brainstorm", data: { ideas: [{ id: "I-1", title: "Habit coach", oneLiner: "streaks" }], chosenId: "I-1" } });
  suite.check("valid artifact is written", !t.isError, t.text);
  t = await call("stage_complete", { stage: "brainstorm" });
  suite.check("stage_complete passes the gate", JSON.parse(t.text).passed === true, t.text.slice(0, 300));
  t = await call("stage_complete", { stage: "vision" });
  suite.check("completing an unstarted stage is a tool error", t.isError && /not been started/.test(t.text), t.text);
  t = await call("ledger_add", { summary: "Target busy professionals", why: "most frequent pain", rejected: ["students"] });
  suite.check("ledger_add", !t.isError, t.text);
  t = await call("memory_query", { question: "why busy professionals?" });
  suite.check("memory_query cites the decision", /Target busy professionals/.test(JSON.parse(t.text).answer), t.text);
  t = await call("blocker_add", { need: "Apple developer account", stage: "ship" });
  const blocker = JSON.parse(t.text);
  t = await call("blocker_resolve", { id: blocker.id });
  suite.check("blocker_add → blocker_resolve", !t.isError && blocker.id === "B-1", t.text);
  t = await call("memory_save_episode", { goal: "MCP smoke test", done: ["brainstorm passed"] });
  suite.check("memory_save_episode", !t.isError, t.text);
  t = await call("trace_gaps");
  suite.check("trace_gaps explains that there is no PRD yet", /no PRD/.test(t.text), t.text);
  t = await call("artifact_list");
  suite.check("artifact_list reports all 16 artifacts", JSON.parse(t.text).length === 16, t.text.slice(0, 120));
  t = await call("stage_approve", { stage: "vision", note: "user said yes" });
  suite.check("stage_approve records an approval", !t.isError && readJson(join(M, ".forge/state.json")).approvals.vision?.note === "user said yes", t.text);
  t = await call("graph_status");
  suite.check("graph_status", !t.isError, t.text);
  t = await call("process_snapshot");
  const snapshot = JSON.parse(t.text);
  suite.check("process_snapshot reports memory headroom and this project's processes", snapshot.memory?.totalGb > 0 && Array.isArray(snapshot.processes), t.text.slice(0, 200));
  const serverPid = transport.pid;
  await client.close();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  suite.check("the MCP server process exits when the client disconnects", serverPid !== null && !pidAlive(serverPid), `pid ${serverPid}`);
});

// ── 6b ───────────────────────────────────────────────────────────────────────
suite.begin("6b. Existing product: adopt, sync, understand gate, git-hook sync");
await suite.guard("adopt", async () => {
  const A = join(RUN, "adopt-app");
  cpSync(join(E2E, "fixtures", "app"), A, { recursive: true });
  cpSync(join(E2E, "fixtures", "fixes", "store.js"), join(A, "src", "store.js"));
  const git = (...args) => sh("git", ["-c", "user.email=e2e@forge.local", "-c", "user.name=forge-e2e", ...args], { cwd: A });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  const adopted = json(forge(A, "adopt", "--name", "habit-api", "--json"));
  const ids = adopted?.sync.map.surfaces.map((s) => s.id) ?? [];
  suite.check("adopt detects the app's 3 raw node:http endpoints", ["endpoint:GET /health", "endpoint:GET /streaks", "endpoint:POST /checkins"].every((id) => ids.includes(id)), ids.join(", "));
  suite.check("adopt skips greenfield stages and enables the understand stage", JSON.stringify(adopted?.skipped) === '["brainstorm","validate"]' && json(forge(A, "status", "--json"))?.next === "understand", JSON.stringify(adopted?.skipped));
  suite.note("code graph on adopt", `${adopted?.sync.map.graph.status}${adopted?.sync.map.graph.note ? ` — ${adopted.sync.map.graph.note}` : ""}`);
  suite.check("a fresh map passes sync --check", forge(A, "sync", "--check").code === 0);
  writeFileSync(join(A, "src", "copy.js"), `${readFileSync(join(A, "src", "copy.js"), "utf8")}export const extra = "new";\n`);
  suite.check("a code change makes the map stale (sync --check exits 1)", forge(A, "sync", "--check").code === 1);
  const hooks = json(forge(A, "hooks", "install", "--json"));
  suite.check("forge hooks install adds post-commit/post-merge/post-checkout hooks", hooks?.length === 3, JSON.stringify(hooks));
  git("commit", "-qam", "change copy");
  suite.check("the post-commit hook re-synced the product map automatically", forge(A, "sync", "--check").code === 0, forge(A, "sync", "--check").all);
  forge(A, "start", "understand");
  const model = {
    summary: "Habit-coach API: check in to habits and read streaks.",
    stage: "validation",
    personas: [{ id: "P-1", name: "Busy professional", jobs: ["keep a daily habit streak"] }],
    features: [{ id: "F-1", name: "Check-ins and streaks", description: "Record a check-in and list streaks", surfaces: ["endpoint:POST /checkins", "endpoint:GET /streaks"], files: ["src/server.js", "src/store.js"], status: "live", evidence: ["src/server.js", "test/checkin.test.js"] }],
    ignoredSurfaces: [{ surface: "endpoint:GET /health", reason: "infrastructure health check" }],
  };
  const file = writeTmp("product-model.json", JSON.stringify(model));
  forge(A, "artifact", "write", "product", "--file", file);
  const gate = json(forge(A, "complete", "understand", "--json"));
  suite.check("understand gate passes with every surface modelled and a fresh map", gate?.passed === true, JSON.stringify(gate?.checks.filter((c) => c.status === "fail")));
  const answer = json(forge(A, "memory", "query", "which file handles POST checkins?", "--no-graph", "--json"));
  suite.check("memory answers product questions from the product map", /endpoint POST \/checkins in src\/server\.js/.test(answer?.text ?? ""), answer?.text?.slice(0, 200));
});

// ── 7 ────────────────────────────────────────────────────────────────────────
suite.begin("7. Process hygiene & RAM protection");
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForFile(file, ms = 5_000) {
  for (const end = Date.now() + ms; Date.now() < end && !existsSync(file); ) await sleepMs(50);
  return existsSync(file);
}
async function waitForExit(pid, ms = 8_000) {
  for (const end = Date.now() + ms; Date.now() < end && pidAlive(pid); ) await sleepMs(100);
  return !pidAlive(pid);
}

await suite.guard("gate command leaks", async () => {
  const H = fresh("leaky-gate");
  const pidFile = join(H, "bg.pid");
  editConfig(H, (text) =>
    text.replace(/^  build:.*$/m, `  build: ${JSON.stringify(`sleep 30 & echo $! > ${pidFile}`)}`).replace(/^  test:.*$/m, '  test: "true"'),
  );
  forge(H, "start", "build", "--force");
  const gate = json(forge(H, "complete", "build", "--json"));
  const build = gate?.checks.find((c) => c.id === "build");
  const bgPid = Number(readFileSync(pidFile, "utf8"));
  suite.check("a gate command that leaves a background process still passes…", build?.status === "pass", JSON.stringify(build));
  suite.check("…and forge stops that leftover and says so", /stopped 1 background process/.test(build?.message ?? "") && !pidAlive(bgPid), `${build?.message} · pid ${bgPid} alive=${pidAlive(bgPid)}`);
});

await suite.guard("MCP stdin close", async () => {
  const child = spawn(process.execPath, [CLI, "mcp", "--root", RUN], { stdio: ["pipe", "ignore", "ignore"] });
  await sleepMs(800);
  const alive = pidAlive(child.pid);
  child.stdin.end();
  suite.check("the MCP server exits when its host closes stdin", alive && (await waitForExit(child.pid, 4_000)), `pid ${child.pid}`);
});

await suite.guard("MCP orphan", async () => {
  const pidFile = join(RUN, "orphan-mcp.pid");
  // A pipe writer keeps stdin open while the parent shell exits: the server is orphaned.
  const shell = spawn("/bin/sh", ["-c", `sleep 60 | "${process.execPath}" "${CLI}" mcp --root "${RUN}" >/dev/null 2>&1 & echo $! > "${pidFile}"; sleep 2`], {
    detached: true,
    stdio: "ignore",
  });
  const shellGroup = shell.pid;
  const ready = await waitForFile(pidFile);
  const mcpPid = ready ? Number(readFileSync(pidFile, "utf8")) : NaN;
  suite.check("an orphaned MCP server (host died, pipe still open) exits on its own", ready && (await waitForExit(mcpPid, 9_000)), `pid ${mcpPid}`);
  try {
    process.kill(-shellGroup, "SIGTERM"); // the `sleep 60` pipe writer this test started
  } catch {
    // already gone
  }
});

await suite.guard("forge procs", async () => {
  const D = join(RUN, "procs-probe");
  mkdirSync(D, { recursive: true });
  const probe = spawn("sleep", ["30"], { cwd: D, stdio: "ignore" });
  await sleepMs(300);
  const listed = json(forge(D, "procs", "--json"));
  suite.check("forge procs lists a live process in the project, with RSS", listed?.processes?.some((p) => p.pid === probe.pid && p.rssKb > 0), JSON.stringify(listed?.processes?.map((p) => p.pid)));
  probe.kill();
  await waitForExit(probe.pid, 3_000);
  const init = forge(D, "procs", "init");
  suite.check("forge procs init writes an AGENT_PROCESSES.md registry", init.code === 0 && /## 2\. Active processes/.test(readFileSync(join(D, "AGENT_PROCESSES.md"), "utf8")), init.all);
  const doctor = forge(D, "doctor");
  suite.check("forge doctor reports memory headroom", /memory\s+\d+\.\d GB, \d+% free/.test(doctor.out), tail(doctor.out, 4));
});

await sleepMs(500);
const leftovers = json(forge(RUN, "procs", "--json", "--root", RUN))?.processes ?? null;
suite.check(
  "after the whole run, no process belonging to the run directory is still alive",
  Array.isArray(leftovers) && leftovers.length === 0,
  JSON.stringify(leftovers?.map((p) => `${p.pid} ${p.command}`)),
);

// ── 7 ────────────────────────────────────────────────────────────────────────
suite.begin("8. Exported JSON Schemas, checked by Ajv (a non-forge validator)");
await suite.guard("Ajv validation", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const files = {
    brainstorm: ".forge/artifacts/brainstorm.json",
    vision: ".forge/artifacts/vision.json",
    validation: ".forge/artifacts/validation.json",
    competitors: ".forge/artifacts/competitors.json",
    prd: ".forge/artifacts/prd.json",
    screens: "design/screens.json",
    motion: "design/motion.json",
    tasks: ".forge/artifacts/tasks.json",
    reviews: ".forge/reviews/findings.json",
    trace: ".forge/graph/trace.json",
    release: ".forge/releases/latest.json",
    rubric: ".forge/gates/design.rubric.json",
    "evidence-store": ".forge/evidence/evidence.json",
    state: ".forge/state.json",
  };
  for (const [name, rel] of Object.entries(files)) {
    const validate = ajv.compile(readJson(join(FORGE, "schemas", `${name}.schema.json`)));
    suite.check(`${name}.schema.json accepts the pipeline's ${rel}`, validate(readJson(join(P, rel))), JSON.stringify(validate.errors?.slice(0, 3)));
  }
  const validation = ajv.compile(readJson(join(FORGE, "schemas", "validation.schema.json")));
  suite.check("validation.schema.json rejects an invalid verdict", !validation({ ...readJson(join(P, files.validation)), verdict: "maybe" }));
  const entry = ajv.compile(readJson(join(FORGE, "schemas", "ledger-entry.schema.json")));
  const lines = readFileSync(join(P, ".forge/ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  suite.check(`ledger-entry.schema.json accepts all ${lines.length} ledger lines`, lines.every((line) => entry(line)), JSON.stringify(entry.errors));
});

// ── report ───────────────────────────────────────────────────────────────────
await evidenceServer.stop();
suite.check("the fixture evidence server process has exited", !pidAlive(evidenceServer.pid), `pid ${evidenceServer.pid}`);
const report = suite.report({ forge: VERSION, node: process.version, "Run directory": RUN.replace(`${E2E}/`, "e2e/") });
writeText(join(RUN, "REPORT.md"), report);
writeText(join(E2E, "LATEST-local.md"), report);
console.log(`\n${suite.failed.length ? `FAILED (${suite.failed.length})` : "PASSED"} — ${join(RUN, "REPORT.md")}`);
process.exitCode = suite.failed.length ? 1 : 0;

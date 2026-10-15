import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { Forge } from "../src/core/engine.js";
import { readLedger } from "../src/core/ledger.js";
import { queryMemory } from "../src/memory/query.js";
import { adoptProject } from "../src/product/adopt.js";
import { extractProduct, listProjectFiles } from "../src/product/scan.js";
import { checkProduct, listPageAudits, loadProductMap, savePageAudit, syncProduct } from "../src/product/sync.js";
import type { Trace } from "../src/schemas/artifacts.js";
import { readJson } from "../src/core/paths.js";
import { isolate, tempDir } from "./helpers.js";

isolate();

function project(files: Record<string, string>): string {
  const root = tempDir();
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const NEXT_APP = {
  "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
  "app/page.tsx": "export default function Home() { return <a href='/settings'>Settings</a>; }",
  "app/settings/page.tsx": "export default async function Settings() { const r = await fetch(`/api/users/${id}`); return null; }",
  "app/(marketing)/pricing/page.tsx": "export default function Pricing() { return null; }",
  "app/blog/[slug]/page.tsx": "export default function Post() { return null; }",
  "app/api/users/[id]/route.ts": "export async function GET() {}\nexport async function PATCH() {}",
  "app/api/health/route.ts": "export const GET = () => new Response('ok');",
  "README.md": "# Acme\n\nAcme helps teams ship.",
  "app/settings/page.test.tsx": "it('x', () => fetch('/api/users/1'))",
};

describe("product scan", () => {
  it("extracts Next.js pages (groups, params) and route handlers with methods", () => {
    const root = project(NEXT_APP);
    const result = extractProduct(root, listProjectFiles(root));
    expect(result.frameworks).toEqual(["nextjs"]);
    expect(result.surfaces.map((s) => s.id)).toEqual([
      "endpoint:GET /api/health",
      "endpoint:GET /api/users/:id",
      "endpoint:PATCH /api/users/:id",
      "page:/",
      "page:/blog/:slug",
      "page:/pricing",
      "page:/settings",
    ]);
    // A template-literal fetch matches the parametrised route; test files are ignored.
    expect(result.calls).toEqual([
      { from: "app/settings/page.tsx", to: "endpoint:GET /api/users/:id", literal: "/api/users/${id}" },
      { from: "app/settings/page.tsx", to: "endpoint:PATCH /api/users/:id", literal: "/api/users/${id}" },
    ]);
    expect(result.docs).toEqual([expect.objectContaining({ path: "README.md", title: "Acme" })]);
  });

  it("extracts Express, FastAPI, Flask, SvelteKit and raw node:http endpoints", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { "@sveltejs/kit": "2.0.0" } }),
      "server/app.js": "app.get('/api/items', h); router.post('/api/items', h);",
      "api/main.py": "@app.get('/v1/orders')\ndef orders(): ...\n@bp.route('/v1/login', methods=['POST'])\ndef login(): ...",
      "src/routes/about/+page.svelte": "<h1>About</h1>",
      "src/routes/api/ping/+server.ts": "export function GET() {}",
      "src/raw.js": "if (req.method === 'GET' && url.pathname === '/health') {}",
    });
    const ids = extractProduct(root, listProjectFiles(root)).surfaces.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "endpoint:GET /api/items",
        "endpoint:POST /api/items",
        "endpoint:GET /v1/orders",
        "endpoint:POST /v1/login",
        "page:/about",
        "endpoint:GET /api/ping",
        "endpoint:GET /health",
      ]),
    );
  });
});

describe("adopt + sync", () => {
  it("adopts a project: understand stage, greenfield stages skipped, map + trace links written", async () => {
    const root = project(NEXT_APP);
    const result = await adoptProject(root, { name: "acme", graph: false });
    expect(result.skipped).toEqual(["brainstorm", "validate"]);
    const forge = new Forge(root);
    expect(forge.status().stages[0]).toMatchObject({ id: "understand", status: "pending" });
    expect(result.sync.map.graph.status).toBe("skipped");

    const trace = readJson(join(root, ".forge/graph/trace.json")) as Trace;
    expect(trace.edges).toContainEqual(expect.objectContaining({ from: "screen:/settings", to: "endpoint:GET /api/users/:id", type: "calls" }));
    expect(trace.edges).toContainEqual(expect.objectContaining({ from: "screen:/settings", to: "code:app/settings/page.tsx", type: "implementedBy" }));
    expect(readLedger(root).some((e) => /Product map synced: 4 pages, 3 endpoints \(first sync\)/.test(e.summary))).toBe(true);
  });

  it("detects staleness and reports added/removed surfaces and stale features on resync", async () => {
    const root = project(NEXT_APP);
    await adoptProject(root, { graph: false });
    expect(checkProduct(root).stale).toBe(false);

    writeArtifact(root, "product", {
      summary: "Acme helps teams ship.",
      stage: "growth",
      personas: [{ id: "P-1", name: "Team lead", jobs: ["ship weekly"] }],
      features: [{ id: "F-1", name: "Pricing", description: "Plans", surfaces: ["page:/pricing"], status: "live" }],
    });
    writeFileSync(join(root, "app/(marketing)/pricing/page.tsx"), "");
    const { rmSync } = await import("node:fs");
    rmSync(join(root, "app/(marketing)/pricing/page.tsx"));
    mkdirSync(join(root, "app/billing"), { recursive: true });
    writeFileSync(join(root, "app/billing/page.tsx"), "export default function B() { return null; }");
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(root, "app/billing/page.tsx"), future, future);

    expect(checkProduct(root).stale).toBe(true);
    const result = await syncProduct(root, { graph: false });
    expect(result.diff).toMatchObject({ added: ["page:/billing"], removed: ["page:/pricing"] });
    expect(result.staleFeatures).toEqual([{ feature: "F-1", missing: ["page:/pricing"] }]);
  });
});

describe("understand gate", () => {
  it("requires every surface in a feature (or ignored with a reason) and a fresh map", async () => {
    const root = project(NEXT_APP);
    await adoptProject(root, { graph: false });
    const forge = new Forge(root);
    forge.start("understand");
    const model = {
      summary: "Acme helps teams ship.",
      stage: "growth",
      personas: [{ id: "P-1", name: "Team lead", jobs: ["ship weekly"] }],
      features: [
        { id: "F-1", name: "Account settings", description: "Edit profile", surfaces: ["page:/settings", "endpoint:GET /api/users/:id", "endpoint:PATCH /api/users/:id"], status: "live" },
        { id: "F-2", name: "Marketing", description: "Home and pricing", surfaces: ["page:/", "page:/pricing"], status: "live" },
      ],
    };
    writeArtifact(root, "product", model);
    let gate = await forge.complete("understand");
    const coverage = gate.checks.find((c) => c.id === "product-coverage");
    expect(coverage?.status).toBe("fail");
    expect(coverage?.message).toMatch(/endpoint:GET \/api\/health, page:\/blog\/:slug/);

    writeArtifact(root, "product", {
      ...model,
      features: [...model.features, { id: "F-3", name: "Blog", description: "Posts", surfaces: ["page:/blog/:slug"], status: "partial" }],
      ignoredSurfaces: [{ surface: "endpoint:GET /api/health", reason: "infrastructure health check" }],
    });
    gate = await forge.complete("understand");
    expect(gate.passed).toBe(true);
  });
});

describe("page audits (pro-page-complete)", () => {
  const audit = (status: "live" | "placeholder") => ({
    page: "/settings",
    surface: "page:/settings",
    who: "Team lead",
    job: "Update my profile and notification settings",
    trust: "My real name and avatar are shown",
    antiGoal: "Not an admin console",
    atoms: [
      { label: "Owner name", class: "people", type: "text", job: "Shows who owns the account", data: "person name", clickPath: "profile", status, must: true, ...(status === "placeholder" ? { break: "placeholder-copy", fix: "map user.name" } : {}) },
      { label: "Save", class: "action", type: "button", job: "Persist changes", data: "none", clickPath: "PATCH /api/users/:id", status: "live", must: true },
    ],
    auditedAt: "2026-10-15T00:00:00.000Z",
  });

  it("stores audits, feeds the gap gate and memory", async () => {
    const root = project(NEXT_APP);
    await adoptProject(root, { graph: false });
    expect(savePageAudit(root, "settings", audit("placeholder")).open).toBe(1);
    expect(() => savePageAudit(root, "../evil", audit("live"))).toThrow(/slug/);
    expect(() => savePageAudit(root, "bad", { page: "/x" })).toThrow(/schema/);

    const forge = new Forge(root);
    forge.start("gap", { force: true });
    let gate = await forge.complete("gap");
    expect(gate.checks.find((c) => c.id === "pages-noMustFix")?.message).toMatch(/\/settings → Owner name \(placeholder\)/);

    savePageAudit(root, "settings", audit("live"));
    gate = await forge.complete("gap");
    expect(gate.checks.find((c) => c.id === "pages-noMustFix")?.status).toBe("pass");
    expect(listPageAudits(root)).toHaveLength(1);

    const answer = await queryMemory(root, "which endpoint does the settings page call?", { useGraph: false });
    expect(answer.text).toMatch(/endpoint GET \/api\/users\/:id in app\/api\/users\/\[id\]\/route\.ts.*called from app\/settings\/page\.tsx/);
    expect(loadProductMap(root)?.surfaces.length).toBe(7);
  });
});

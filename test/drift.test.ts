import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { Forge } from "../src/core/engine.js";
import { BUILTINS } from "../src/core/gates.js";
import { findStage } from "../src/core/stages.js";
import { extractProduct, listProjectFiles } from "../src/product/scan.js";
import { contractDrift, platformParity } from "../src/trace/drift.js";
import { editConfig, isolate, prd, tempDir, tmpProject } from "./helpers.js";

isolate();

function put(root: string, file: string, content: string | object): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

const endpointsOf = (root: string) =>
  extractProduct(root, listProjectFiles(root))
    .surfaces.filter((s) => s.kind === "endpoint")
    .map((s) => `${s.method} ${s.route}`)
    .sort();

describe("route extraction follows router mounts", () => {
  it("Hono: basePath, app.route() of imported routers, and chained routes", () => {
    const root = tempDir();
    put(
      root,
      "src/index.ts",
      'import { Hono } from "hono";\nimport books from "./routes/books.js";\nimport { authors } from "./routes/authors";\nconst app = new Hono().basePath("/api");\napp.route("/books", books);\napp.route("/authors", authors);\napp.get("/health", (c) => c.text("ok"));\nexport default app;\n',
    );
    put(root, "src/routes/books.ts", 'import { Hono } from "hono";\nconst books = new Hono();\nbooks.get("/", (c) => c.json([]));\nbooks.post("/", (c) => c.json({}));\nbooks.get("/:id", (c) => c.json({}));\nexport default books;\n');
    put(root, "src/routes/authors.ts", 'import { Hono } from "hono";\nexport const authors = new Hono()\n  .get("/", (c) => c.json([]))\n  .get("/:id", (c) => c.json({}));\n');
    expect(endpointsOf(root)).toEqual(["GET /api/authors", "GET /api/authors/:id", "GET /api/books", "GET /api/books/:id", "GET /api/health", "POST /api/books"]);
  });

  it("Express: app.use() of a required router", () => {
    const root = tempDir();
    put(root, "server.js", 'const express = require("express");\nconst items = require("./routes/items");\nconst app = express();\napp.use("/items", items);\napp.listen(3000);\n');
    put(root, "routes/items.js", 'const express = require("express");\nconst router = express.Router();\nrouter.get("/", (req, res) => res.json([]));\nrouter.delete("/:id", (req, res) => res.sendStatus(204));\nmodule.exports = router;\n');
    expect(endpointsOf(root)).toEqual(["DELETE /items/:id", "GET /items"]);
  });

  it("FastAPI: APIRouter(prefix) included with include_router(prefix)", () => {
    const root = tempDir();
    put(root, "app/main.py", 'from fastapi import FastAPI\nfrom app.routers import users\n\napp = FastAPI()\napp.include_router(users.router, prefix="/v1")\n\n\n@app.get("/health")\ndef health():\n    return {"ok": True}\n');
    put(root, "app/routers/users.py", 'from fastapi import APIRouter\n\nrouter = APIRouter(prefix="/users", tags=["users"])\n\n\n@router.get("")\ndef list_users():\n    return []\n\n\n@router.get("/{user_id}")\ndef get_user(user_id: int):\n    return {}\n\n\n@router.post("")\ndef create_user():\n    return {}\n');
    expect(endpointsOf(root)).toEqual(["GET /health", "GET /v1/users", "GET /v1/users/{user_id}", "POST /v1/users"]);
  });
});

describe("contract drift", () => {
  function nextProject() {
    const root = tmpProject();
    put(root, "package.json", { dependencies: { next: "16.0.0" } });
    put(root, "app/api/habits/route.ts", "export async function GET() {}\nexport async function POST() {}\n");
    put(root, "app/api/habits/[id]/route.ts", "export async function GET() {}\nexport async function DELETE() {}\n");
    return root;
  }
  const contract = (paths: string) => `openapi: 3.1.0\ninfo: { title: habits, version: "1" }\nservers:\n  - url: https://habits.example/api\npaths:\n${paths}`;

  it("finds operations the code lacks and endpoints the contract lacks, and gates gap", async () => {
    const root = nextProject();
    put(root, "contracts/openapi.yaml", contract("  /habits:\n    get: {}\n    post: {}\n  /habits/{habitId}:\n    get: {}\n  /habits/{habitId}/checkins:\n    post: {}\n"));
    const report = contractDrift(root);
    expect(report).toMatchObject({ contract: "contracts/openapi.yaml", operations: 4, endpoints: 4 });
    expect(report.missing).toEqual([expect.objectContaining({ method: "POST", path: "/api/habits/{habitId}/checkins" })]);
    expect(report.undocumented).toEqual([{ method: "DELETE", route: "/api/habits/:id", file: "app/api/habits/[id]/route.ts" }]);

    const stage = findStage("gap")!;
    const gate = await BUILTINS["gap.contractDrift"]!({ root, config: loadConfig(root), stage, state: new Forge(root).readState() });
    expect(gate).toMatchObject({ status: "fail", message: expect.stringMatching(/missing POST \/api\/habits\/\{habitId\}\/checkins; undocumented DELETE \/api\/habits\/:id/) });

    put(root, "contracts/openapi.yaml", contract("  /habits:\n    get: {}\n    post: {}\n  /habits/{habitId}:\n    get: {}\n    delete: {}\n"));
    expect(await BUILTINS["gap.contractDrift"]!({ root, config: loadConfig(root), stage, state: new Forge(root).readState() })).toMatchObject({ status: "pass" });
  });

  it("matches routers mounted under a prefix it cannot see only by a literal tail, and honours contractIgnore", () => {
    const root = tmpProject();
    put(root, "api/users.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n\n@router.get("/users/{user_id}")\ndef get_user(user_id: int): ...\n\n@router.get("/{anything}")\ndef any_route(anything: str): ...\n');
    put(root, "api/main.py", 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/health")\ndef health(): ...\n');
    put(root, "contracts/openapi.yaml", "openapi: 3.1.0\ninfo: { title: t, version: '1' }\npaths:\n  /v2/users/{id}:\n    get: {}\n  /v2/orders/{id}:\n    get: {}\n");
    const report = contractDrift(root);
    expect(report.suffixMatches).toEqual([{ operation: "GET /v2/users/{id}", route: "/users/{user_id}", file: "api/users.py" }]);
    expect(report.missing.map((m) => m.path)).toEqual(["/v2/orders/{id}"]); // "/{anything}" is not trusted as a match
    expect(report.undocumented.map((u) => u.route)).toEqual(["/{anything}"]); // GET /health is ignored by default
  });

  it("skips when there is no contract", async () => {
    const root = nextProject();
    expect(await BUILTINS["gap.contractDrift"]!({ root, config: loadConfig(root), stage: findStage("gap")!, state: new Forge(root).readState() })).toMatchObject({ status: "skip" });
  });
});

describe("web ↔ mobile parity", () => {
  it("needs screens on every targeted UI platform for each MVP story, with explicit exemptions", async () => {
    const root = tmpProject();
    writeArtifact(root, "prd", prd());
    writeArtifact(root, "screens", {
      screens: [
        { id: "checkin-web", storyIds: ["S-1"], route: "/checkin", platform: "web", states: ["empty", "loading", "error", "success"] },
        { id: "checkin-app", storyIds: ["S-1"], route: "/checkin", platform: "ios", states: ["empty", "loading", "error", "success"] },
        { id: "reminders-web", storyIds: ["S-2"], route: "/reminders", platform: "web", states: ["empty", "loading", "error", "success"] },
      ],
    });
    const stage = findStage("gap")!;
    const gate = () => BUILTINS["gap.parity"]!({ root, config: loadConfig(root), stage, state: new Forge(root).readState() });

    expect(await gate()).toMatchObject({ status: "skip" }); // platforms: [web]
    editConfig(root, (text) => text.replace("platforms: [web]", "platforms: [web, ios, android, api]"));
    expect(platformParity(root)).toMatchObject({ groups: ["web", "mobile"], gaps: [{ id: "S-2", missing: ["mobile"] }] });
    expect(await gate()).toMatchObject({ status: "fail", message: expect.stringMatching(/S-2 \(no mobile\)/) });
    editConfig(root, (text) => text.replace("parityExempt: []", "parityExempt: [S-2]"));
    expect(await gate()).toMatchObject({ status: "pass", message: expect.stringMatching(/1 exempt/) });
  });
});

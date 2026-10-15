import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createForgeServer } from "../src/mcp/server.js";
import { brainstorm, isolate, tempDir } from "./helpers.js";

isolate();

async function connect(root: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createForgeServer(root).connect(serverTransport);
  const client = new Client({ name: "forge-test", version: "0.0.0" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: result.content[0]?.text ?? "", isError: result.isError === true };
  };
  return { client, call };
}

describe("MCP server", () => {
  it("exposes the pipeline, memory and trace tools with instructions", async () => {
    const { client } = await connect(tempDir());
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["forge_status", "stage_start", "stage_complete", "artifact_write", "memory_query", "ledger_add", "trace_gaps", "graph_status"]) {
      expect(names).toContain(name);
    }
    expect(client.getInstructions()).toMatch(/Never fabricate evidence/);
  });

  it("lists, records and explains stack packs", async () => {
    const root = tempDir();
    const { call } = await connect(root);
    await call("project_init", { name: "stack-app" });
    mkdirSync(join(root, "api"), { recursive: true });
    writeFileSync(join(root, "api", "requirements.txt"), "fastapi\npytest\n");
    const list = JSON.parse((await call("stack_list")).text) as { packs: { id: string }[]; detected: { pack: string; dir: string; commands: { test?: string } }[] };
    expect(list.packs.map((p) => p.id)).toContain("supabase");
    expect(list.detected).toEqual([expect.objectContaining({ pack: "fastapi", dir: "api", commands: { test: expect.stringMatching(/-m pytest -q$/) } })]);
    const used = JSON.parse((await call("stack_use")).text) as { set: { test?: string } };
    expect(used.set.test).toMatch(/^cd api && .*-m pytest -q$/);
    const info = JSON.parse((await call("stack_info", { pack: "node-hono", dir: "svc" })).text) as { scaffold: { command: string }; lens: string };
    expect(info.scaffold.command).toMatch(/create-hono@latest svc --template nodejs/);
    expect(info.lens).toMatch(/## Review lens/);
    expect((await call("stack_info", { pack: "rails" })).isError).toBe(true);
  });

  it("serves the shipped playbooks through the guide tool, and only those", async () => {
    const { call } = await connect(tempDir());
    const list = JSON.parse((await call("guide")).text) as string[];
    expect(list).toEqual(expect.arrayContaining(["skills/validate-idea", "rubrics/validation", "rules/process-lifecycle"]));
    expect((await call("guide", { name: "skills/validate-idea" })).text).toMatch(/evidence_save/);
    expect((await call("guide", { name: "rubrics/prd.md" })).text).toMatch(/Rubric — PRD/);
    const traversal = await call("guide", { name: "../../package" });
    expect(traversal.isError).toBe(true);
  });

  it("drives a stage end to end and returns tool errors instead of throwing", async () => {
    const root = tempDir();
    const { call } = await connect(root);

    expect((await call("forge_status")).text).toMatch(/forge init/);
    expect((await call("project_init", { name: "mcp-app" })).isError).toBe(false);
    expect(JSON.parse((await call("forge_status")).text).next).toBe("brainstorm");

    await call("stage_start", { stage: "brainstorm" });
    const invalid = await call("artifact_write", { name: "brainstorm", data: { ideas: [] } });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toMatch(/does not match its schema/);

    expect((await call("artifact_write", { name: "brainstorm", data: brainstorm("I-1") })).isError).toBe(false);
    const gate = JSON.parse((await call("stage_complete", { stage: "brainstorm" })).text);
    expect(gate.passed).toBe(true);

    await call("ledger_add", { summary: "Target busy professionals", why: "highest pain frequency", rejected: ["students"] });
    const memory = JSON.parse((await call("memory_query", { question: "why busy professionals?" })).text);
    expect(memory.answer).toMatch(/Target busy professionals/);
  });
});

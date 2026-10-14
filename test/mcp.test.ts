import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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

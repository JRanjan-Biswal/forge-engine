import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function listGuides(): string[];
export declare function readGuide(name: string): string;
export declare function createForgeServer(root?: string): McpServer;
/**
 * Serve over stdio and never outlive the host: exit when stdin closes (host
 * disconnected), on SIGINT/SIGTERM/SIGHUP, or if the parent process disappears
 * without closing the pipe — so abandoned MCP servers cannot pile up in RAM.
 */
export declare function startStdioServer(root?: string): Promise<void>;

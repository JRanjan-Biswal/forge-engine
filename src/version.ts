import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Read from package.json so the CLI, MCP server and npm never disagree. */
export const VERSION: string = (require("../package.json") as { version: string }).version;

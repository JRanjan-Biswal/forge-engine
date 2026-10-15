import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only forge's own tests — e2e/fixtures contains an app with its own node:test suite.
    include: ["test/**/*.test.ts"],
    // RAM protection (rules/process-lifecycle.md): at most two test workers.
    pool: "forks",
    maxWorkers: 2,
  },
});

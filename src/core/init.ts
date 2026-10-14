import { existsSync, mkdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { StageState, type State } from "../schemas/runtime.js";
import { defaultConfigYaml, loadConfig } from "./config.js";
import { appendLedger } from "./ledger.js";
import { withLock } from "./lock.js";
import { layout, nowIso, writeJsonAtomic, writeTextAtomic } from "./paths.js";
import { enabledStages } from "./stages.js";

export interface InitOptions {
  name?: string;
  /** Re-create state.json even if the project is already initialised (the ledger is kept). */
  force?: boolean;
}

export interface InitResult {
  root: string;
  created: string[];
  alreadyInitialized: boolean;
}

export function initProject(rootInput: string, options: InitOptions = {}): InitResult {
  const root = resolve(rootInput);
  // Locked so two concurrent inits cannot interleave.
  return withLock(root, () => initUnlocked(root, options));
}

function initUnlocked(root: string, options: InitOptions): InitResult {
  const paths = layout(root);
  const created: string[] = [];
  if (existsSync(paths.state) && !options.force) return { root, created, alreadyInitialized: true };

  if (!existsSync(paths.config)) {
    writeTextAtomic(paths.config, defaultConfigYaml(options.name ?? basename(root)));
    created.push("forge.config.yaml");
  }
  for (const dir of [paths.artifacts, paths.gates, paths.episodes, paths.graphDir, paths.reviews, paths.releases, paths.adr]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`${relative(root, dir)}/`);
    }
  }

  const config = loadConfig(root);
  const now = nowIso();
  const state: State = {
    version: 1,
    project: config.project,
    createdAt: now,
    updatedAt: now,
    current: null,
    stages: Object.fromEntries(enabledStages(config).map((stage) => [stage.id, StageState.parse({})])),
    approvals: {},
    blockers: [],
  };
  writeJsonAtomic(paths.state, state);
  created.push(".forge/state.json");

  if (!existsSync(paths.trace)) {
    writeJsonAtomic(paths.trace, { nodes: [], edges: [] });
    created.push(".forge/graph/trace.json");
  }
  if (!existsSync(paths.learnings)) {
    writeTextAtomic(paths.learnings, "# Learnings\n\n");
    created.push(".forge/learnings.md");
  }
  const gitignore = `${paths.forge}/.gitignore`;
  if (!existsSync(gitignore)) {
    writeTextAtomic(gitignore, "# local-only forge files\nindex.db\ncache/\n*.tmp\n");
    created.push(".forge/.gitignore");
  }

  appendLedger(root, { kind: "init", summary: `Initialized forge project "${state.project}"`, by: "forge" });
  return { root, created, alreadyInitialized: false };
}

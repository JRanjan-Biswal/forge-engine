import type { z } from "zod";
import * as artifacts from "./artifacts.js";
import * as runtime from "./runtime.js";
import { EvidenceStore } from "../evidence/store.js";
import * as product from "./product.js";
import * as stack from "./stack.js";

export * from "./common.js";
export * from "./artifacts.js";
export * from "./runtime.js";
export * from "./product.js";
export * from "./stack.js";

/** Every published schema, keyed by the file name used by `forge schemas export`. */
export const PUBLISHED_SCHEMAS: Record<string, z.ZodType> = {
  brainstorm: artifacts.Brainstorm,
  vision: artifacts.Vision,
  validation: artifacts.Validation,
  competitors: artifacts.Competitors,
  personas: artifacts.Personas,
  prd: artifacts.Prd,
  screens: artifacts.Screens,
  motion: artifacts.Motion,
  tasks: artifacts.Tasks,
  reviews: artifacts.Reviews,
  trace: artifacts.Trace,
  release: artifacts.Release,
  rubric: artifacts.RubricResult,
  state: runtime.State,
  "gate-check": runtime.GateCheck,
  "gate-result": runtime.GateResult,
  "ledger-entry": runtime.LedgerEntry,
  "evidence-store": EvidenceStore,
  "product-map": product.ProductMap,
  "product-model": product.ProductModel,
  "page-audit": product.PageAudit,
  "stack-pack": stack.StackPack,
};

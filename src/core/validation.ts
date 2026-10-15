import type { z } from "zod";
import type { Validation, ValidationCriterion } from "../schemas/artifacts.js";
import { validationScore } from "./gates.js";

type CriterionInput = z.input<typeof ValidationCriterion>;

/**
 * The standard binary scorecard. Each question is answered yes / no / unknown,
 * and every "yes" must cite saved evidence. Weights reflect how much each
 * criterion predicts whether the idea is worth building.
 */
export const STANDARD_CRITERIA: Omit<CriterionInput, "answer">[] = [
  { id: "C-01", group: "problem", weight: 2, question: "Do at least 5 independent sources describe this pain in their own words?" },
  { id: "C-02", group: "problem", weight: 1.5, question: "Is the pain frequent (weekly or more) for the target user?" },
  { id: "C-03", group: "problem", weight: 1.5, question: "Do people pay for, or hack together, a workaround today (spreadsheets, scripts, agencies)?" },
  { id: "C-04", group: "market", weight: 1, question: "Is there a reachable segment of at least 10k users or companies, with a cited source?" },
  { id: "C-05", group: "market", weight: 1, question: "Is there a concrete 'why now' (new technology, regulation, behaviour shift)?" },
  { id: "C-06", group: "competition", weight: 1, question: "Do competitors or substitutes exist (proof of demand)?" },
  { id: "C-07", group: "competition", weight: 1.5, question: "Is there a documented gap — e.g. recurring review complaints — that this idea specifically solves?" },
  { id: "C-08", group: "differentiation", weight: 1.5, question: "Is there an 'only we' claim that no analysed competitor makes?" },
  { id: "C-09", group: "feasibility", weight: 1, question: "Can an MVP be built with available APIs and stack in 4 weeks or less?" },
  { id: "C-10", group: "distribution", weight: 1.5, question: "Is there a concrete first channel to reach the first 100 users?" },
  { id: "C-11", group: "monetization", weight: 1, question: "Is there evidence of willingness to pay (competitor pricing, budgets, paid workarounds)?" },
  { id: "C-12", group: "risk", weight: 1, question: "Is the idea free of blocking legal, regulatory or platform risks?" },
];

export function validationTemplate(idea: string): z.input<typeof Validation> {
  return {
    idea,
    criteria: STANDARD_CRITERIA.map((criterion) => ({ ...criterion, answer: "unknown", evidence: [] })),
    score: 0,
    verdict: "needs-experiment",
    risks: [],
    experiments: [],
  };
}

export interface ScoreReport {
  score: number;
  yes: string[];
  no: string[];
  unknown: string[];
  unsupportedYes: string[];
  /** A suggestion only — the verdict is a judgement for the scorer agent and the human. */
  suggestedVerdict: Validation["verdict"];
  reason: string;
}

export function scoreValidation(criteria: Validation["criteria"], minScore = 65): ScoreReport {
  const ids = (answer: string) => criteria.filter((c) => c.answer === answer).map((c) => c.id);
  const score = validationScore({ criteria } as Validation);
  const unknown = ids("unknown");
  const unsupportedYes = criteria.filter((c) => c.answer === "yes" && c.evidence.length === 0).map((c) => c.id);
  const unknownShare = unknown.length / Math.max(criteria.length, 1);
  let suggestedVerdict: Validation["verdict"];
  let reason: string;
  if (unknownShare > 0.4) {
    suggestedVerdict = "needs-experiment";
    reason = `${unknown.length}/${criteria.length} criteria are unknown — run the cheapest experiment before deciding`;
  } else if (score >= minScore) {
    suggestedVerdict = "go";
    reason = `score ${score} ≥ ${minScore}`;
  } else if (score >= 40) {
    suggestedVerdict = "pivot";
    reason = `score ${score} is below ${minScore} but above 40 — look for a better segment, problem or channel`;
  } else {
    suggestedVerdict = "kill";
    reason = `score ${score} < 40`;
  }
  return { score, yes: ids("yes"), no: ids("no"), unknown, unsupportedYes, suggestedVerdict, reason };
}

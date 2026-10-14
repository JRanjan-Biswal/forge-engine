import type { z } from "zod";

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("\n");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a dotted path such as "criteria.0.answer" or "antiGoals.length".
 * Returns undefined when any segment is missing.
 */
export function getPath(value: unknown, pointer: string): unknown {
  let current: unknown = value;
  for (const segment of pointer.split(".").filter(Boolean)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = segment === "length" ? current.length : current[Number(segment)];
    } else if (typeof current === "string") {
      current = segment === "length" ? current.length : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

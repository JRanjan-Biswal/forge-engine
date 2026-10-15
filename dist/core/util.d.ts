import type { z } from "zod";
export declare function formatIssues(error: z.ZodError): string;
export declare function errorMessage(error: unknown): string;
/**
 * Read a dotted path such as "criteria.0.answer" or "antiGoals.length".
 * Returns undefined when any segment is missing.
 */
export declare function getPath(value: unknown, pointer: string): unknown;
export declare function firstLine(text: string): string;
export declare function tail(text: string, maxChars: number): string;

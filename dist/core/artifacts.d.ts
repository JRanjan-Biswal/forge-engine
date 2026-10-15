import type { z } from "zod";
export interface ArtifactDef {
    name: string;
    /** Path relative to the project root. */
    path: string;
    format: "json" | "text";
    description: string;
    schema?: z.ZodType;
}
export declare const ARTIFACTS: Readonly<Record<string, ArtifactDef>>;
export declare class ArtifactError extends Error {
    name: string;
}
export declare function getArtifactDef(name: string): ArtifactDef;
export interface ArtifactCheck {
    name: string;
    path: string;
    exists: boolean;
    valid: boolean;
    errors: string[];
}
export declare function checkArtifact(root: string, name: string): ArtifactCheck;
/**
 * Load a JSON artifact with schema defaults applied. Returns undefined when the
 * file does not exist and throws ArtifactError when it exists but is invalid.
 */
export declare function loadArtifact<T>(root: string, name: string): T | undefined;
export declare function readArtifactText(root: string, name: string): string | undefined;
/** Validate then write. JSON artifacts may be passed as objects or JSON strings. */
export declare function writeArtifact(root: string, name: string, data: unknown): {
    path: string;
};
export declare function listArtifacts(root: string): ArtifactCheck[];

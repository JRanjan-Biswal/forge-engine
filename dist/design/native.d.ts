import type { Token } from "./tokens.js";
export declare function exportNative(base: Map<string, Token>, themes: Record<string, Map<string, Token>>): {
    dart: string;
    swift: string;
    kotlin: string;
};

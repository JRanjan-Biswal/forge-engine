export function formatIssues(error) {
    return error.issues
        .map((issue) => `  - ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
        .join("\n");
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Read a dotted path such as "criteria.0.answer" or "antiGoals.length".
 * Returns undefined when any segment is missing.
 */
export function getPath(value, pointer) {
    let current = value;
    for (const segment of pointer.split(".").filter(Boolean)) {
        if (current === null || current === undefined)
            return undefined;
        if (Array.isArray(current)) {
            current = segment === "length" ? current.length : current[Number(segment)];
        }
        else if (typeof current === "string") {
            current = segment === "length" ? current.length : undefined;
        }
        else if (typeof current === "object") {
            current = current[segment];
        }
        else {
            return undefined;
        }
    }
    return current;
}
export function firstLine(text) {
    return text.split("\n", 1)[0] ?? "";
}
export function tail(text, maxChars) {
    return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

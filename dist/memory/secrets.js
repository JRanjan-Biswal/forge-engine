/**
 * Memory is committed to git, so nothing that looks like a credential may be written
 * into it. These patterns are deliberately conservative (few false positives).
 */
const PATTERNS = [
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
    ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g],
    ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
    ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
    ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
    ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
    ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
];
export class SecretError extends Error {
    name = "SecretError";
}
export function findSecrets(text) {
    const found = new Set();
    for (const [label, pattern] of PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text))
            found.add(label);
    }
    return [...found];
}
/** Throw before writing user-provided text that looks like it contains a secret. */
export function assertNoSecrets(text, where) {
    const found = findSecrets(text);
    if (found.length) {
        throw new SecretError(`Refusing to write ${where}: it looks like it contains a secret (${found.join(", ")}). ` +
            "Keep secrets in environment variables or your host's secret store.");
    }
}
/** Replace secret-looking substrings, for machine-generated text such as command output. */
export function redactSecrets(text) {
    let result = text;
    for (const [, pattern] of PATTERNS) {
        pattern.lastIndex = 0;
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}

// The one place forge reads its environment: PATH lookups, FORGE_* overrides and CI detection.
// Values here are settings, never account data — except the deploy bypass variable a stack pack
// names, which ship/deploy.ts reads through setting() and sends only to the user's own deployment.
import { accessSync, constants, existsSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join } from "node:path";
/** A forge override or CI variable (FORGE_BROWSER, FORGE_HOME, GITHUB_ACTIONS, …). */
export function setting(name) {
    return process.env[name];
}
/** Environment for a child process: forge's own plus the given overrides. */
export function childEnv(extra) {
    return { ...process.env, ...extra };
}
/** Full path of a program on PATH (with Windows extensions), or null. */
export function findOnPath(bin, { executable = false } = {}) {
    const exts = process.platform === "win32" ? (setting("PATHEXT") ?? ".EXE;.CMD").split(";") : [""];
    for (const dir of (setting("PATH") ?? "").split(delimiter)) {
        if (!dir)
            continue;
        for (const ext of exts) {
            const candidate = join(dir, bin + ext);
            if (!existsSync(candidate))
                continue;
            if (!executable)
                return candidate;
            try {
                accessSync(candidate, constants.X_OK);
                return candidate;
            }
            catch {
                // present but not runnable — keep looking
            }
        }
    }
    return null;
}
/** Who approved or saved something: the OS user name. */
export function currentUser() {
    try {
        return setting("USER") ?? userInfo().username;
    }
    catch {
        return "human";
    }
}

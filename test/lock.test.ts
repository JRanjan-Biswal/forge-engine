import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLock } from "../src/core/lock.js";
import { isolate, tempDir } from "./helpers.js";

isolate();

describe("project lock", () => {
  it("is reentrant within a process and released afterwards", () => {
    const root = tempDir();
    const lock = join(root, ".forge", ".lock");
    const value = withLock(root, () => {
      expect(existsSync(lock)).toBe(true);
      return withLock(root, () => 42);
    });
    expect(value).toBe(42);
    expect(existsSync(lock)).toBe(false);
  });

  it("is released when the locked work throws", () => {
    const root = tempDir();
    expect(() =>
      withLock(root, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(join(root, ".forge", ".lock"))).toBe(false);
    expect(withLock(root, () => "again")).toBe("again");
  });

  it("breaks a stale lock left by a process that no longer exists", () => {
    const root = tempDir();
    mkdirSync(join(root, ".forge"), { recursive: true });
    writeFileSync(join(root, ".forge", ".lock"), "2147483646"); // a pid that is not running
    expect(withLock(root, () => "acquired")).toBe("acquired");
  });
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/server.js";
import { createStore } from "../src/store.js";

const freshStore = () => createStore(join(mkdtempSync(join(tmpdir(), "habit-")), "db.json"));

test("S-1: each check-in increments the streak @S-1/AC1", () => {
  const store = freshStore();
  assert.equal(store.checkIn("run"), 1);
  assert.equal(store.checkIn("run"), 2);
});

test("S-1: POST /checkins requires a habit", async () => {
  const server = createApp(freshStore()).listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/checkins`, { method: "POST" });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

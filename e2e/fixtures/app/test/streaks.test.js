import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/server.js";
import { createStore } from "../src/store.js";

test("S-2: GET /streaks lists every habit's streak", async () => {
  const store = createStore(join(mkdtempSync(join(tmpdir(), "habit-")), "db.json"));
  const server = createApp(store).listen(0);
  try {
    const { port } = server.address();
    await fetch(`http://127.0.0.1:${port}/checkins?habit=read`, { method: "POST" });
    const res = await fetch(`http://127.0.0.1:${port}/streaks`);
    assert.equal(res.status, 200);
    assert.ok("read" in (await res.json()));
  } finally {
    server.close();
  }
});

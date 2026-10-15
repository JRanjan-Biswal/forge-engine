import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.js";

/** Habit-coach API: POST /checkins?habit=<name>, GET /streaks, GET /health. */
export function createApp(store = createStore()) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });
    if (req.method === "POST" && url.pathname === "/checkins") {
      const habit = url.searchParams.get("habit");
      if (!habit) return send(400, { error: "habit is required" });
      return send(201, { habit, streak: store.checkIn(habit) });
    }
    if (req.method === "GET" && url.pathname === "/streaks") return send(200, store.all());
    return send(404, { error: "not found" });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`habit-coach listening on ${port}`));
}

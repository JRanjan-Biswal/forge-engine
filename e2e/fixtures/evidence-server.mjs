// Local stand-in for "the web" in the e2e suite: pages that contain the fixture quotes.
// Runs as its own process (the harness blocks its event loop while forge runs), prints
// {"port":N} once listening, and exits on SIGTERM or when its parent closes stdin.
import { createServer } from "node:http";

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const source = /^\/e2e-source-(\d+)$/.exec(path);
  if (source) {
    res.writeHead(200, { "content-type": "text/html" }).end(`<html><body><p>synthetic fixture quote ${source[1]} — e2e page</p></body></html>`);
  } else if (/^\/e2e-review-\d+$/.test(path)) {
    res.writeHead(200, { "content-type": "text/html" }).end("<p>Review: too many notifications, I uninstalled.</p>");
  } else if (path === "/blocked") {
    res.writeHead(403).end("forbidden");
  } else {
    res.writeHead(404).end();
  }
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.stdin.on("end", stop);
process.stdin.resume();
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ port: server.address().port })));

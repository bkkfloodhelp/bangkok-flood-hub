// Tiny static file server for the dev test scripts. It can be stopped and restarted on the same
// port (to simulate losing signal), and individual paths can be replaced or made to 404.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png",
};

// overrides: { "/data/flood.json": "<new content>" | Buffer | null (null = 404) }
export function serve(dir, port = 0, overrides = {}) {
  const root = normalize(dir + sep);
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const type = TYPES[extname(p)] || "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "no-cache" };
    if (p in overrides) {
      if (overrides[p] === null) { res.writeHead(404).end(); return; }
      res.writeHead(200, headers).end(overrides[p]);
      return;
    }
    const file = normalize(join(root, p));
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, headers).end(readFileSync(file));
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r(server)));
}

export function stop(server) {
  server.closeAllConnections();
  return new Promise(r => server.close(r));
}

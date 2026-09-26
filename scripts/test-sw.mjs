#!/usr/bin/env node
// End-to-end test of the service worker and both emergency off-switches, in real headless Chrome.
// No dependencies (Node 22+ for the built-in WebSocket). Does not modify your files: the site is
// copied to a temp folder and each scenario uses a fresh Chrome profile.
//
//   node scripts/test-sw.mjs
//
// Set CHROME_PATH if Chrome is not found automatically. Exit code 0 = all checks passed.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE_FILES = ["index.html", "style.css", "app.js", "sw.js", "data", "fonts", "scripts/sw-disable.js"];
const WAIT_MS = 12000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (typeof WebSocket !== "function") {
  console.error("This test needs Node 22 or later (built-in WebSocket). You have " + process.version);
  process.exit(1);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = candidates.find(p => p && existsSync(p));
  if (!found) {
    console.error("Chrome not found. Set CHROME_PATH=/path/to/chrome and try again.");
    process.exit(1);
  }
  return found;
}
const CHROME = findChrome();

// ---------- tiny static server that can be switched off to simulate "no signal" ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

function serve(dir, port) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(dir, p));
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(readFileSync(file));
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r(server)));
}

function stop(server) {
  server.closeAllConnections();
  return new Promise(r => server.close(r));
}

// ---------- Chrome via the DevTools protocol ----------

async function launchChrome(profile) {
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error("Chrome did not start");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { proc, ws, send };
}

// What the page and browser look like right now.
const REPORT = `(async () => {
  const n = document.getElementById("notice");
  const regs = await navigator.serviceWorker.getRegistrations();
  return {
    shelters: document.querySelectorAll("#shelters .name").length,
    notice: !!(n && !n.hidden),
    controlled: !!navigator.serviceWorker.controller,
    fonts: (await document.fonts.ready, [...document.fonts].filter(f => f.status === "loaded").length),
    workers: regs.filter(r => r.active).length,
    caches: (await caches.keys()).filter(k => k.startsWith("flood-hub-")).length,
  };
})()`;

// ---------- test runner ----------

let failures = 0;
function check(ok, label, detail) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
}

async function scenario(title, applyOffSwitch) {
  console.log(`\n${title}`);
  const site = mkdtempSync(join(tmpdir(), "flood-site-"));
  const profile = mkdtempSync(join(tmpdir(), "flood-chrome-"));
  for (const f of SITE_FILES) cpSync(join(ROOT, f), join(site, f.replace(/^scripts\//, "")), { recursive: true });

  // Pick a free port once; the origin must stay the same when the server is restarted.
  const probe = await serve(site, 0);
  const port = probe.address().port;
  await stop(probe);
  const url = `http://127.0.0.1:${port}/`;

  const chrome = await launchChrome(profile);
  let server = await serve(site, port);

  // Navigate, then poll until `until(state)` holds or time runs out. Returns the last state,
  // or null if the page itself failed to load.
  async function visit(until) {
    const nav = await chrome.send("Page.navigate", { url });
    if (nav.result && nav.result.errorText) return null;
    let state = null;
    for (const start = Date.now(); Date.now() - start < WAIT_MS; await sleep(300)) {
      const r = await chrome.send("Runtime.evaluate", { expression: REPORT, awaitPromise: true, returnByValue: true });
      state = r.result && r.result.result && r.result.result.value;
      if (state && until(state)) break;
    }
    return state;
  }
  const show = s => JSON.stringify(s);

  try {
    let s = await visit(s => s.workers === 1 && s.caches === 1 && s.shelters > 0);
    check(s && s.fonts >= 2, "online: self-hosted fonts load", show(s));
    check(s && s.shelters > 0, "online: page renders shelters", show(s));
    check(s && s.workers === 1 && s.caches === 1, "online: service worker installed and site cached", show(s));

    s = await visit(s => s.controlled);
    check(s && s.controlled, "online, second visit: page is controlled by the worker", show(s));

    await stop(server);
    s = await visit(s => s.notice && s.shelters > 0 && s.fonts >= 2);
    check(s && s.shelters > 0, "offline: page still loads from the saved copy", show(s));
    check(s && s.notice, 'offline: "may be out of date" notice is shown', show(s));
    check(s && s.fonts >= 2, "offline: IBM Plex Sans Thai fonts load from the cache", show(s));

    applyOffSwitch(site);
    server = await serve(site, port);
    s = await visit(s => s.workers === 0 && s.caches === 0);
    check(s && s.workers === 0 && s.caches === 0, "off-switch: worker unregistered and caches deleted", show(s));
    s = await visit(s => !s.controlled && s.caches === 0);
    check(s && !s.controlled && s.caches === 0 && s.shelters > 0, "off-switch: next visit loads from the network, no caches left", show(s));

    await stop(server);
    s = await visit(() => true);
    check(s === null, "offline after off-switch: page does NOT load (nothing left on the phone)", show(s));
  } finally {
    await stop(server).catch(() => {});
    chrome.ws.close();
    chrome.proc.kill();
    await sleep(500);
    rmSync(site, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await scenario('Scenario 1: "serviceWorker": false in data/flood.json', site => {
  const file = join(site, "data/flood.json");
  writeFileSync(file, JSON.stringify({ serviceWorker: false, ...JSON.parse(readFileSync(file, "utf8")) }));
});

await scenario("Scenario 2: sw.js replaced with scripts/sw-disable.js", site => {
  cpSync(join(site, "sw-disable.js"), join(site, "sw.js"));
});

console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ All service worker checks passed");
process.exit(failures ? 1 : 0);

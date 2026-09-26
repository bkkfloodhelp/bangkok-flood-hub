// Shared helper for the dev scripts: start headless Chrome and talk to it over the DevTools
// protocol. No dependencies (Node 22+ for the built-in WebSocket). Set CHROME_PATH if Chrome
// is not found automatically.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  if (typeof WebSocket !== "function") {
    console.error("This script needs Node 22 or later (built-in WebSocket). You have " + process.version);
    process.exit(1);
  }
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

// Returns { proc, ws, send }. send(method, params) resolves with the raw protocol reply.
export async function launchChrome(profile) {
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`];
  // GitHub's Ubuntu runners block Chrome's sandbox; only relax it there, never on a real machine.
  if (process.env.GITHUB_ACTIONS === "true") args.push("--no-sandbox");
  const proc = spawn(findChrome(), [...args, "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error("Chrome did not start");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method) (listeners.get(d.method) || []).forEach(cb => cb(d.params));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // on("Network.responseReceived", params => ...) — protocol events (enable the domain first).
  const on = (method, cb) => listeners.set(method, [...(listeners.get(method) || []), cb]);
  return { proc, ws, send, on };
}

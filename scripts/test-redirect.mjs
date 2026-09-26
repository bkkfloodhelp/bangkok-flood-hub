#!/usr/bin/env node
// Tests the redirect site for the OLD address (made by make-redirect-site.mjs) in headless Chrome:
// a phone that saved the old site offline, a normal visit, and a browser without JavaScript must
// all end up on the matching page of the new site. Everything runs locally.
//   node scripts/test-redirect.mjs

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchChrome, sleep } from "./lib/chrome.mjs"; import { serve, stop } from "./lib/server.mjs"; import { buildPage, buildDamagePage } from "./embed-fallback.mjs";
const ROOT = new URL("..", import.meta.url).pathname;
const FILES = ["index.html","damage.html","style.css","render.js","lang.js","app.js","damage.js","sw.js","data","fonts","icon.svg","favicon-32.png","apple-touch-icon.png","og-image.png"];
function site() { const d = mkdtempSync(join(tmpdir(), "site-")); FILES.forEach(f => cpSync(join(ROOT, f), join(d, f), { recursive: true }));
  const data = JSON.parse(readFileSync(join(d, "data/flood.json"), "utf8"));
  writeFileSync(join(d, "index.html"), buildPage(readFileSync(join(d, "index.html"), "utf8"), data).html);
  writeFileSync(join(d, "damage.html"), buildDamagePage(readFileSync(join(d, "damage.html"), "utf8"), data)); return d; }
const oldSite = site(), newSite = site(), redirect = mkdtempSync(join(tmpdir(), "redir-"));
let fails = 0; const check = (ok, label, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : "  → " + detail}`); if (!ok) fails++; };

const probe = await serve(oldSite, 0); const P = probe.address().port; await stop(probe);
const newServer = await serve(newSite, 0); const NEW = `http://127.0.0.1:${newServer.address().port}/`, OLD = `http://127.0.0.1:${P}/`;
const c = await launchChrome(mkdtempSync(join(tmpdir(), "rd-")));
const q = async e => (await c.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
const at = async (url, ms = 3000) => { await c.send("Page.navigate", { url }); await sleep(ms); return q("location.href"); };

console.log("1. Old site live: a phone visits and saves it for offline");
let server = await serve(oldSite, P);
await at(OLD, 4000); await at(OLD, 3000);
check(await q(`navigator.serviceWorker.getRegistrations().then(r => r.length === 1)`) && await q(`caches.keys().then(k => k.some(x => x.startsWith("flood-hub-")))`), "old site's service worker and offline copy installed");
await stop(server);

console.log("2. Old address now serves the redirect site");
execFileSync("node", [join(ROOT, "scripts/make-redirect-site.mjs"), redirect, NEW, "/"]);
server = await serve(redirect, P);
let href = await at(OLD, 4000);
check(href === NEW, "old home page → new home page", href);
check(await q(`document.querySelectorAll("#shelters .name").length > 0`), "new site actually loaded (shelters shown)");
href = await at(OLD + "damage.html?from=line#step-2", 3000);
check(href === NEW + "damage.html?from=line#step-2", "old damage.html?query#hash → same on new site", href);
href = await at(OLD + "index.html", 3000);
check(href === NEW, "old /index.html → new home page", href);
// Look at the OLD origin's storage from a non-HTML file there (no redirect runs on it).
await c.send("Page.navigate", { url: OLD + "sw.js" }); await sleep(1500);
const regs = await q(`navigator.serviceWorker.getRegistrations().then(r => r.length)`);
const cachesLeft = await q(`caches.keys().then(k => k.filter(x => x.startsWith("flood-hub-")).length)`);
check(regs === 0 && cachesLeft === 0, "old site's service worker and offline copy removed from the phone", `registrations ${regs}, caches ${cachesLeft}`);
c.proc.kill();

console.log("3. Without JavaScript");
const c2 = await launchChrome(mkdtempSync(join(tmpdir(), "rd2-")));
await c2.send("Emulation.setScriptExecutionDisabled", { value: true });
await c2.send("Page.navigate", { url: OLD }); await sleep(3500);
const href2 = (await c2.send("Runtime.evaluate", { expression: "location.href", returnByValue: true })).result.result.value;
check(href2 === NEW, "meta refresh takes you to the new home page", href2);
await c2.send("Page.navigate", { url: OLD + "damage.html" }); await sleep(3500);
const href3 = (await c2.send("Runtime.evaluate", { expression: "location.href", returnByValue: true })).result.result.value;
check(href3 === NEW + "damage.html", "…and damage.html to the new damage.html", href3);
c2.proc.kill();
await stop(server); await stop(newServer);
console.log(fails ? `\n✗ ${fails} failed` : "\n✓ Redirect site works: live visitors, cached phones, and no-JavaScript browsers all end up on the new site");
process.exit(fails ? 1 : 0);

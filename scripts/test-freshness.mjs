#!/usr/bin/env node
// Tests the red "over N hours old" warnings in headless Chrome, with timestamps set relative to
// the moment the test runs:
//   status box   > 6 hours   → "ข้อมูลสถานการณ์นี้เก่ากว่า 6 ชม." / "This update is over 6 hours old."
//   roads        > 6 hours   (newest listed road, or the road note) → the stale-roads warning
//   shelter note > 24 hours  → the shelter warning
// With JavaScript, each warning must appear exactly when its data is too old. Without JavaScript
// the page can't know the current time, so no warning appears and the fixed time is shown instead.
//
//   node scripts/test-freshness.mjs        (needs Node 22+ and Chrome)

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";
import { serve, stop } from "./lib/server.mjs";
import { buildPage } from "./embed-fallback.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const base = JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const ago = hours => new Date(Date.now() - hours * 3600e3 + 7 * 3600e3).toISOString().slice(0, 19) + "+07:00";
const road = (hours, type = "avoid") => ({ name: { th: `ถ.ทดสอบ ${hours} ชม.`, en: `Test Rd ${hours} h` }, type, updated: ago(hours), source: "Test" });

// times in hours ago; roads: list of hours ago for each listed road
function variant({ status, roadsNote, roads = [], shelters }) {
  const d = structuredClone(base);
  d.status.updated = ago(status);
  d.roadsNote = { ...d.roadsNote, updated: ago(roadsNote) };
  d.roads = roads.map(h => road(h));
  d.sheltersNote.updated = ago(shelters);
  d.lastUpdated = ago(Math.min(status, roadsNote, shelters, ...roads));
  return d;
}

const CASES = [
  { name: "everything fresh (1 h)", data: variant({ status: 1, roadsNote: 1, shelters: 1 }), want: { status: false, roads: false, shelters: false } },
  { name: "status 7 h old", data: variant({ status: 7, roadsNote: 1, shelters: 1 }), want: { status: true, roads: false, shelters: false } },
  { name: "status 5 h old", data: variant({ status: 5, roadsNote: 1, shelters: 1 }), want: { status: false, roads: false, shelters: false } },
  { name: "road note 7 h old, no roads listed", data: variant({ status: 1, roadsNote: 7, shelters: 1 }), want: { status: false, roads: true, shelters: false } },
  { name: "road note 5 h old, no roads listed", data: variant({ status: 1, roadsNote: 5, shelters: 1 }), want: { status: false, roads: false, shelters: false } },
  { name: "listed road 7 h old, road note fresh", data: variant({ status: 1, roadsNote: 1, roads: [7], shelters: 1 }), want: { status: false, roads: true, shelters: false } },
  { name: "listed road 1 h old, road note fresh", data: variant({ status: 1, roadsNote: 1, roads: [1], shelters: 1 }), want: { status: false, roads: false, shelters: false } },
  { name: "shelter note 23 h old", data: variant({ status: 1, roadsNote: 1, shelters: 23 }), want: { status: false, roads: false, shelters: false } },
  { name: "shelter note 25 h old", data: variant({ status: 1, roadsNote: 1, shelters: 25 }), want: { status: false, roads: false, shelters: true } },
  { name: "everything stale", data: variant({ status: 8, roadsNote: 8, roads: [8], shelters: 30 }), want: { status: true, roads: true, shelters: true } },
];

const STATE = `JSON.stringify((() => {
  const shown = id => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; };
  return {
    status: shown("status-stale"), roads: shown("roads-stale"), shelters: shown("shelters-stale"),
    ready: document.querySelectorAll("#district option").length > 1,
    ages: [...document.querySelectorAll("#status-fresh .age, #roads-note .age, #shelters-note .age")].map(a => a.innerText.trim()),
  };
})())`;

let failures = 0;
const check = (ok, label, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : "  → " + detail}`); if (!ok) failures++; };
const tmp = mkdtempSync(join(tmpdir(), "fresh-"));

async function run(js) {
  console.log(js ? "\nWith JavaScript" : "\nWithout JavaScript (the page can't know the time: no warnings, fixed times shown)");
  const chrome = await launchChrome(join(tmp, js ? "on" : "off"));
  if (!js) await chrome.send("Emulation.setScriptExecutionDisabled", { value: true });
  try {
    for (const c of js ? CASES : CASES.filter(x => x.name === "everything stale")) {
      // Page and live data built from the same variant, so the page can't swap in other data.
      const server = await serve(ROOT, 0, { "/index.html": buildPage(html, c.data).html, "/data/flood.json": JSON.stringify(c.data) });
      await chrome.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      let s;
      for (let i = 0; i < 30; i++) {
        await sleep(200);
        s = JSON.parse((await chrome.send("Runtime.evaluate", { expression: STATE, returnByValue: true })).result.result.value);
        if (!js || s.ready) break;
      }
      await stop(server);
      if (js) {
        const wrong = Object.keys(c.want).filter(k => s[k] !== c.want[k]).map(k => `${k} warning ${s[k] ? "shown" : "hidden"}, expected ${c.want[k] ? "shown" : "hidden"}`);
        check(!wrong.length, `${c.name}: ${Object.entries(c.want).filter(([, v]) => v).map(([k]) => k).join(" + ") || "no warnings"}`, wrong.join("; "));
      } else {
        check(!s.status && !s.roads && !s.shelters, "all data stale, but no warning shown (needs JavaScript)", JSON.stringify(s));
        check(s.ages.length === 3 && s.ages.every(a => /\d{1,2}:\d{2}/.test(a) && !/ที่แล้ว|ago/.test(a)),
          "status, road note and shelter note show their fixed update time", JSON.stringify(s.ages));
      }
    }
  } finally {
    chrome.ws.close();
    chrome.proc.kill();
  }
}

await run(true);
await run(false);
await sleep(300);
rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ All freshness warning checks passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
// Loads the built page in headless Chrome with JavaScript DISABLED and checks that the critical
// content is there without it: every hotline and every shelter phone number as a working,
// visible tel: link, plus the status message, shelter names and road list.
// The page is built from data/flood.json first (as the deploy does), so your files aren't changed.
//
//   node scripts/test-nojs.mjs        (needs Node 22+ and Chrome; set CHROME_PATH if needed)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";
import { serve, stop } from "./lib/server.mjs";
import { buildPage } from "./embed-fallback.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "test-output");
const data = JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
const { html } = buildPage(readFileSync(join(ROOT, "index.html"), "utf8"), data);
const telHref = n => "tel:" + n.replace(/-/g, "");

// Every link the page must have, straight from the data.
const expected = [
  ...data.hotlines.map(h => ({ what: `hotline ${h.number || h.display}`, href: h.number ? telHref(h.number) : h.url, text: h.number || h.display })),
  ...data.shelters.filter(s => s.tel).map(s => ({ what: `shelter "${s.name.th}"`, href: telHref(s.tel), text: s.tel })),
];

const PAGE_STATE = `JSON.stringify((() => {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const text = sel => { const el = document.querySelector(sel); return el && visible(el) ? el.innerText.trim() : ""; };
  return {
    jsRan: document.documentElement.classList.contains("js"),
    links: [...document.querySelectorAll("a[href]")].filter(visible).map(a => ({ href: a.getAttribute("href"), text: a.innerText.trim() })),
    status: text("#status-title"),
    shelterNames: [...document.querySelectorAll("#shelters .name")].filter(visible).map(e => e.innerText.trim()),
    roads: [...document.querySelectorAll("#roads li")].filter(visible).length,
    roadsNote: text("#roads-note"),
    englishShown: [...document.querySelectorAll("[data-en]")].some(visible),
    jsOnlyControlsShown: [...document.querySelectorAll(".lang, #district")].some(visible),
  };
})())`;

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : "  → " + detail}`);
  if (!ok) failures++;
}

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "nojs-"));
const server = await serve(ROOT, 0, { "/index.html": html });
const chrome = await launchChrome(join(tmp, "profile"));
try {
  const { send } = chrome;
  await send("Emulation.setScriptExecutionDisabled", { value: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await sleep(1500);
  const r = await send("Runtime.evaluate", { expression: PAGE_STATE, returnByValue: true });
  const s = JSON.parse(r.result.result.value);

  console.log("\nPage with JavaScript disabled (360px)");
  check(!s.jsRan, "JavaScript really is disabled", "the page's own script ran");
  for (const e of expected) {
    const link = s.links.find(l => l.href === e.href);
    check(!!link && link.text.includes(e.text), `${e.what}: visible link ${e.href}`,
      link ? `link shows "${link.text}"` : "missing or hidden");
  }
  check(s.status === data.status.title.th, "status message shown", `got "${s.status}"`);
  const missingNames = data.shelters.map(x => x.name.th).filter(n => !s.shelterNames.includes(n));
  check(!missingNames.length, `all ${data.shelters.length} shelter names shown`, missingNames.join(", "));
  check(s.roads === data.roads.length, `all ${data.roads.length} roads shown`, `${s.roads} shown`);
  if (data.roadsNote) check(s.roadsNote.startsWith(data.roadsNote.text.th), "road note shown", `got "${s.roadsNote.slice(0, 40)}"`);
  check(!s.englishShown, "only Thai is shown (English is hidden, as with JavaScript on)");
  check(!s.jsOnlyControlsShown, "language toggle and district filter are hidden (they need JavaScript)");

  const h = JSON.parse((await send("Runtime.evaluate", { expression: "JSON.stringify(document.documentElement.scrollHeight)", returnByValue: true })).result.result.value);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 360, height: h, scale: 1 } });
  writeFileSync(join(OUT, "360-nojs.png"), Buffer.from(shot.result.data, "base64"));
} finally {
  await stop(server);
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\nScreenshot: test-output/360-nojs.png`);
console.log(failures ? `✗ ${failures} check(s) failed` : "✓ All no-JavaScript checks passed");
process.exit(failures ? 1 : 0);

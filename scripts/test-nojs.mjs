#!/usr/bin/env node
// Loads the built page in headless Chrome with JavaScript DISABLED and checks that the critical
// content is there without it: every hotline and every shelter phone number as a working,
// visible tel: link, plus the status message, shelter names and road list, in both Thai and
// English (nobody can switch language without JavaScript, so both are shown together).
// The page is built from data/flood.json first (as the deploy does), so your files aren't changed.
//
//   node scripts/test-nojs.mjs        (needs Node 22+ and Chrome; set CHROME_PATH if needed)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";
import { serve, stop } from "./lib/server.mjs";
import { buildPage, buildDamagePage } from "./embed-fallback.mjs";
import { withSamples } from "./lib/samples.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "test-output");
// Real data, plus clearly-labelled sample tools / live-roads links if flood.json has none yet,
// so those sections are always checked without JavaScript too.
const data = withSamples(JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8")));
const { html } = buildPage(readFileSync(join(ROOT, "index.html"), "utf8"), data);
const telHref = n => "tel:" + n.replace(/-/g, "");

// Every link the page must have, straight from the data.
const expected = [
  ...data.hotlines.map(h => ({ what: `hotline ${h.number || h.display}`, href: h.number ? telHref(h.number) : h.url, text: h.number || h.display })),
  ...data.shelters.filter(s => s.tel).map(s => ({ what: `shelter "${s.name.th}"`, href: telHref(s.tel), text: s.tel })),
  { what: "live road flooding button", href: data.roadsLiveUrl, text: "เช็กถนนน้ำท่วมล่าสุด" },
  ...(data.roadsLiveUrlAlt ? [{ what: "live roads backup link", href: data.roadsLiveUrlAlt, text: "ลิงก์สำรอง" }] : []),
  ...data.tools.map(t => ({ what: `tool "${t.name.en}"`, href: t.url, text: t.name.th })),
];

const PAGE_STATE = `JSON.stringify((() => {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const text = sel => { const el = document.querySelector(sel); return el && visible(el) ? el.innerText.trim() : ""; };
  return {
    jsRan: document.documentElement.classList.contains("js"),
    links: [...document.querySelectorAll("a[href]")].filter(visible).map(a => ({ href: a.getAttribute("href"), text: a.innerText.trim() })),
    status: { th: text("#status-title [data-th]"), en: text("#status-title [data-en]") },
    shelterNames: {
      th: [...document.querySelectorAll("#shelters .name [data-th]")].filter(visible).map(e => e.innerText.trim()),
      en: [...document.querySelectorAll("#shelters .name [data-en]")].filter(visible).map(e => e.innerText.trim()),
    },
    roadNames: [...document.querySelectorAll("#roads .rn [data-en]")].filter(visible).length,
    roads: [...document.querySelectorAll("#roads li")].filter(visible).length,
    roadsNote: text("#roads-note"),
    // Visible English text (letters, no Thai) whose nearest lang attribute isn't "en".
    englishNotMarked: (() => {
      const bad = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue.trim(), el = n.parentElement;
        if (!/[A-Za-z]/.test(t) || /[\u0E00-\u0E7F]/.test(t) || el.closest("script, style") || !visible(el)) continue;
        const lang = el.closest("[lang]").getAttribute("lang");
        if (lang !== "en") bad.push('"' + t.slice(0, 30) + '" is lang="' + lang + '"');
      }
      return bad;
    })(),
    englishHidden: [...document.querySelectorAll("[data-en]")].filter(e => !e.closest("[hidden]") && !visible(e)).map(e => e.innerText.trim().slice(0, 30)),
    scrollWidth: document.documentElement.scrollWidth,
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
const damageHtml = buildDamagePage(readFileSync(join(ROOT, "damage.html"), "utf8"), data);
const server = await serve(ROOT, 0, { "/index.html": html, "/damage.html": damageHtml });
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
  check(s.status.th === data.status.title.th && s.status.en === data.status.title.en, "status message shown in Thai and English",
    `got "${s.status.th}" / "${s.status.en}"`);
  for (const lang of ["th", "en"]) {
    const missingNames = data.shelters.map(x => x.name[lang]).filter(n => !s.shelterNames[lang].includes(n));
    check(!missingNames.length, `all ${data.shelters.length} shelter names shown in ${lang === "th" ? "Thai" : "English"}`, missingNames.join(", "));
  }
  check(s.roadNames === data.roads.length, `all ${data.roads.length} road names shown in English too`, `${s.roadNames} shown`);
  check(s.roads === data.roads.length, `all ${data.roads.length} roads shown`, `${s.roads} shown`);
  if (data.roadsNote) check(s.roadsNote.startsWith(data.roadsNote.text.th), "road note shown", `got "${s.roadsNote.slice(0, 40)}"`);
  check(!s.englishHidden.length, "all English text is shown alongside the Thai", s.englishHidden.slice(0, 5).join(" | "));
  check(!s.englishNotMarked.length, 'every visible English text is marked lang="en"', s.englishNotMarked.slice(0, 5).join(" | "));
  check(s.scrollWidth <= 360, "no sideways scrolling at 360px with both languages shown", `page is ${s.scrollWidth}px wide`);
  check(!s.jsOnlyControlsShown, "language toggle and district filter are hidden (they need JavaScript)");
  const banner = s.links.filter(l => l.href === "damage.html");
  check(banner.length >= 1 && banner.some(l => l.text.includes("ดูวิธีเก็บหลักฐาน")) && banner.some(l => l.text.includes("See how to collect evidence")),
    "banner links to damage.html, in Thai and English", JSON.stringify(banner));

  const h = JSON.parse((await send("Runtime.evaluate", { expression: "JSON.stringify(document.documentElement.scrollHeight)", returnByValue: true })).result.result.value);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 360, height: h, scale: 1 } });
  writeFileSync(join(OUT, "360-nojs.png"), Buffer.from(shot.result.data, "base64"));

  // ---------- damage.html with JavaScript disabled ----------
  console.log("\ndamage.html with JavaScript disabled (360px)");
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/damage.html` });
  await sleep(1500);
  const DAMAGE_STATE = `JSON.stringify((() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const both = sel => [...document.querySelectorAll(sel)].map(e => ({
      th: (e.querySelector("[data-th]") || {}).innerText, en: (e.querySelector("[data-en]") || {}).innerText,
      thShown: !!e.querySelector("[data-th]") && visible(e.querySelector("[data-th]")),
      enShown: !!e.querySelector("[data-en]") && visible(e.querySelector("[data-en]")),
    }));
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    // Ticking works natively without JavaScript.
    const first = boxes[0]; const before = first.checked; first.click(); const toggles = first.checked !== before; first.click();
    const englishNotMarked = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim(), el = n.parentElement;
      if (!/[A-Za-z]/.test(t) || /[\u0E00-\u0E7F]/.test(t) || el.closest("script, style") || !visible(el)) continue;
      if (el.closest("[lang]").getAttribute("lang") !== "en") englishNotMarked.push(t.slice(0, 30));
    }
    return {
      jsRan: document.documentElement.classList.contains("js"),
      title: both("h1")[0],
      steps: both(".steps > li > h2"),
      boxes: boxes.length, boxesShown: boxes.filter(visible).length, toggles,
      rows: both(".assist tbody tr th").map((r, i) => ({ ...r, max: document.querySelectorAll(".assist tbody td")[i].innerText.trim() })),
      source: both("#assist-source")[0],
      links: [...document.querySelectorAll("a[href]")].filter(visible).map(a => a.getAttribute("href")),
      footer: both("footer p")[0],
      printButtonShown: visible(document.getElementById("print")),
      clearButtonShown: visible(document.getElementById("clear-ticks")),
      englishNotMarked,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })())`;
  const dmg = JSON.parse((await send("Runtime.evaluate", { expression: DAMAGE_STATE, returnByValue: true })).result.result.value);
  const a = data.assistance;
  check(!dmg.jsRan, "JavaScript really is disabled");
  check(dmg.title.thShown && dmg.title.enShown, "title shown in Thai and English", JSON.stringify(dmg.title));
  check(dmg.steps.length === 4 && dmg.steps.every(x => x.thShown && x.enShown), "all 4 steps shown in Thai and English", `${dmg.steps.length} steps`);
  check(dmg.boxes === 15 && dmg.boxesShown === 15, "all 15 checkboxes shown", `${dmg.boxesShown}/${dmg.boxes} shown`);
  check(dmg.toggles, "checkboxes can be ticked without JavaScript");
  const rowFails = a.items.map((it, i) => {
    const r = dmg.rows[i], max = typeof it.max === "string" ? it.max : it.max.th;
    return !r ? `row ${i + 1} missing` : (r.th !== it.label.th || r.en !== it.label.en || !r.thShown || !r.enShown || !r.max.includes(max)) ? `row ${i + 1}: ${JSON.stringify(r)}` : null;
  }).filter(Boolean);
  check(dmg.rows.length === a.items.length && !rowFails.length, `all ${a.items.length} assistance amounts shown, both languages`, rowFails.join(" | "));
  check(dmg.source.thShown && dmg.source.enShown && a.links.every(u => dmg.links.includes(u)), "source line and both source links shown", JSON.stringify(dmg.source));
  check(dmg.links.includes("tel:1555"), "1555 is a tap-to-call link");
  check(dmg.links.includes("./"), "link back to the hub");
  check(dmg.footer.thShown && dmg.footer.enShown, '"not an official form" note shown in Thai and English');
  check(!dmg.printButtonShown, "print button hidden (it needs JavaScript; the browser's Print still works)");
  check(!dmg.clearButtonShown, '"Clear all ticks" button hidden (it needs JavaScript)');
  check(!dmg.englishNotMarked.length, 'every visible English text is marked lang="en"', dmg.englishNotMarked.slice(0, 5).join(" | "));
  check(dmg.scrollWidth <= 360, "no sideways scrolling at 360px", `page is ${dmg.scrollWidth}px wide`);
  const dh = JSON.parse((await send("Runtime.evaluate", { expression: "JSON.stringify(document.documentElement.scrollHeight)", returnByValue: true })).result.result.value);
  const dshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 360, height: dh, scale: 1 } });
  writeFileSync(join(OUT, "360-nojs-damage.png"), Buffer.from(dshot.result.data, "base64"));
} finally {
  await stop(server);
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\nScreenshots: test-output/360-nojs.png, test-output/360-nojs-damage.png`);
console.log(failures ? `✗ ${failures} check(s) failed` : "✓ All no-JavaScript checks passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
// Accessibility and layout checks at phone width (360px), in real headless Chrome.
// Everything is measured on the rendered page, so new features are covered automatically:
//
//   • colour contrast of every visible piece of text (WCAG AA: 4.5:1, or 3:1 for large text)
//   • keyboard: every focusable element is reachable with Tab and shows a visible focus outline
//     with at least 3:1 contrast against what's behind it
//   • layout: no sideways scrolling at 360px, tap targets at least 24×24px (WCAG 2.2)
//   • tel: links dial the number that is shown
//
// It runs in light and dark mode, Thai and English, and in a "warnings" state where the
// "may be out of date" notice and the stale-roads warning are forced on. Screenshots of every
// combination are saved to test-output/ for a human to look at.
//
//   node scripts/test-a11y.mjs        (needs Node 22+ and Chrome; set CHROME_PATH if needed)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";
import { serve, stop } from "./lib/server.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "test-output");
const WIDTH = 360;
const MIN_TARGET = 24;

// ---------- page states ----------

// "warnings": the live data file 404s (→ fallback notice) and the embedded fallback copy has
// roads last updated 7 hours ago (→ stale-roads warning).
function warningsOverrides() {
  const data = JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
  const sevenHoursAgo = new Date(Date.now() - 7 * 3600e3 + 7 * 3600e3).toISOString().slice(0, 19) + "+07:00";
  data.roads.forEach(r => { r.updated = sevenHoursAgo; });
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = readFileSync(join(ROOT, "index.html"), "utf8")
    .replace(/(<script type="application\/json" id="fallback-data">)[\s\S]*?(<\/script>)/, (_, a, b) => a + json + b);
  return { "/data/flood.json": null, "/index.html": html };
}

// ---------- code that runs inside the page ----------

const HELPERS = `window.__a11y = (() => {
  const parse = c => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = c => c ? "#" + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("") : "?";
  const bgOf = el => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const desc = el => {
    let s = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].join(".") : "");
    const t = (el.textContent || "").trim().replace(/\\s+/g, " ");
    return s + (t ? ' "' + t.slice(0, 30) + (t.length > 30 ? "…" : "") + '"' : "");
  };
  const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function contrast() {
    const fails = [], seen = new Set();
    let min = Infinity;
    for (const el of document.body.querySelectorAll("*")) {
      if (/^(SCRIPT|STYLE|OPTION)$/.test(el.tagName) || !visible(el)) continue;
      const hasText = el.tagName === "SELECT" || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color), bg = bgOf(el);
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5, r = ratio(fg, bg);
      min = Math.min(min, r);
      const key = hex(fg) + hex(bg) + need;
      if (r < need && !seen.has(key)) { seen.add(key); fails.push(desc(el) + ": " + r.toFixed(2) + ":1 (" + hex(fg) + " on " + hex(bg) + ", needs " + need + ":1)"); }
    }
    return { fails, min: +min.toFixed(2) };
  }

  // Compare with the real screen width: on phones Chrome zooms out to fit wide content, so
  // innerWidth grows with the page and would hide the problem.
  function layout(width) {
    const fails = [];
    const sw = document.documentElement.scrollWidth;
    if (sw > width) fails.push("page scrolls sideways: " + sw + "px wide on a " + width + "px screen");
    for (const el of document.body.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > width + 0.5 && fails.length < 6) fails.push(desc(el) + " sticks out " + Math.round(r.right - width) + "px past the right edge");
    }
    return fails;
  }

  function targets(min) {
    const fails = [];
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      if (!visible(el)) continue;
      // WCAG exception: links inside a sentence of text.
      const inSentence = getComputedStyle(el).display === "inline" &&
        [...el.parentElement.childNodes].some(n => n !== el && n.nodeType === 3 && n.textContent.trim());
      if (inSentence) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min || r.height < min) fails.push(desc(el) + " is " + Math.round(r.width) + "×" + Math.round(r.height) + "px");
    }
    return fails;
  }

  function tel() {
    const fails = [];
    let count = 0;
    for (const a of document.querySelectorAll('a[href^="tel:"]')) {
      if (!visible(a)) continue;
      count++;
      // Every number written in the link, e.g. "096-999-4829" → "0969994829"; one must match exactly.
      const href = a.getAttribute("href").slice(4);
      const shown = (a.textContent.match(/\\d[\\d-]*\\d/g) || []).map(n => n.replace(/-/g, ""));
      if (!/^\\+?\\d+$/.test(href)) fails.push(desc(a) + ': href "tel:' + href + '" is not just digits');
      else if (!shown.includes(href)) fails.push(desc(a) + ": dials " + href + " but shows " + (shown.join(", ") || "no number"));
    }
    return { fails, count };
  }

  // Number the focusable elements so the keyboard walk can tell them apart.
  function tagFocusables() {
    const list = [...document.querySelectorAll(FOCUSABLE)].filter(visible);
    list.forEach((el, i) => { el.dataset.a11yIdx = i; });
    return list.map(desc);
  }

  function focused() {
    const el = document.activeElement;
    if (!el || el === document.body || el.dataset.a11yIdx === undefined) return null;
    const cs = getComputedStyle(el);
    const width = parseFloat(cs.outlineWidth) || 0;
    const outline = cs.outlineStyle !== "none" && width >= 2 ? parse(cs.outlineColor) : null;
    const behind = bgOf(el.parentElement);
    return {
      idx: +el.dataset.a11yIdx, desc: desc(el),
      ok: !!outline && ratio(outline, behind) >= 3,
      why: outline ? "outline " + hex(outline) + " on " + hex(behind) + " is " + ratio(outline, behind).toFixed(2) + ":1 (needs 3:1)" : "no visible focus outline",
    };
  }

  return { contrast, layout, targets, tel, tagFocusables, focused };
})(); true`;

// ---------- runner ----------

let failures = 0;
function report(label, fails) {
  if (!fails.length) { console.log(`  ✓ ${label}`); return; }
  failures += fails.length;
  console.log(`  ✗ ${label}`);
  fails.forEach(f => console.log(`      - ${f}`));
}

async function run(chrome, url, { theme, lang, state }) {
  const { send } = chrome;
  const evaluate = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result.result.value;
  };
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  // Language is remembered in localStorage; set it, then load the page fresh (focus starts at the top).
  await send("Page.navigate", { url });
  await sleep(300);
  await evaluate(`localStorage.setItem("lang", ${JSON.stringify(lang)}); true`);
  await send("Page.navigate", { url });

  const ready = state === "warnings"
    ? `!document.getElementById("notice").hidden && !document.getElementById("roads-stale").hidden`
    : `document.querySelectorAll("#shelters li").length > 0`;
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { await sleep(250); ok = await evaluate(`(${ready}) && document.fonts.status === "loaded"`).catch(() => false); }
  if (!ok) { report("page rendered", ["page did not reach the expected state"]); return; }

  await evaluate(HELPERS);
  const docLang = await evaluate("document.documentElement.lang");
  report(`<html lang> is "${lang}"`, docLang === lang ? [] : [`it is "${docLang}"`]);

  const c = await evaluate("__a11y.contrast()");
  report(`text contrast (lowest ${c.min}:1)`, c.fails);
  report(`no sideways scrolling at ${WIDTH}px`, await evaluate(`__a11y.layout(${WIDTH})`));
  report(`tap targets at least ${MIN_TARGET}×${MIN_TARGET}px`, await evaluate(`__a11y.targets(${MIN_TARGET})`));
  const t = await evaluate("__a11y.tel()");
  report(`${t.count} tel: links dial the number shown`, t.fails);

  // Keyboard: press Tab until focus has been round the whole page.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const all = await evaluate("__a11y.tagFocusables()");
  const reached = new Set(), focusFails = [];
  for (let i = 0; i < all.length + 5; i++) {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    }
    const f = await evaluate("__a11y.focused()");
    if (!f) { if (reached.size) break; else continue; }
    if (reached.has(f.idx)) break;
    reached.add(f.idx);
    if (!f.ok) focusFails.push(`${f.desc}: ${f.why}`);
  }
  const missed = all.filter((_, i) => !reached.has(i)).map(d => `${d}: never reached with Tab`);
  report(`keyboard: ${reached.size}/${all.length} controls reachable with a visible focus outline`, [...missed, ...focusFails]);

  // Full-page screenshot for a human to look at.
  const h = await evaluate("document.documentElement.scrollHeight");
  await evaluate("document.activeElement && document.activeElement.blur(); scrollTo(0, 0); true");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height: h, scale: 1 } });
  writeFileSync(join(OUT, `${WIDTH}-${theme}-${lang}-${state}.png`), Buffer.from(shot.result.data, "base64"));
}

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "a11y-"));
const chrome = await launchChrome(join(tmp, "profile"));
try {
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 740, deviceScaleFactor: 2, mobile: true });
  for (const state of ["normal", "warnings"]) {
    // A fresh server (new port = new origin) per state, so a service worker from one state
    // can't serve cached files to the other.
    const server = await serve(ROOT, 0, state === "warnings" ? warningsOverrides() : {});
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const theme of ["light", "dark"]) {
      for (const lang of ["th", "en"]) {
        console.log(`\n${WIDTH}px · ${theme} · ${lang === "th" ? "Thai" : "English"} · ${state}`);
        await run(chrome, url, { theme, lang, state });
      }
    }
    await stop(server);
  }
} finally {
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\nScreenshots: test-output/${WIDTH}-*.png`);
console.log(failures ? `✗ ${failures} problem(s) found` : "✓ All accessibility and layout checks passed");
process.exit(failures ? 1 : 0);

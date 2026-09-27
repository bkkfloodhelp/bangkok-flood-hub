#!/usr/bin/env node
// Accessibility and layout checks at phone width (360px), in real headless Chrome.
// Everything is measured on the rendered page, so new features are covered automatically:
//
//   • colour contrast of every visible piece of text (WCAG AA: 4.5:1, or 3:1 for large text)
//   • keyboard: every focusable element is reachable with Tab and shows a visible focus outline
//     with at least 3:1 contrast against what's behind it
//   • layout: no sideways scrolling at 360px, tap targets at least 24×24px (WCAG 2.2)
//   • tel: links dial the number that is shown
//   • no failed requests (404s etc.) in the network log, e.g. a missing favicon
//   • no JavaScript errors
//
// Pages: index.html (normal + "warnings" states) and damage.html. damage.html also gets
// behaviour checks: ticks are remembered, it works with storage blocked, the print button
// prints, and the print stylesheet (black on white, no buttons, empty boxes, sources kept).
// A PDF of the printed damage page is saved as test-output/damage-print.pdf.
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
import { buildPage, buildDamagePage } from "./embed-fallback.mjs";
import { withSamples } from "./lib/samples.mjs";
import { createRequire } from "node:module";
const { ROAD_TAGS } = createRequire(import.meta.url)("../render.js");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "test-output");
const WIDTH = 360;
const MIN_TARGET = 24;

// ---------- page states ----------

// The page is built from data/flood.json first, exactly as the deploy does.
const readData = () => JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
const built = data => buildPage(readFileSync(join(ROOT, "index.html"), "utf8"), data).html;

function normalOverrides(data) {
  return {
    "/index.html": built(data),
    "/damage.html": buildDamagePage(readFileSync(join(ROOT, "damage.html"), "utf8"), data),
  };
}

// "warnings": the live data file 404s (→ fallback notice) and the page was built with roads
// last updated 7 hours ago (→ stale-roads warning). The first roads are also given every road
// type, so each label style is checked even before real data uses it, and one shelter source is
// written in Thai (checks language marking when the page is switched to English). Sample tools
// and live-roads links are added if flood.json has none yet.
function warningsData() {
  const data = withSamples(readData()); // tools, live-roads links, every road type, even before real entries exist
  const sevenHoursAgo = new Date(Date.now() - 7 * 3600e3 + 7 * 3600e3).toISOString().slice(0, 19) + "+07:00";
  data.roads.forEach(r => { r.updated = sevenHoursAgo; });
  // Status and shelter note old enough for their warnings too, so all three red boxes are checked.
  data.status.updated = sevenHoursAgo;
  if (data.roadsNote) data.roadsNote.updated = sevenHoursAgo;
  data.sheltersNote.updated = new Date(Date.now() - 25 * 3600e3 + 7 * 3600e3).toISOString().slice(0, 19) + "+07:00";
  Object.keys(ROAD_TAGS).forEach((type, i) => { if (data.roads[i]) data.roads[i].type = type; });
  // A source written in Thai, which must be marked lang="th" when the page is in English.
  if (data.shelters[0]) data.shelters[0].source = "โทรยืนยันกับศูนย์";
  return data;
}
const warningsOverrides = data => ({ "/data/flood.json": null, "/index.html": built(data) });

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

  // Language of parts: visible Thai text must resolve to lang="th", visible English (letters,
  // no Thai) to lang="en", whichever language the page is switched to.
  function languages() {
    const fails = [], seen = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim(), el = n.parentElement;
      if (!t || el.closest("script, style, option") || !visible(el)) continue;
      const want = /[\u0E00-\u0E7F]/.test(t) ? "th" : /[A-Za-z]/.test(t) ? "en" : null;
      if (!want) continue;
      const got = el.closest("[lang]").getAttribute("lang");
      if (got !== want && !seen.has(t)) { seen.add(t); fails.push('"' + t.slice(0, 30) + '" is lang="' + got + '", should be "' + want + '"'); }
    }
    return fails;
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

  return { contrast, layout, targets, tel, languages, tagFocusables, focused };
})(); true`;

// ---------- runner ----------

let failures = 0;
function report(label, fails) {
  if (!fails.length) { console.log(`  ✓ ${label}`); return; }
  failures += fails.length;
  console.log(`  ✗ ${label}`);
  fails.forEach(f => console.log(`      - ${f}`));
}

const READY = {
  hub: `document.querySelectorAll("#district option").length > 1`, // built by app.js, so enhancement has run
  warnings: `!document.getElementById("notice").hidden && ["roads-stale", "status-stale", "shelters-stale"].every(id => !document.getElementById(id).hidden)`,
  damage: `document.documentElement.dataset.enhanced === "damage"`, // set at the end of damage.js
};

async function run(chrome, base, { theme, lang, state, page = "hub", roads = [] }) {
  const url = page === "damage" ? base + "damage.html" : base;
  const { send } = chrome;
  const evaluate = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result.result.value;
  };
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  // Language is remembered in localStorage; set it, then load the page fresh (focus starts at the top).
  // Network errors count from the first load: Chrome asks for a site's favicon only once.
  netErrors.length = 0;
  jsErrors.length = 0;
  await send("Page.navigate", { url });
  await sleep(300);
  await evaluate(`localStorage.setItem("lang", ${JSON.stringify(lang)}); true`);
  await send("Page.navigate", { url });

  const ready = page === "damage" ? READY.damage : state === "warnings" ? READY.warnings : READY.hub;
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { await sleep(250); ok = await evaluate(`(${ready}) && document.fonts.status === "loaded"`).catch(() => false); }
  if (!ok) { report("page rendered", ["page did not reach the expected state"]); return; }

  await evaluate(HELPERS);
  const docLang = await evaluate("document.documentElement.lang");
  report(`<html lang> is "${lang}"`, docLang === lang ? [] : [`it is "${docLang}"`]);

  report("every visible text is marked with its real language (lang)", await evaluate("__a11y.languages()"));
  const c = await evaluate("__a11y.contrast()");
  report(`text contrast (lowest ${c.min}:1)`, c.fails);
  report(`no sideways scrolling at ${WIDTH}px`, await evaluate(`__a11y.layout(${WIDTH})`));
  report(`tap targets at least ${MIN_TARGET}×${MIN_TARGET}px`, await evaluate(`__a11y.targets(${MIN_TARGET})`));
  const t = await evaluate("__a11y.tel()");
  report(`${t.count} tel: links dial the number shown`, t.fails);
  // The "warnings" state makes data/flood.json 404 on purpose; anything else is a real problem.
  const expected = state === "warnings" ? ["/data/flood.json"] : [];
  report("no failed requests in the network log", [...new Set(netErrors.filter(e => !expected.includes(e.path)).map(e => e.text))]);
  report("no JavaScript errors", [...new Set(jsErrors)]);
  if (page === "hub") {
    // Every road in the data is rendered, for every type (catches a type being dropped or mislabelled).
    const shown = await evaluate(`[...document.querySelectorAll("#roads li")].map(li => [...(li.querySelector(".tag") || { classList: [] }).classList].find(c => c !== "tag") || "(no type)")`);
    const count = ts => ts.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {});
    const want = count(roads.map(r => r.type)), got = count(shown);
    const diff = Object.keys({ ...want, ...got }).filter(t => want[t] !== got[t]).map(t => `${t}: ${got[t] || 0} shown, ${want[t] || 0} in data`);
    report(`roads shown per type match the data (${Object.entries(want).map(([t, n]) => `${t} ${n}`).join(", ")})`, diff);
    if (!roads.length) {
      const e = await evaluate(`(() => { const shown = el => !!el && el.getClientRects().length > 0; return {
        list: shown(document.getElementById("roads")), sub: shown(document.getElementById("roads-sub")),
        note: shown(document.getElementById("roads-note")), stale: shown(document.getElementById("roads-stale")) }; })()`);
      const f = [];
      if (e.list) f.push("empty road-list box is visible");
      if (e.sub) f.push('"No road reports yet" line is visible next to the road note');
      if (!e.note) f.push("road note is hidden");
      if (e.stale) f.push("stale-roads warning shown with no roads");
      report("empty road list: note shown, no empty box, no stale warning", f);
    }
  }

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
  const name = page === "damage" ? `${WIDTH}-damage-${theme}-${lang}.png` : `${WIDTH}-${theme}-${lang}-${state}.png`;
  writeFileSync(join(OUT, name), Buffer.from(shot.result.data, "base64"));
}

// damage.html behaviour: saved ticks, blocked storage, print button, print stylesheet.
async function damageBehaviour(chrome, base) {
  const { send } = chrome;
  const url = base + "damage.html";
  const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
  // Mark the current document first, so "ready" can't be read from the page being left.
  const load = async () => {
    jsErrors.length = 0;
    await evaluate(`window.__oldPage = true`).catch(() => {});
    await send("Page.navigate", { url });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if (await evaluate(`!window.__oldPage && (${READY.damage})`).catch(() => false)) return true;
    }
    return false;
  };
  await send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] });

  // 1. Ticks are remembered on this device.
  await load();
  await evaluate(`localStorage.removeItem("damage-checklist"); true`);
  await load();
  await evaluate(`document.getElementById("doc-id").click(); document.getElementById("room-kitchen").click(); true`);
  await load();
  const kept = await evaluate(`["doc-id","room-kitchen","doc-land"].map(id => document.getElementById(id).checked)`);
  report("ticks are remembered after reloading", kept.join() === "true,true,false" ? [] : [`checked after reload: ${kept.join(", ")} (expected true, true, false)`]);

  // 2. Storage blocked (private mode, disabled site data): the page must work the same.
  const block = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });`,
  });
  const ready = await load();
  const blocked = await evaluate(`(() => { try { localStorage.length; return false; } catch (e) { return true; } })()`);
  const toggled = await evaluate(`(() => { const b = document.getElementById("doc-photos"); b.click(); const on = b.checked; b.click(); return on && !b.checked; })()`);
  const fails = [];
  if (!blocked) fails.push("test setup: storage was not actually blocked");
  if (!ready) fails.push("page did not finish setting up");
  if (!toggled) fails.push("checkbox did not tick and untick");
  fails.push(...jsErrors);
  report("works with storage blocked (no errors, boxes still tick)", fails);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: block.result.identifier });

  // 3. The print button opens the print dialog.
  const stub = await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.print = () => { window.__printed = (window.__printed || 0) + 1; };` });
  await load();
  await evaluate(`document.getElementById("print").click(); true`);
  const printed = await evaluate(`window.__printed || 0`);
  report('"Print / save as PDF" button calls window.print()', printed === 1 ? [] : [`window.print called ${printed} times`]);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: stub.result.identifier });

  // 4. "Clear all ticks": Cancel keeps them; OK clears them, also after a reload. The question
  //    is asked in the page's language.
  const confirmStub = answer => send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.confirm = q => { window.__asked = q; return ${answer}; };`,
  });
  const cf = [];
  await evaluate(`localStorage.setItem("lang", "th"); true`); // earlier runs may have left English selected
  let st = await confirmStub(false);
  await load();
  const before = await evaluate(`[...document.querySelectorAll("input[data-save]")].filter(b => b.checked).length`);
  await evaluate(`document.getElementById("clear-ticks").click(); true`);
  const afterCancel = await evaluate(`[...document.querySelectorAll("input[data-save]")].filter(b => b.checked).length`);
  const askedTh = await evaluate(`window.__asked || ""`);
  if (before < 2) cf.push(`test setup: expected ticked boxes, found ${before}`);
  if (afterCancel !== before) cf.push(`Cancel changed the ticks (${before} → ${afterCancel})`);
  const pageLang = await evaluate(`document.documentElement.lang`);
  if (askedTh !== "ล้างเครื่องหมายทั้งหมดใช่ไหม") cf.push(`question on the ${pageLang} page was "${askedTh}"`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: st.result.identifier });
  st = await confirmStub(true);
  await load();
  await evaluate(`document.getElementById("clear-ticks").click(); true`);
  const afterOk = await evaluate(`[...document.querySelectorAll("input[data-save]")].filter(b => b.checked).length`);
  await load();
  const afterReload = await evaluate(`[...document.querySelectorAll("input[data-save]")].filter(b => b.checked).length`);
  if (afterOk !== 0) cf.push(`${afterOk} boxes still ticked after OK`);
  if (afterReload !== 0) cf.push(`${afterReload} boxes ticked again after reload (not forgotten)`);
  await evaluate(`localStorage.setItem("lang", "en"); true`);
  await load();
  await evaluate(`document.getElementById("clear-ticks").click(); true`);
  const askedEn = await evaluate(`window.__asked || ""`);
  if (askedEn !== "Clear all ticks?") cf.push(`question in English page was "${askedEn}"`);
  await evaluate(`localStorage.setItem("lang", "th"); true`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: st.result.identifier });
  report('"Clear all ticks" asks first; Cancel keeps, OK clears (also after reload)', cf);
  // Tick one again so the print check below can confirm a ticked box prints empty.
  await load();
  await evaluate(`document.getElementById("doc-id").click(); true`);

  // 5. Print stylesheet (a box is ticked at this point, and must still print empty).
  await load();
  await send("Emulation.setEmulatedMedia", { media: "print", features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const p = await evaluate(`(() => {
    const shown = e => e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
    const texty = [...document.body.querySelectorAll("*")].filter(e => shown(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    const box = document.getElementById("doc-id");
    return {
      stillShown: [".lang", ".print-btn", ".clear-btn", ".back"].filter(s => shown(document.querySelector(s))),
      colours: [...new Set(texty.map(e => getComputedStyle(e).color))],
      backgrounds: [...new Set([document.body, ...document.body.querySelectorAll("*")].filter(e => e === document.body || shown(e)).map(e => getComputedStyle(e).backgroundColor)
        .filter(c => c !== "rgba(0, 0, 0, 0)" && c !== "rgb(255, 255, 255)"))],
      box: { ticked: box.checked, appearance: getComputedStyle(box).appearance, border: getComputedStyle(box).borderTopStyle },
      sourceLinkUrl: getComputedStyle(document.querySelector("#assist-source a"), "::after").content,
      sources: shown(document.getElementById("assist-source")),
      notOfficial: shown(document.querySelector("footer p")),
      beforeHome: shown(document.querySelector(".before-home")) && document.querySelectorAll(".before-home li").length === 5,
    };
  })()`);
  const pf = [];
  if (p.stillShown.length) pf.push(`still shown when printed: ${p.stillShown.join(", ")}`);
  if (p.colours.join() !== "rgb(0, 0, 0)") pf.push(`text colours other than black: ${p.colours.join(", ")}`);
  if (p.backgrounds.length) pf.push(`backgrounds other than white: ${p.backgrounds.join(", ")}`);
  if (p.box.appearance !== "none" || p.box.border === "none") pf.push(`checkbox doesn't print as an empty box (appearance ${p.box.appearance}, border ${p.box.border})`);
  if (!p.box.ticked) pf.push("test setup: expected a ticked box to check it prints empty");
  if (!/https:/.test(p.sourceLinkUrl)) pf.push("source links don't print their address");
  if (!p.sources) pf.push("source list missing from print");
  if (!p.notOfficial) pf.push('"not an official form" note missing from print');
  if (!p.beforeHome) pf.push('"Before going back home" box missing from print');
  report("print: black on white, no buttons, empty boxes, sources and note kept (even from dark mode)", pf);
  const pdf = await send("Page.printToPDF", { paperWidth: 8.27, paperHeight: 11.69 });
  writeFileSync(join(OUT, "damage-print.pdf"), Buffer.from(pdf.result.data, "base64"));

  // Hub printed: the banner to this page is left out.
  await send("Page.navigate", { url: base });
  await sleep(1500);
  const bannerPrinted = await evaluate(`getComputedStyle(document.querySelector(".banner")).display !== "none"`);
  report("print: hub banner is left out", bannerPrinted ? ["banner is printed"] : []);
  await send("Emulation.setEmulatedMedia", { media: "", features: [] });
  await evaluate(`localStorage.removeItem("damage-checklist"); true`);
}

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "a11y-"));
const chrome = await launchChrome(join(tmp, "profile"));
const netErrors = [];
chrome.on("Network.responseReceived", ({ response: r }) => {
  if (r.status >= 400) netErrors.push({ path: new URL(r.url).pathname, text: `${r.status} ${new URL(r.url).pathname}` });
});
chrome.on("Network.loadingFailed", ({ errorText, canceled, requestId }) => {
  if (!canceled) netErrors.push({ path: requestId, text: `request failed: ${errorText}` });
});
const jsErrors = [];
chrome.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) => {
  jsErrors.push(`JavaScript error: ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
});
try {
  await chrome.send("Network.enable");
  await chrome.send("Runtime.enable");
  await chrome.send("Page.enable"); // needed for addScriptToEvaluateOnNewDocument (storage block, print stub)
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 740, deviceScaleFactor: 2, mobile: true });
  for (const state of ["normal", "warnings"]) {
    // A fresh server (new port = new origin) per state, so a service worker from one state
    // can't serve cached files to the other.
    const stateData = state === "warnings" ? warningsData() : readData();
    const server = await serve(ROOT, 0, state === "warnings" ? warningsOverrides(stateData) : normalOverrides(stateData));
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const theme of ["light", "dark"]) {
      for (const lang of ["th", "en"]) {
        console.log(`\n${WIDTH}px · ${theme} · ${lang === "th" ? "Thai" : "English"} · ${state}`);
        await run(chrome, url, { theme, lang, state, roads: stateData.roads });
      }
    }
    if (state === "normal") {
      for (const theme of ["light", "dark"]) {
        for (const lang of ["th", "en"]) {
          console.log(`\n${WIDTH}px · ${theme} · ${lang === "th" ? "Thai" : "English"} · damage.html`);
          await run(chrome, url, { theme, lang, state, page: "damage" });
        }
      }
      console.log(`\ndamage.html behaviour`);
      await damageBehaviour(chrome, url);
    }
    await stop(server);
  }
} finally {
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\nScreenshots: test-output/${WIDTH}-*.png · printed damage page: test-output/damage-print.pdf`);
console.log(failures ? `✗ ${failures} problem(s) found` : "✓ All accessibility and layout checks passed");
process.exit(failures ? 1 : 0);

(function () {
"use strict";

// The page arrives already filled in (pre-rendered from data/flood.json at deploy time, in Thai
// and English). This script only enhances it: "X hours ago" times, the stale-roads warning,
// the district filter, the "may be out of date" notice, and offline support (the language
// toggle is in lang.js, shared with the other pages).
// If the live data file is newer than the pre-rendered copy, it re-renders the data sections
// with render.js (the same code the deploy step uses).

const DATA_URL = "data/flood.json";
const FETCH_TIMEOUT_MS = 8000;
const R = window.FloodRender; // from render.js; if it failed to load, the pre-rendered page still works

const $ = id => document.getElementById(id);
const root = document.documentElement;

const L = window.FloodLang; // lang.js: language toggle + lang="th" marking
const currentLang = () => (L ? L.lang : root.lang === "en" ? "en" : "th");
let data = null;            // the data the page is currently showing
let fallbackReason = null;  // null = live data; "fallback" = saved copy; "none" = no data at all

// ---------- enhancements ----------

// Turn the pre-rendered "updated 26 Sep, 13:15" into "updated 3 hours ago" (both languages).
function refreshAges() {
  if (!R) return;
  const now = Date.now();
  document.querySelectorAll(".age[data-ts]").forEach(s => { s.innerHTML = R.agoHTML(s.dataset.ts, now); });
}

// Red "over N hours old" warnings for roads, the status box and the shelter note.
function checkStale() {
  const s = R && data ? R.staleness(data, Date.now()) : {};
  $("roads-stale").hidden = !s.roads;
  $("status-stale").hidden = !s.status;
  $("shelters-stale").hidden = !s.shelters;
}

// <option> can't hold data-th/data-en spans, so the district list is rebuilt per language.
function buildDistricts() {
  if (!data) return;
  const sel = $("district");
  const cur = sel.value || "all";
  sel.textContent = "";
  const add = (value, text) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = text;
    sel.appendChild(o);
  };
  const lang = currentLang();
  add("all", lang === "th" ? "ทุกเขต" : "All districts");
  const seen = new Set();
  data.shelters.forEach(s => {
    if (s.district && !seen.has(s.district.en)) {
      seen.add(s.district.en);
      add(s.district.en, lang === "th" ? "เขต" + s.district.th : s.district.en);
    }
  });
  sel.value = seen.has(cur) ? cur : "all";
}

function applyFilter() {
  const pick = $("district").value;
  document.querySelectorAll("#shelters li").forEach(li => {
    li.hidden = pick !== "all" && li.dataset.district !== pick;
  });
}

const WARN_ICON = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-warning"/></svg>';
const NOTICE = {
  fallback: WARN_ICON + '<strong><span data-th>ข้อมูลอาจไม่เป็นปัจจุบัน </span><span data-en lang="en">May be out of date. </span></strong>' +
    '<span data-th>โหลดข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงข้อมูลสำรอง ลองรีเฟรชเมื่อมีสัญญาณ</span>' +
    '<span data-en lang="en">Couldn\'t load the latest data, so this is a saved copy. Try refreshing when you have signal.</span>',
  none: WARN_ICON + '<strong><span data-th>ข้อมูลอาจไม่เป็นปัจจุบัน </span><span data-en lang="en">May be out of date. </span></strong>' +
    '<span data-th>โหลดข้อมูลไม่สำเร็จ เหตุฉุกเฉินโทร 1669 หรือ 1555</span>' +
    '<span data-en lang="en">Could not load the information. In an emergency call 1669 or 1555.</span>',
};

function renderNotice() {
  const n = $("notice");
  n.innerHTML = fallbackReason ? NOTICE[fallbackReason] : "";
  n.hidden = !fallbackReason;
}

function enhance() {
  refreshAges();
  checkStale();
  buildDistricts();
  applyFilter();
  renderNotice();
  if (L) L.markThai();
}

// ---------- data ----------

function looksValid(d) {
  return !!(d && d.status && d.status.title && typeof d.lastUpdated === "string" &&
    Array.isArray(d.hotlines) && Array.isArray(d.shelters) &&
    Array.isArray(d.roads) && Array.isArray(d.sources));
}

// Show d. The page already shows the embedded copy, so only re-render if d is different.
// Returns false (leaving the page as it was) if d can't be rendered.
function useData(d, reason) {
  if (JSON.stringify(d) !== JSON.stringify(data)) {
    if (!R) return false;
    let html;
    try { html = R.sections(d); } // build everything first, so a bad field can't leave a half-updated page
    catch (e) { console.error("Render failed", e); return false; }
    Object.keys(html).forEach(id => { const el = $(id); if (el) el.innerHTML = html[id]; });
  }
  data = d;
  fallbackReason = reason;
  enhance();
  return true;
}

function readEmbedded() {
  try {
    const d = JSON.parse($("fallback-data").textContent);
    return looksValid(d) ? d : null;
  } catch (e) { return null; }
}

function fetchLive() {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  let cached = false;
  return fetch(DATA_URL, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      cached = r.headers.get("X-Served-From") === "sw-cache"; // set by sw.js when offline
      return r.json();
    })
    .then(d => { if (!looksValid(d)) throw new Error("Invalid data"); return { d, cached }; })
    .finally(() => { if (timer) clearTimeout(timer); });
}

// ---------- service worker (offline support) ----------

// Only registrations/caches under this site's own path; the github.io address is shared with other sites.
const SCOPE = new URL("./", location.href).href;

function setupServiceWorker(d) {
  if (!("serviceWorker" in navigator)) return;
  if (d && d.serviceWorker === false) {
    // Off-switch in flood.json: remove any installed worker and its caches. The old worker may
    // still be saving a response for this very page load, which would re-create a cache, so
    // clear again a few seconds later (and on every load while the flag is set).
    const clearCaches = () => window.caches && caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith("flood-hub-")).map(k => caches.delete(k))))
      .catch(() => {});
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.filter(r => r.scope === SCOPE).map(r => r.unregister())))
      .catch(() => {})
      .then(() => { clearCaches(); setTimeout(clearCaches, 3000); });
    return;
  }
  // update() on every load makes the browser re-fetch sw.js now, instead of whenever it
  // decides to. This is what makes the emergency off-switch (scripts/sw-disable.js) reliable.
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then(reg => reg.update())
    .catch(e => console.warn("Service worker not registered/updated:", e));
}

// ---------- start ----------

$("district").addEventListener("change", applyFilter);
if (L) L.onChange(buildDistricts); // <option> text is per language

// The pre-rendered HTML matches the embedded copy, so enhance it straight away.
data = readEmbedded();
if (data) enhance();

fetchLive()
  .then(({ d, cached }) => {
    if (!useData(d, cached ? "fallback" : null)) throw new Error("Live data could not be rendered");
    setupServiceWorker(d);
  })
  .catch(err => {
    console.warn("Showing the saved copy:", err);
    fallbackReason = data ? "fallback" : "none";
    renderNotice();
    setupServiceWorker(data);
  });

setInterval(() => { refreshAges(); checkStale(); }, 60 * 1000);
})();

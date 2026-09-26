(function () {
"use strict";

const DATA_URL = "data/flood.json";
const FETCH_TIMEOUT_MS = 8000;
const ROADS_STALE_MS = 6 * 3600 * 1000;
const BKK_OFFSET_MS = 7 * 3600 * 1000;

const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const $ = id => document.getElementById(id);

let lang = "th";
try { lang = localStorage.getItem("lang") || "th"; } catch (e) {}
if (lang !== "th" && lang !== "en") lang = "th";

let data = null;
let fallbackReason = null; // null = live data; "fallback" = embedded copy; "none" = no data at all

// ---------- helpers ----------

// Pick the current language from a {th, en} object.
function tr(o) { return o ? (o[lang] || o.th || o.en || "") : ""; }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function telHref(n) { return "tel:" + n.replace(/-/g, ""); }

// "เสาร์ 26 ก.ย. 2569 13:15" / "Sat 26 Sep 2026, 13:15" — always Bangkok time.
function formatStamp(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const b = new Date(t + BKK_OFFSET_MS);
  const hm = String(b.getUTCHours()).padStart(2, "0") + ":" + String(b.getUTCMinutes()).padStart(2, "0");
  if (lang === "th") {
    return TH_DAYS[b.getUTCDay()] + " " + b.getUTCDate() + " " + TH_MONTHS[b.getUTCMonth()] + " " + (b.getUTCFullYear() + 543) + " " + hm + " น.";
  }
  return EN_DAYS[b.getUTCDay()] + " " + b.getUTCDate() + " " + EN_MONTHS[b.getUTCMonth()] + " " + b.getUTCFullYear() + ", " + hm;
}

// "อัปเดตเมื่อ 3 ชม. ที่แล้ว" / "updated 3 hours ago"
function updatedAgo(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  const th = lang === "th";
  if (mins < 1) return th ? "อัปเดตเมื่อสักครู่" : "updated just now";
  if (mins < 60) return th ? "อัปเดตเมื่อ " + mins + " นาทีที่แล้ว" : "updated " + mins + " min ago";
  const hours = Math.floor(mins / 60);
  if (hours < 48) return th ? "อัปเดตเมื่อ " + hours + " ชม. ที่แล้ว" : "updated " + hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  return th ? "อัปเดตเมื่อ " + days + " วันที่แล้ว" : "updated " + days + " days ago";
}

// A span whose text is refreshed every minute by tick().
function agoSpan(iso) {
  const s = el("span", "age", updatedAgo(iso));
  s.dataset.ts = iso;
  return s;
}

function newestRoadTime() {
  let newest = null;
  data.roads.forEach(r => {
    const t = Date.parse(r.updated);
    if (!isNaN(t) && (newest === null || t > newest.t)) newest = { t, road: r };
  });
  return newest;
}

// ---------- render ----------

function renderHeader() {
  $("updated").textContent = (lang === "th" ? "อัปเดตล่าสุด: " : "Last updated: ") + formatStamp(data.lastUpdated);
}

function renderNotice() {
  const n = $("notice");
  n.textContent = "";
  if (!fallbackReason) { n.hidden = true; return; }
  const th = lang === "th";
  n.appendChild(el("strong", null, th ? "ข้อมูลอาจไม่เป็นปัจจุบัน " : "May be out of date. "));
  if (fallbackReason === "none") {
    n.appendChild(document.createTextNode(th
      ? "โหลดข้อมูลไม่สำเร็จ เหตุฉุกเฉินโทร 1669 หรือ 1555"
      : "Could not load the information. In an emergency call 1669 or 1555."));
  } else {
    n.appendChild(document.createTextNode(th
      ? "โหลดข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงข้อมูลสำรอง ลองรีเฟรชเมื่อมีสัญญาณ"
      : "Couldn't load the latest data, so this is a saved copy. Try refreshing when you have signal."));
  }
  n.hidden = false;
}

function renderStatus() {
  const s = data.status;
  $("status-title").textContent = tr(s.title);
  $("status-body").textContent = tr(s.body);
  const f = $("status-fresh");
  f.textContent = "";
  f.appendChild(agoSpan(s.updated));
  if (s.source) f.appendChild(document.createTextNode(" · " + s.source));
}

function renderHotlines() {
  const box = $("calls");
  box.textContent = "";
  data.hotlines.forEach(h => {
    const a = el("a", h.urgent ? "call urgent" : "call");
    a.href = h.number ? telHref(h.number) : h.url;
    a.appendChild(el("b", null, h.number || h.display));
    a.appendChild(el("span", null, tr(h.label)));
    box.appendChild(a);
  });
}

function buildDistricts() {
  const sel = $("district");
  const cur = sel.value || "all";
  sel.textContent = "";
  const all = el("option", null, lang === "th" ? "ทุกเขต" : "All districts");
  all.value = "all";
  sel.appendChild(all);
  const seen = new Set();
  data.shelters.forEach(s => {
    if (s.district && !seen.has(s.district.en)) {
      seen.add(s.district.en);
      const o = el("option", null, lang === "th" ? "เขต" + s.district.th : s.district.en);
      o.value = s.district.en;
      sel.appendChild(o);
    }
  });
  sel.value = seen.has(cur) ? cur : "all";
}

function renderShelters() {
  const pick = $("district").value;
  const ul = $("shelters");
  ul.textContent = "";
  data.shelters
    .filter(s => pick === "all" || (s.district && s.district.en === pick))
    .forEach(s => {
      const li = el("li");
      const info = el("div");
      info.appendChild(el("div", "name", tr(s.name)));
      const d = s.district
        ? (lang === "th" ? "เขต" + s.district.th : s.district.en)
        : (lang === "th" ? "ไม่ระบุเขต" : "District not stated");
      info.appendChild(el("div", "meta", d));
      const fresh = el("div", "meta");
      fresh.appendChild(agoSpan(s.updated));
      if (s.source) fresh.appendChild(document.createTextNode(" · " + s.source));
      info.appendChild(fresh);
      li.appendChild(info);
      if (s.tel) {
        const a = el("a", "tel", s.tel);
        a.href = telHref(s.tel);
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
}

function renderRoads() {
  const ul = $("roads");
  ul.textContent = "";
  const newest = newestRoadTime();
  const mainSource = newest ? newest.road.source : "";

  const sub = $("roads-sub");
  sub.textContent = "";
  if (newest) {
    sub.appendChild(document.createTextNode((lang === "th" ? "ประกาศโดย " : "Source: ") + mainSource + " · "));
    sub.appendChild(agoSpan(newest.road.updated));
    sub.appendChild(document.createTextNode(lang === "th" ? " สถานการณ์อาจเปลี่ยนแล้ว" : ". Conditions may have changed since."));
  } else {
    sub.textContent = lang === "th" ? "ยังไม่มีรายงานถนน" : "No road reports yet.";
  }

  data.roads.forEach(r => {
    const li = el("li");
    const road = el("span", "road");
    road.appendChild(el("span", "tag " + r.type,
      r.type === "avoid" ? (lang === "th" ? "เลี่ยง" : "Avoid") : (lang === "th" ? "ขับช้า" : "Drive slowly")));
    road.appendChild(el("span", "rn", lang === "th" ? "ถ." + r.name.th : r.name.en + " Rd"));
    li.appendChild(road);
    const age = el("span", "meta age-col");
    age.appendChild(agoSpan(r.updated));
    if (r.source && r.source !== mainSource) age.appendChild(document.createTextNode(" · " + r.source));
    li.appendChild(age);
    ul.appendChild(li);
  });
  checkStale();
}

function checkStale() {
  const newest = data && newestRoadTime();
  $("roads-stale").hidden = !(newest && Date.now() - newest.t > ROADS_STALE_MS);
}

function renderSources() {
  const p = $("sources");
  let links = p.querySelector(".links");
  if (!links) { links = el("span", "links"); p.appendChild(links); }
  links.textContent = " ";
  data.sources.forEach((s, i) => {
    if (i) links.appendChild(document.createTextNode(", "));
    const a = el("a", null, s.title);
    a.href = s.url;
    links.appendChild(a);
  });
}

function renderAll() {
  renderNotice();
  if (!data) return;
  renderHeader();
  renderStatus();
  renderHotlines();
  buildDistricts();
  renderShelters();
  renderRoads();
  renderSources();
}

// Refresh "X hours ago" text in place (no re-render, so keyboard focus is kept).
function tick() {
  document.querySelectorAll("span.age[data-ts]").forEach(s => {
    s.textContent = updatedAgo(s.dataset.ts);
  });
  if (data) checkStale();
}

function setLang(l) {
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem("lang", l); } catch (e) {}
  document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.set === l));
  renderAll();
}

// ---------- data loading ----------

function looksValid(d) {
  return !!(d && d.status && d.status.title && typeof d.lastUpdated === "string" &&
    Array.isArray(d.hotlines) && Array.isArray(d.shelters) &&
    Array.isArray(d.roads) && Array.isArray(d.sources));
}

// Render d; if rendering throws (bad data), report failure so we can fall back.
function show(d, reason) {
  const prev = data, prevReason = fallbackReason;
  data = d; fallbackReason = reason;
  try { renderAll(); return true; }
  catch (e) {
    console.error("Render failed", e);
    data = prev; fallbackReason = prevReason;
    return false;
  }
}

function readFallback() {
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

// Only registrations/caches under this site's own path; phantawat.github.io is shared with other sites.
const SCOPE = new URL("./", location.href).href;

function setupServiceWorker(d) {
  if (!("serviceWorker" in navigator)) return;
  if (d && d.serviceWorker === false) {
    // Off-switch in flood.json: remove any installed worker and its caches.
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.filter(r => r.scope === SCOPE).forEach(r => r.unregister()))
      .catch(() => {});
    if (window.caches) {
      caches.keys().then(ks => ks.filter(k => k.startsWith("flood-hub-")).forEach(k => caches.delete(k))).catch(() => {});
    }
    return;
  }
  // update() on every load makes the browser re-fetch sw.js now, instead of whenever it
  // decides to. This is what makes the emergency off-switch (scripts/sw-disable.js) reliable.
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then(reg => reg.update())
    .catch(e => console.warn("Service worker not registered/updated:", e));
}

document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.set)));
$("district").addEventListener("change", renderShelters);
document.documentElement.lang = lang;
document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.set === lang));

// Show the embedded copy immediately (no network wait), then swap in live data.
const fallback = readFallback();
if (fallback) show(fallback, null);

fetchLive()
  .then(({ d, cached }) => {
    if (!show(d, cached ? "fallback" : null)) throw new Error("Live data could not be rendered");
    setupServiceWorker(d);
  })
  .catch(err => {
    console.warn("Using fallback data:", err);
    if (fallback) show(fallback, "fallback");
    else { fallbackReason = "none"; renderNotice(); }
    setupServiceWorker(fallback);
  });

setInterval(tick, 60 * 1000);
})();

/* Builds the HTML for each data-driven section of the page, in Thai and English at once
   (data-th / data-en spans; CSS shows the current language).

   Used in two places, so the output is identical:
   - at deploy time, by scripts/embed-fallback.mjs, to write the content into index.html
     (the page then works with JavaScript disabled);
   - in the browser, by app.js, only when the live data/flood.json is newer than that copy.

   Plain script, no DOM access: loads as window.FloodRender in the browser and via require() in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FloodRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BKK_OFFSET_MS = 7 * 3600 * 1000;
  const ROADS_STALE_MS = 6 * 3600 * 1000;
  const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ROAD_TAGS = {
    "avoid": { th: "เลี่ยง", en: "Avoid" },
    "slow": { th: "ขับช้า", en: "Drive slowly" },
    "no-small-cars": { th: "รถเล็กห้ามผ่าน", en: "No small cars" },
  };

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
  // Thai text sits under the page's lang="th"; English is always marked lang="en".
  // (When the page is switched to English, app.js marks any Thai still visible as lang="th".)
  const bi = (th, en) => '<span data-th>' + esc(th) + '</span><span data-en lang="en">' + esc(en) + '</span>';
  const biObj = o => bi(o.th, o.en);
  // Free text that volunteers may write in either language (source names, link titles):
  // marked lang="en" only if it has letters and no Thai characters.
  const THAI = /[\u0E00-\u0E7F]/;
  const isEnglish = s => !THAI.test(s) && /[A-Za-z]/.test(s);
  const txt = s => (isEnglish(String(s)) ? '<span lang="en">' + esc(s) + '</span>' : esc(s));
  const telHref = n => "tel:" + n.replace(/-/g, "");

  // Date/time parts in Bangkok time, whatever the device or server timezone.
  function bkk(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    const b = new Date(t + BKK_OFFSET_MS);
    return {
      day: b.getUTCDay(), date: b.getUTCDate(), month: b.getUTCMonth(), year: b.getUTCFullYear(),
      hm: String(b.getUTCHours()).padStart(2, "0") + ":" + String(b.getUTCMinutes()).padStart(2, "0"),
    };
  }

  // "เสาร์ 26 ก.ย. 2569 13:15 น." / "Sat 26 Sep 2026, 13:15"
  function stampLong(iso) {
    const p = bkk(iso);
    if (!p) return { th: "", en: "" };
    return {
      th: TH_DAYS[p.day] + " " + p.date + " " + TH_MONTHS[p.month] + " " + (p.year + 543) + " " + p.hm + " น.",
      en: EN_DAYS[p.day] + " " + p.date + " " + EN_MONTHS[p.month] + " " + p.year + ", " + p.hm,
    };
  }

  // "26 ก.ย. 2569" / "26 Sep 2026" — for sources that give a day but no time ("2026-09-26").
  function stampDate(v) {
    const p = bkk(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00+07:00" : v);
    if (!p) return { th: "", en: "" };
    return { th: p.date + " " + TH_MONTHS[p.month] + " " + (p.year + 543), en: p.date + " " + EN_MONTHS[p.month] + " " + p.year };
  }

  // "อัปเดต 26 ก.ย. 13:15 น." / "updated 26 Sep, 13:15" — correct forever, shown without JavaScript.
  function stampShort(iso) {
    const p = bkk(iso);
    if (!p) return { th: "", en: "" };
    return { th: "อัปเดต " + p.date + " " + TH_MONTHS[p.month] + " " + p.hm + " น.", en: "updated " + p.date + " " + EN_MONTHS[p.month] + ", " + p.hm };
  }

  // "อัปเดตเมื่อ 3 ชม. ที่แล้ว" / "updated 3 hours ago" — needs the current time, so JavaScript only.
  function agoHTML(iso, now) {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const mins = Math.max(0, Math.floor((now - t) / 60000));
    if (mins < 1) return bi("อัปเดตเมื่อสักครู่", "updated just now");
    if (mins < 60) return bi("อัปเดตเมื่อ " + mins + " นาทีที่แล้ว", "updated " + mins + " min ago");
    const hours = Math.floor(mins / 60);
    if (hours < 48) return bi("อัปเดตเมื่อ " + hours + " ชม. ที่แล้ว", "updated " + hours + (hours === 1 ? " hour ago" : " hours ago"));
    const days = Math.floor(hours / 24);
    return bi("อัปเดตเมื่อ " + days + " วันที่แล้ว", "updated " + days + " days ago");
  }

  // A time that app.js turns into "X hours ago" (it looks for .age[data-ts]).
  function ageHTML(iso) {
    const s = stampShort(iso);
    return '<span class="age" data-ts="' + esc(iso) + '">' + bi(s.th, s.en) + '</span>';
  }

  function newestRoad(roads) {
    let newest = null;
    roads.forEach(r => {
      const t = Date.parse(r.updated);
      if (!isNaN(t) && (!newest || t > newest.t)) newest = { t: t, road: r };
    });
    return newest;
  }

  function roadsStale(roads, now) {
    const n = newestRoad(roads);
    return !!n && now - n.t > ROADS_STALE_MS;
  }

  function shelterItem(s) {
    const district = s.district ? bi("เขต" + s.district.th, s.district.en) : bi("ไม่ระบุเขต", "District not stated");
    return '<li data-district="' + esc(s.district ? s.district.en : "") + '"><div>' +
      '<div class="name">' + biObj(s.name) + '</div>' +
      '<div class="meta">' + district + '</div>' +
      '<div class="meta">' + ageHTML(s.updated) + (s.source ? " · " + txt(s.source) : "") + '</div>' +
      '</div>' + (s.tel ? '<a class="tel" href="' + esc(telHref(s.tel)) + '">' + esc(s.tel) + '</a>' : "") + '</li>';
  }

  function roadItem(r, mainSource) {
    const tag = ROAD_TAGS[r.type] || { th: r.type, en: r.type };
    return '<li><span class="road"><span class="tag ' + esc(r.type) + '">' + biObj(tag) + '</span>' +
      // Names are shown exactly as written in flood.json (e.g. "ถ.สุขุมวิท", "แยกพงษ์เพชร").
      '<span class="rn">' + biObj(r.name) + '</span></span>' +
      '<span class="meta age-col">' + ageHTML(r.updated) + (r.source && r.source !== mainSource ? " · " + txt(r.source) : "") + '</span></li>';
  }

  // A website or app people can use to check for themselves (the "tools" section).
  function toolItem(t) {
    const kind = t.official ? { cls: "official", th: "ทางการ", en: "Official" } : { cls: "unofficial", th: "ไม่เป็นทางการ", en: "Unofficial" };
    return '<li><div>' +
      '<a class="tool" href="' + esc(t.url) + '">' + biObj(t.name) + '</a>' +
      '<div class="desc">' + biObj(t.description) + '</div>' +
      (t.note ? '<div class="tool-note">' + biObj(t.note) + '</div>' : "") +
      '<div class="meta">' + ageHTML(t.updated) + (t.source ? " · " + txt(t.source) : "") + '</div>' +
      '</div><span class="tag ' + kind.cls + '">' + bi(kind.th, kind.en) + '</span></li>';
  }

  // The whole tools section, heading included; nothing at all when there are no tools yet.
  function toolsSection(tools) {
    if (!tools || !tools.length) return "";
    return '<h2>' + bi("เครื่องมือตรวจสอบ", "Check for yourself") + '</h2>\n<ul class="list">' + tools.map(toolItem).join("\n") + '</ul>';
  }

  // Big "check live road flooding" button (+ optional backup link); nothing when no URL is set.
  function roadsLive(d) {
    if (!d.roadsLiveUrl) return "";
    return '<a class="live-btn" href="' + esc(d.roadsLiveUrl) + '">' + bi("เช็กถนนน้ำท่วมล่าสุด", "Check live road flooding") + '</a>' +
      (d.roadsLiveUrlAlt ? '<a class="live-alt" href="' + esc(d.roadsLiveUrlAlt) + '">' + bi("ลิงก์สำรอง", "Backup link") + '</a>' : "");
  }

  // HTML for every data-driven element, keyed by element id.
  function sections(d) {
    const last = stampLong(d.lastUpdated);
    const newest = newestRoad(d.roads);
    const mainSource = newest ? newest.road.source : "";
    return {
      "updated": bi("อัปเดตล่าสุด: " + last.th, "Last updated: " + last.en),
      "status-title": biObj(d.status.title),
      "status-body": biObj(d.status.body),
      "status-fresh": ageHTML(d.status.updated) + (d.status.source ? " · " + txt(d.status.source) : ""),
      "calls": d.hotlines.map(h =>
        '<a class="call' + (h.urgent ? " urgent" : "") + '" href="' + esc(h.number ? telHref(h.number) : h.url) + '">' +
        '<b>' + (h.number ? esc(h.number) : txt(h.display)) + '</b>' + biObj(h.label) + '</a>').join("\n"),
      "shelters-note": biObj(d.sheltersNote),
      "shelters": d.shelters.map(shelterItem).join("\n"),
      "roads-sub": newest
        ? '<span data-th>ประกาศโดย ' + txt(mainSource) + ' · </span><span data-en lang="en">Source: ' + esc(mainSource) + ' · </span>' +
          ageHTML(newest.road.updated) +
          bi(" สถานการณ์อาจเปลี่ยนแล้ว", ". Conditions may have changed since.")
        : bi("ยังไม่มีรายงานถนน", "No road reports yet."),
      // Empty string when there is no note: the box is hidden by CSS (.note:empty).
      "roads-note": d.roadsNote
        ? biObj(d.roadsNote.text) + '<br><span class="meta">' + ageHTML(d.roadsNote.updated) + " · " + txt(d.roadsNote.source) + '</span>'
        : "",
      "roads-live": roadsLive(d),
      "roads": d.roads.map(r => roadItem(r, mainSource)).join("\n"),
      "tools": toolsSection(d.tools),
      "source-links": " " + d.sources.map(s => '<a href="' + esc(s.url) + '"' + (isEnglish(s.title) ? ' lang="en"' : "") + '>' + esc(s.title) + '</a>').join(", "),
    };
  }

  // damage.html: the assistance table rows and the source line, from d.assistance.
  // "max" is shown exactly as written; if it's { th, en } each language gets its own text.
  function damageSections(d) {
    const a = d.assistance;
    const date = stampDate(a.updated);
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
    return {
      "assist-rows": a.items.map(it =>
        '<tr><th scope="row">' + biObj(it.label) + '</th><td>' + (typeof it.max === "string" ? esc(it.max) : biObj(it.max)) + '</td></tr>').join("\n"),
      "assist-source": bi("ที่มา: " + a.source.th + " " + date.th, "Source: " + a.source.en + ", " + date.en) +
        '<br>' + a.links.map(u => '<a href="' + esc(u) + '" lang="en">' + esc(host(u)) + '</a>').join(" · "),
    };
  }

  return { sections: sections, damageSections: damageSections, agoHTML: agoHTML, roadsStale: roadsStale, telHref: telHref, ROAD_TAGS: ROAD_TAGS };
});

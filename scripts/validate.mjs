#!/usr/bin/env node
// Checks data/flood.json before it goes live. No dependencies: `node scripts/validate.mjs [file]`.
// Exit code 0 = OK (warnings allowed), 1 = errors found (deploy is blocked).
// Every message is printed in English and Thai because volunteers read these in the Actions log.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { createRequire } from "node:module";

// Road types come from the page's own label table, so a type is valid exactly when the page can show it.
const { ROAD_TAGS } = createRequire(import.meta.url)("../render.js");
const ROAD_TYPES = Object.keys(ROAD_TAGS);

const FILE = process.argv[2] || fileURLToPath(new URL("../data/flood.json", import.meta.url));
const SHOWN = relative(process.cwd(), FILE) || FILE;

// Nothing in this file should be dated before the flood event started.
const EARLIEST = Date.parse("2026-09-01T00:00:00+07:00");
const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;
const OLD_WARNING_MS = 24 * 3600 * 1000;

// 1669 / 1555 / 191 · 02-XXX-XXXX (Bangkok) · 0XX-XXX-XXX (provincial) · 06/08/09X-XXX-XXXX (mobile)
const PHONE_RE = /^(1\d{2,3}|02-\d{3}-\d{4}|0[3-7]\d-\d{3}-\d{3}|0[689]\d-\d{3}-\d{4})$/;
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+07:00$/;
const THAI_RE = /[฀-๿]/;

const errors = [];
const warnings = [];
const err = (path, en, th) => errors.push({ path, en, th });
const warn = (path, en, th) => warnings.push({ path, en, th });
const show = v => JSON.stringify(v);

// ---------- field checkers ----------

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function knownKeys(path, obj, allowed) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      warn(`${path}.${k}`, `Unknown field "${k}" (typo?). Allowed: ${allowed.join(", ")}.`,
        `ไม่รู้จักช่อง "${k}" (พิมพ์ผิดหรือเปล่า?) ช่องที่ใช้ได้: ${allowed.join(", ")}`);
    }
  }
}

function required(path, obj, key) {
  if (!(key in obj)) {
    err(`${path}.${key}`, `Missing required field "${key}".`, `ขาดช่อง "${key}" ซึ่งต้องมี`);
    return false;
  }
  return true;
}

function text(path, v) {
  if (typeof v !== "string" || v.trim() === "") {
    err(path, `Must be non-empty text, got ${show(v)}.`, `ต้องเป็นข้อความที่ไม่ว่าง แต่ได้ ${show(v)}`);
    return false;
  }
  return true;
}

function bilingual(path, v) {
  if (!isObj(v)) {
    err(path, `Must be { "th": "...", "en": "..." }, got ${show(v)}.`, `ต้องอยู่ในรูป { "th": "...", "en": "..." } แต่ได้ ${show(v)}`);
    return;
  }
  knownKeys(path, v, ["th", "en"]);
  if (text(`${path}.th`, v.th) && !THAI_RE.test(v.th)) {
    warn(`${path}.th`, `Thai text has no Thai characters: ${show(v.th)}. Are "th" and "en" swapped?`,
      `ช่องภาษาไทยไม่มีตัวอักษรไทย: ${show(v.th)} สลับกับ "en" หรือเปล่า?`);
  }
  if (text(`${path}.en`, v.en) && THAI_RE.test(v.en)) {
    warn(`${path}.en`, `English text contains Thai characters: ${show(v.en)}. Are "th" and "en" swapped?`,
      `ช่องภาษาอังกฤษมีตัวอักษรไทย: ${show(v.en)} สลับกับ "th" หรือเปล่า?`);
  }
}

function phone(path, v) {
  if (typeof v !== "string" || !PHONE_RE.test(v)) {
    err(path, `${show(v)} is not a valid Thai phone number. Use e.g. "1555", "02-248-5115" or "081-234-5678" (digits and dashes only).`,
      `${show(v)} ไม่ใช่รูปแบบเบอร์โทรที่ถูกต้อง ใช้แบบ "1555", "02-248-5115" หรือ "081-234-5678" (ตัวเลขและขีดเท่านั้น)`);
  }
}

// allowHttp: some government tools only work over plain http://, so tools and live-road links may use it.
function url(path, v, { allowHttp = false } = {}) {
  const schemes = allowHttp ? ["https://", "http://"] : ["https://"];
  let ok = typeof v === "string" && schemes.some(s => v.startsWith(s));
  if (ok) { try { new URL(v); } catch { ok = false; } }
  const want = allowHttp ? "https:// or http://" : "https://";
  if (!ok) err(path, `${show(v)} is not a valid ${want} link.`, `${show(v)} ไม่ใช่ลิงก์ ${want} ที่ถูกต้อง`);
}

const TS_HELP_EN = `Use the format "2026-09-26T14:30:00+07:00" (Bangkok time).`;
const TS_HELP_TH = `ใช้รูปแบบ "2026-09-26T14:30:00+07:00" (เวลาไทย)`;

// Returns the parsed time in ms, or null if invalid.
function timestamp(path, v) {
  const m = typeof v === "string" && v.match(TS_RE);
  if (!m) {
    err(path, `${show(v)} is not a valid timestamp. ${TS_HELP_EN}`, `${show(v)} ไม่ใช่เวลาที่ถูกต้อง ${TS_HELP_TH}`);
    return null;
  }
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const s = Number(m[6] || 0);
  // Round-trip check catches impossible dates like 2026-09-31 or 25:00.
  const t = Date.parse(v);
  const b = new Date(t + 7 * 3600 * 1000);
  if (isNaN(t) || b.getUTCFullYear() !== y || b.getUTCMonth() + 1 !== mo || b.getUTCDate() !== d ||
      b.getUTCHours() !== h || b.getUTCMinutes() !== mi || b.getUTCSeconds() !== s) {
    err(path, `${show(v)} is not a real date/time. ${TS_HELP_EN}`, `${show(v)} ไม่ใช่วันที่/เวลาที่มีจริง ${TS_HELP_TH}`);
    return null;
  }
  if (t > Date.now() + FUTURE_TOLERANCE_MS) {
    err(path, `${show(v)} is in the future. Check the date, month and year (years are in AD, e.g. 2026, not 2569).`,
      `${show(v)} เป็นเวลาในอนาคต ตรวจสอบวัน เดือน ปี (ใช้ปี ค.ศ. เช่น 2026 ไม่ใช่ 2569)`);
    return null;
  }
  if (t < EARLIEST) {
    err(path, `${show(v)} is before September 2026. Probably a typo in the year or month.`,
      `${show(v)} อยู่ก่อนเดือนกันยายน 2026 น่าจะพิมพ์ปีหรือเดือนผิด`);
    return null;
  }
  if (Date.now() - t > OLD_WARNING_MS) {
    warn(path, `${show(v)} is more than 24 hours old. Is this still correct?`, `${show(v)} เก่ากว่า 24 ชั่วโมง ยังถูกต้องอยู่ไหม?`);
  }
  return t;
}

// A date without a time, "2026-09-26", for sources that only give a day. Returns ms or null.
function dateOnly(path, v) {
  const m = typeof v === "string" && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return timestamp(path, v); // a full timestamp is fine too
  const t = Date.parse(v + "T00:00:00+07:00");
  const b = new Date(t + 7 * 3600 * 1000);
  if (isNaN(t) || b.getUTCFullYear() !== +m[1] || b.getUTCMonth() + 1 !== +m[2] || b.getUTCDate() !== +m[3]) {
    err(path, `${show(v)} is not a real date. Use "2026-09-26", or a full time like "2026-09-26T14:30:00+07:00".`,
      `${show(v)} ไม่ใช่วันที่ที่มีจริง ใช้ "2026-09-26" หรือเวลาเต็มแบบ "2026-09-26T14:30:00+07:00"`);
    return null;
  }
  if (t > Date.now() + FUTURE_TOLERANCE_MS) { err(path, `${show(v)} is in the future.`, `${show(v)} เป็นวันในอนาคต`); return null; }
  if (t < EARLIEST) { err(path, `${show(v)} is before September 2026. Probably a typo.`, `${show(v)} อยู่ก่อนเดือนกันยายน 2026 น่าจะพิมพ์ผิด`); return null; }
  return t;
}

function list(path, v, { nonEmpty = true } = {}) {
  if (!Array.isArray(v)) {
    err(path, `Must be a list [ ... ].`, `ต้องเป็นรายการ [ ... ]`);
    return [];
  }
  if (nonEmpty && v.length === 0) err(path, `List must not be empty.`, `รายการต้องไม่ว่าง`);
  return v;
}

function noDuplicates(path, items, keyFn, what) {
  const seen = new Map();
  items.forEach((it, i) => {
    const k = keyFn(it);
    if (k == null) return;
    if (seen.has(k)) {
      err(`${path}[${i}]`, `Duplicate ${what} ${show(k)} (same as ${path}[${seen.get(k)}]).`,
        `${what} ซ้ำ ${show(k)} (ซ้ำกับ ${path}[${seen.get(k)}])`);
    } else seen.set(k, i);
  });
}

// ---------- sections ----------

function checkStatus(s) {
  const p = "status";
  if (!isObj(s)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return null; }
  knownKeys(p, s, ["updated", "source", "title", "body"]);
  let t = null;
  if (required(p, s, "updated")) t = timestamp(`${p}.updated`, s.updated);
  if (required(p, s, "source")) text(`${p}.source`, s.source);
  if (required(p, s, "title")) bilingual(`${p}.title`, s.title);
  if (required(p, s, "body")) bilingual(`${p}.body`, s.body);
  return t;
}

function checkHotlines(v) {
  const items = list("hotlines", v);
  items.forEach((h, i) => {
    const p = `hotlines[${i}]`;
    if (!isObj(h)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(p, h, ["number", "url", "display", "urgent", "group", "label"]);
    // Optional: "other" puts it under "Other useful numbers"; without it, it's a main emergency number.
    if ("group" in h && h.group !== "main" && h.group !== "other") {
      err(`${p}.group`, `Must be "main" or "other" (or left out), got ${show(h.group)}.`, `ต้องเป็น "main" หรือ "other" (หรือไม่ใส่) แต่ได้ ${show(h.group)}`);
    }
    const hasNum = "number" in h, hasUrl = "url" in h;
    if (hasNum === hasUrl) {
      err(p, `Needs exactly one of "number" (phone) or "url" (link).`, `ต้องมีอย่างใดอย่างหนึ่ง: "number" (เบอร์โทร) หรือ "url" (ลิงก์)`);
    } else if (hasNum) {
      phone(`${p}.number`, h.number);
    } else {
      url(`${p}.url`, h.url);
      if (required(p, h, "display")) text(`${p}.display`, h.display);
    }
    if (required(p, h, "urgent") && typeof h.urgent !== "boolean") {
      err(`${p}.urgent`, `Must be true or false (no quotes), got ${show(h.urgent)}.`, `ต้องเป็น true หรือ false (ไม่มีเครื่องหมายคำพูด) แต่ได้ ${show(h.urgent)}`);
    }
    if (required(p, h, "label")) bilingual(`${p}.label`, h.label);
  });
  noDuplicates("hotlines", items, h => (isObj(h) ? h.number ?? null : null), "phone number / เบอร์");
}

function checkShelters(v) {
  const items = list("shelters", v);
  const times = [];
  items.forEach((s, i) => {
    const p = `shelters[${i}]`;
    if (!isObj(s)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(p, s, ["name", "district", "tel", "updated", "source", "sourceUrl"]);
    if (required(p, s, "name")) bilingual(`${p}.name`, s.name);
    if (required(p, s, "district") && s.district !== null) bilingual(`${p}.district`, s.district);
    if (required(p, s, "tel") && s.tel !== null) phone(`${p}.tel`, s.tel);
    if (required(p, s, "updated")) times.push(timestamp(`${p}.updated`, s.updated));
    if (required(p, s, "source")) text(`${p}.source`, s.source);
    if ("sourceUrl" in s) url(`${p}.sourceUrl`, s.sourceUrl);
  });
  noDuplicates("shelters", items, s => (isObj(s) && isObj(s.name) ? s.name.th : null), "shelter name / ชื่อศูนย์พักพิง");
  return times;
}

function checkRoads(v) {
  const items = list("roads", v, { nonEmpty: false }); // an empty list is fine once floods recede
  const times = [];
  items.forEach((r, i) => {
    const p = `roads[${i}]`;
    if (!isObj(r)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(p, r, ["name", "type", "updated", "source"]);
    if (required(p, r, "name")) {
      bilingual(`${p}.name`, r.name);
      // Names are written in full ("ถ.สุขุมวิท" / "Sukhumvit Rd"). Catch the prefix/suffix typed twice.
      if (isObj(r.name) && typeof r.name.th === "string" && /^ถ\.\s*ถ\./.test(r.name.th)) {
        warn(`${p}.name.th`, `Starts with "ถ.ถ." — "ถ." is written twice. Write the name once, e.g. "ถ.สุขุมวิท".`,
          `ขึ้นต้นด้วย "ถ.ถ." (ใส่ "ถ." ซ้ำ) ให้เขียนครั้งเดียว เช่น "ถ.สุขุมวิท"`);
      }
      if (isObj(r.name) && typeof r.name.en === "string" && /\bRd\.?\s+Rd\.?$/i.test(r.name.en)) {
        warn(`${p}.name.en`, `Ends with "Rd Rd" — "Rd" is written twice. Write it once, e.g. "Sukhumvit Rd".`,
          `ลงท้ายด้วย "Rd Rd" (ใส่ "Rd" ซ้ำ) ให้เขียนครั้งเดียว เช่น "Sukhumvit Rd"`);
      }
    }
    if (required(p, r, "type") && !ROAD_TYPES.includes(r.type)) {
      err(`${p}.type`, `Must be one of ${ROAD_TYPES.map(t => `"${t}" (${ROAD_TAGS[t].en})`).join(", ")}, got ${show(r.type)}.`,
        `ต้องเป็นหนึ่งใน ${ROAD_TYPES.map(t => `"${t}" (${ROAD_TAGS[t].th})`).join(", ")} แต่ได้ ${show(r.type)}`);
    }
    if (required(p, r, "updated")) times.push(timestamp(`${p}.updated`, r.updated));
    if (required(p, r, "source")) text(`${p}.source`, r.source);
  });
  noDuplicates("roads", items, r => (isObj(r) && isObj(r.name) ? r.name.th : null), "road name / ชื่อถนน");
  return times;
}

// A note with its own freshness: the road note (optional; remove to hide) and the shelter note
// (required). Same shape: { updated, source, text: { th, en } }.
function checkNote(p, n) {
  if (!isObj(n)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return null; }
  knownKeys(p, n, ["updated", "source", "text"]);
  let t = null;
  if (required(p, n, "updated")) t = timestamp(`${p}.updated`, n.updated);
  if (required(p, n, "source")) text(`${p}.source`, n.source);
  if (required(p, n, "text")) bilingual(`${p}.text`, n.text);
  return t;
}

// Websites/apps for checking the situation yourself. Optional list; may be empty.
function checkTools(v) {
  const times = [];
  if (!Array.isArray(v)) { err("tools", "Must be a list [ ... ].", "ต้องเป็นรายการ [ ... ]"); return times; }
  v.forEach((t, i) => {
    const p = `tools[${i}]`;
    if (!isObj(t)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(p, t, ["name", "description", "url", "official", "note", "updated", "source"]);
    if (required(p, t, "name")) bilingual(`${p}.name`, t.name);
    if (required(p, t, "description")) bilingual(`${p}.description`, t.description);
    if (required(p, t, "url")) url(`${p}.url`, t.url, { allowHttp: true });
    if (required(p, t, "official") && typeof t.official !== "boolean") {
      err(`${p}.official`, `Must be true or false (no quotes), got ${show(t.official)}.`, `ต้องเป็น true หรือ false (ไม่มีเครื่องหมายคำพูด) แต่ได้ ${show(t.official)}`);
    }
    if ("note" in t) bilingual(`${p}.note`, t.note);
    if (required(p, t, "updated")) times.push(timestamp(`${p}.updated`, t.updated));
    if (required(p, t, "source")) text(`${p}.source`, t.source);
  });
  noDuplicates("tools", v, t => (isObj(t) ? t.url ?? null : null), "link / ลิงก์");
  return times;
}

// Assistance amounts shown on damage.html. "max" is either one text for both languages
// ("49,500 บาท / baht per house") or separate { "th": ..., "en": ... }.
function checkAssistance(a) {
  const p = "assistance";
  if (!isObj(a)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
  knownKeys(p, a, ["updated", "source", "links", "items"]);
  if (required(p, a, "updated")) dateOnly(`${p}.updated`, a.updated);
  if (required(p, a, "source")) bilingual(`${p}.source`, a.source);
  if (required(p, a, "links")) list(`${p}.links`, a.links).forEach((u, i) => url(`${p}.links[${i}]`, u));
  if (required(p, a, "items")) list(`${p}.items`, a.items).forEach((it, i) => {
    const q = `${p}.items[${i}]`;
    if (!isObj(it)) { err(q, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(q, it, ["label", "max"]);
    if (required(q, it, "label")) bilingual(`${q}.label`, it.label);
    if (required(q, it, "max")) {
      if (isObj(it.max)) bilingual(`${q}.max`, it.max);
      else text(`${q}.max`, it.max);
    }
  });
}

// Optional donation points section: a note and a list of places with phone numbers.
function checkDonations(dn) {
  const p = "donations", times = [];
  if (!isObj(dn)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return times; }
  knownKeys(p, dn, ["note", "points"]);
  if (required(p, dn, "note")) bilingual(`${p}.note`, dn.note);
  if (required(p, dn, "points")) {
    const points = list(`${p}.points`, dn.points, { nonEmpty: false });
    points.forEach((x, i) => {
      const q = `${p}.points[${i}]`;
      if (!isObj(x)) { err(q, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
      knownKeys(q, x, ["name", "phones", "updated", "source"]);
      if (required(q, x, "name")) bilingual(`${q}.name`, x.name);
      if (required(q, x, "phones")) list(`${q}.phones`, x.phones).forEach((n, j) => phone(`${q}.phones[${j}]`, n));
      if (required(q, x, "updated")) times.push(timestamp(`${q}.updated`, x.updated));
      if (required(q, x, "source")) text(`${q}.source`, x.source);
    });
    noDuplicates(`${p}.points`, points, x => (isObj(x) && isObj(x.name) ? x.name.th : null), "donation point / จุดรับบริจาค");
  }
  return times;
}

function checkSources(v) {
  list("sources", v).forEach((s, i) => {
    const p = `sources[${i}]`;
    if (!isObj(s)) { err(p, "Must be an object { ... }.", "ต้องเป็นออบเจ็กต์ { ... }"); return; }
    knownKeys(p, s, ["title", "url"]);
    if (required(p, s, "title")) text(`${p}.title`, s.title);
    if (required(p, s, "url")) url(`${p}.url`, s.url);
  });
}

// ---------- parse ----------

function lineCol(raw, pos) {
  const before = raw.slice(0, pos);
  const line = before.split("\n").length;
  return { line, col: pos - before.lastIndexOf("\n") };
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const pos = Number((e.message.match(/position (\d+)/) || [])[1]);
    const where = Number.isFinite(pos) ? lineCol(raw, pos) : null;
    const at = where ? ` (line ${where.line}, column ${where.col})` : "";
    const atTh = where ? ` (บรรทัด ${where.line} ตำแหน่ง ${where.col})` : "";
    err("(file)", `The file is not valid JSON${at}: ${e.message}`, `ไฟล์ไม่ใช่ JSON ที่ถูกต้อง${atTh}`);
    if (where) {
      const lines = raw.split("\n");
      for (let n = Math.max(1, where.line - 2); n <= Math.min(lines.length, where.line); n++) {
        console.error(`   ${String(n).padStart(4)} | ${lines[n - 1]}`);
      }
    }
    if (/Expected ','/.test(e.message) && where) {
      err("(file)", `Probably a missing comma , just before line ${where.line}, column ${where.col} (often at the end of the line above).`,
        `น่าจะขาดจุลภาค , ก่อนบรรทัด ${where.line} ตำแหน่ง ${where.col} (มักอยู่ท้ายบรรทัดก่อนหน้า)`);
    }
    if (/[“”‘’]/.test(raw.replace(/"(?:[^"\\\n]|\\.)*"/g, '""'))) {
      err("(file)", `Curly quotes “ ” found outside text. Replace them with straight quotes " (this often happens when copying from LINE or Word).`,
        `พบเครื่องหมายคำพูดแบบโค้ง “ ” ให้เปลี่ยนเป็น " แบบตรง (มักเกิดจากการคัดลอกจาก LINE หรือ Word)`);
    }
    if (/,\s*[}\]]/.test(raw)) {
      err("(file)", `There is a comma right before a closing } or ]. Remove that last comma.`, `มีจุลภาค , อยู่หน้า } หรือ ] ให้ลบจุลภาคตัวสุดท้ายออก`);
    }
    return undefined;
  }
}

// ---------- main ----------

function run() {
  let raw;
  try { raw = readFileSync(FILE, "utf8").replace(/^﻿/, ""); }
  catch (e) { err("(file)", `Cannot read ${SHOWN}: ${e.message}`, `อ่านไฟล์ ${SHOWN} ไม่ได้`); return; }

  const d = parse(raw);
  if (d === undefined) return;
  if (!isObj(d)) { err("(file)", "The top level must be an object { ... }.", "ระดับบนสุดต้องเป็นออบเจ็กต์ { ... }"); return; }

  knownKeys("(root)", d, ["lastUpdated", "status", "hotlines", "sheltersNote", "shelters", "roadsNote", "roadsLiveUrl", "roadsLiveUrlAlt", "roadsLiveUrlAltLabel", "donations", "roads", "tools", "assistance", "sources", "serviceWorker"]);
  if ("serviceWorker" in d && typeof d.serviceWorker !== "boolean") {
    err("serviceWorker", `Must be true or false (no quotes), got ${show(d.serviceWorker)}.`, `ต้องเป็น true หรือ false (ไม่มีเครื่องหมายคำพูด) แต่ได้ ${show(d.serviceWorker)}`);
  }
  // The header shows the newest "updated" in the file (render.js). "lastUpdated" must still be
  // present: older copies of app.js kept in visitors' browsers reject data without it.
  if (required("(root)", d, "lastUpdated")) timestamp("lastUpdated", d.lastUpdated);
  const times = [];
  if (required("(root)", d, "status")) times.push(checkStatus(d.status));
  if (required("(root)", d, "hotlines")) checkHotlines(d.hotlines);
  if (required("(root)", d, "sheltersNote")) times.push(checkNote("sheltersNote", d.sheltersNote));
  if (required("(root)", d, "shelters")) times.push(...checkShelters(d.shelters));
  if (required("(root)", d, "roads")) times.push(...checkRoads(d.roads));
  if ("roadsNote" in d) times.push(checkNote("roadsNote", d.roadsNote));
  if ("roadsLiveUrl" in d) url("roadsLiveUrl", d.roadsLiveUrl, { allowHttp: true });
  if ("roadsLiveUrlAlt" in d) {
    url("roadsLiveUrlAlt", d.roadsLiveUrlAlt, { allowHttp: true });
    if (!("roadsLiveUrl" in d)) err("roadsLiveUrlAlt", `A backup link needs a main "roadsLiveUrl" too.`, `ต้องมี "roadsLiveUrl" (ลิงก์หลัก) ก่อนจึงจะใส่ลิงก์สำรองได้`);
  }
  if ("roadsLiveUrlAltLabel" in d) {
    bilingual("roadsLiveUrlAltLabel", d.roadsLiveUrlAltLabel);
    if (!("roadsLiveUrlAlt" in d)) err("roadsLiveUrlAltLabel", `A label needs a "roadsLiveUrlAlt" link too.`, `ต้องมี "roadsLiveUrlAlt" ก่อนจึงจะใส่ชื่อลิงก์ได้`);
  }
  if ("tools" in d) times.push(...checkTools(d.tools));
  if ("donations" in d) times.push(...checkDonations(d.donations));
  if (required("(root)", d, "assistance")) checkAssistance(d.assistance);
  if (required("(root)", d, "sources")) checkSources(d.sources);

}

run();

const gh = process.env.GITHUB_ACTIONS === "true";
const esc = s => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

for (const w of warnings) {
  console.log(`⚠️  WARNING ${w.path}: ${w.en}\n    คำเตือน: ${w.th}`);
  if (gh) console.log(`::warning file=${SHOWN},title=${esc(w.path)}::${esc(w.en + "\n" + w.th)}`);
}
for (const e of errors) {
  console.log(`❌ ERROR ${e.path}: ${e.en}\n    ข้อผิดพลาด: ${e.th}`);
  if (gh) console.log(`::error file=${SHOWN},title=${esc(e.path)}::${esc(e.en + "\n" + e.th)}`);
}

if (errors.length) {
  console.log(`\n${SHOWN}: ${errors.length} error(s), ${warnings.length} warning(s). The site was NOT updated.`);
  console.log(`พบข้อผิดพลาด ${errors.length} รายการ หน้าเว็บยังไม่ถูกอัปเดต กรุณาแก้ไขแล้ว commit ใหม่`);
  process.exit(1);
}
console.log(`\n✅ ${SHOWN} is valid (${warnings.length} warning(s)). / ข้อมูลถูกต้อง`);

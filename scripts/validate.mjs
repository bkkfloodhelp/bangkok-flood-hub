#!/usr/bin/env node
// Checks data/flood.json before it goes live. No dependencies: `node scripts/validate.mjs [file]`.
// Exit code 0 = OK (warnings allowed), 1 = errors found (deploy is blocked).
// Every message is printed in English and Thai because volunteers read these in the Actions log.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

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

function url(path, v) {
  let ok = typeof v === "string" && v.startsWith("https://");
  if (ok) { try { new URL(v); } catch { ok = false; } }
  if (!ok) err(path, `${show(v)} is not a valid https:// link.`, `${show(v)} ไม่ใช่ลิงก์ https:// ที่ถูกต้อง`);
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
    knownKeys(p, h, ["number", "url", "display", "urgent", "label"]);
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
      if (isObj(r.name) && typeof r.name.th === "string" && /^ถ(\.|นน)/.test(r.name.th)) {
        warn(`${p}.name.th`, `Leave out "ถ." / "ถนน" — the page adds "ถ." itself.`, `ไม่ต้องใส่ "ถ." หรือ "ถนน" หน้าชื่อ หน้าเว็บเติมให้เอง`);
      }
      if (isObj(r.name) && typeof r.name.en === "string" && /\s(Rd|Road)\.?$/i.test(r.name.en)) {
        warn(`${p}.name.en`, `Leave out "Rd" / "Road" — the page adds " Rd" itself.`, `ไม่ต้องใส่ "Rd" / "Road" หน้าเว็บเติมให้เอง`);
      }
    }
    if (required(p, r, "type") && r.type !== "avoid" && r.type !== "slow") {
      err(`${p}.type`, `Must be "avoid" or "slow", got ${show(r.type)}.`, `ต้องเป็น "avoid" (เลี่ยง) หรือ "slow" (ขับช้า) แต่ได้ ${show(r.type)}`);
    }
    if (required(p, r, "updated")) times.push(timestamp(`${p}.updated`, r.updated));
    if (required(p, r, "source")) text(`${p}.source`, r.source);
  });
  noDuplicates("roads", items, r => (isObj(r) && isObj(r.name) ? r.name.th : null), "road name / ชื่อถนน");
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

  knownKeys("(root)", d, ["lastUpdated", "status", "hotlines", "sheltersNote", "shelters", "roads", "sources", "serviceWorker"]);
  if ("serviceWorker" in d && typeof d.serviceWorker !== "boolean") {
    err("serviceWorker", `Must be true or false (no quotes), got ${show(d.serviceWorker)}.`, `ต้องเป็น true หรือ false (ไม่มีเครื่องหมายคำพูด) แต่ได้ ${show(d.serviceWorker)}`);
  }
  let last = null;
  if (required("(root)", d, "lastUpdated")) last = timestamp("lastUpdated", d.lastUpdated);
  const times = [];
  if (required("(root)", d, "status")) times.push(checkStatus(d.status));
  if (required("(root)", d, "hotlines")) checkHotlines(d.hotlines);
  if (required("(root)", d, "sheltersNote")) bilingual("sheltersNote", d.sheltersNote);
  if (required("(root)", d, "shelters")) times.push(...checkShelters(d.shelters));
  if (required("(root)", d, "roads")) times.push(...checkRoads(d.roads));
  if (required("(root)", d, "sources")) checkSources(d.sources);

  const newest = Math.max(...times.filter(t => t != null));
  if (last != null && Number.isFinite(newest) && newest > last) {
    warn("lastUpdated", `"lastUpdated" is older than the newest item. Did you forget to update it?`,
      `"lastUpdated" เก่ากว่ารายการที่อัปเดตล่าสุด ลืมแก้เวลานี้หรือเปล่า?`);
  }
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

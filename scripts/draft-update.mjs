#!/usr/bin/env node
// Drafts an update to data/flood.json from the news sources in scripts/draft-sources.json, for a
// PERSON to review. Used by .github/workflows/draft-update.yml, which puts the result on a new
// branch and opens a pull request. It never publishes anything itself.
//
//   node scripts/draft-update.mjs [--body pr-body.md] [--mock-response file.json] [--dry-run]
//
//   --body           where to write the pull-request description (default: pr-body.md)
//   --mock-response  use a saved model response instead of calling the Claude API (for testing)
//   --dry-run        don't write data/flood.json
//   --save-docs      also save the downloaded documents to this file (for building test responses)
//   --replay-docs    use documents saved with --save-docs instead of fetching (repeatable tests)
//
// Needs ANTHROPIC_API_KEY (unless --mock-response); TMD_API_UID / TMD_API_KEY for the TMD feed
// (skipped and flagged if missing). No npm dependencies (Node 22+).
//
// Safety rules, enforced here in code, not left to the model:
//   - only "status", "roadsNote", "roads" and "shelters" can change; hotlines, assistance and
//     everything else must come out byte-identical, or the whole draft is abandoned;
//   - every change must cite one of the documents this script downloaded, with a quote that
//     appears word-for-word in it; the source name, URL and publication time written into
//     flood.json come from this script's own download records, never from the model;
//   - the publication time comes from the article's metadata, or from a time the model quotes
//     word-for-word from the page; a change without one is dropped;
//   - each change is applied on its own and must pass scripts/validate.mjs, or it is dropped.

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "data/flood.json");
const MODEL = process.env.DRAFT_MODEL || "claude-sonnet-5";
const SECTIONS = ["status", "roadsNote", "roads", "shelters"];
const MAX_DOC_CHARS = 20000;         // per document sent to the model (noted in the prompt when cut)
const FETCH_TIMEOUT_MS = 30000;
const EARLIEST = Date.parse("2026-09-01T00:00:00+07:00");
const UA = "Mozilla/5.0 (compatible; bkkfloodhelp-draft-bot/1.0; +https://bkkfloodhelp.github.io/bangkok-flood-hub/)";

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const BODY_FILE = arg("--body") || "pr-body.md";
const MOCK = arg("--mock-response");
const DRY = process.argv.includes("--dry-run");

const bkkIso = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 19) + "+07:00";
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- fetching and reading pages ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);

function pageText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map(norm).filter(Boolean).join("\n");
}

// The article's own text, without menus, "related news" sidebars and other stories' headlines
// (they would let a quote from another story pass the check). News sites here don't mark it up
// consistently, so take the largest run of consecutive <p> paragraphs. Returns null if unsure.
function mainText(html) {
  const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => ({ at: m.index, end: m.index + m[0].length, text: norm(decode(m[1].replace(/<[^>]+>/g, " "))) }))
    .filter(p => p.text.length >= 2);
  let best = [], run = [];
  const size = list => list.reduce((n, x) => n + x.text.length, 0);
  for (const p of paras) {
    if (run.length && p.at - run[run.length - 1].end > 2000) run = []; // too far apart: a new block
    run.push(p);
    if (size(run) > size(best)) best = [...run];
  }
  const text = best.map(p => p.text).join("\n");
  return text.length >= 200 ? text : null;
}

function pageTitle(html) {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]+)/i);
  return m ? norm(decode(m[1])) : "";
}

// Publication time from the page's own metadata (article:published_time, JSON-LD datePublished, ...).
function publishedTime(html) {
  const pats = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished|pubdate|publish-date|date)["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    const t = m && Date.parse(m[1]);
    if (t && !isNaN(t)) return t;
  }
  return null;
}

const FLOODY = /น้ำท่วม|ท่วมขัง|ฝนตกหนัก|ระบายน้ำ|ศูนย์พักพิง|อพยพ|ถนน.*(ปิด|ท่วม)|flood|heavy rain|shelter|evacuat|drain|road closure|impassable/i;

function floodLinks(html, base, n) {
  if (!n) return [];
  const out = [], seen = new Set([base.split("#")[0]]);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url; try { url = new URL(decode(m[1]), base); } catch { continue; }
    if (url.host !== new URL(base).host || !/^https?:$/.test(url.protocol)) continue;
    const text = norm(decode(m[2].replace(/<[^>]+>/g, " ")));
    if (text.length < 15 || !FLOODY.test(text)) continue;
    const href = url.href.split("#")[0];
    if (seen.has(href)) continue;
    seen.add(href); out.push(href);
    if (out.length >= n) break;
  }
  return out;
}

async function get(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const html = await r.text();
    return r.ok ? { ok: true, status: r.status, url: r.url || url, html } : { ok: false, status: r.status, url, error: `HTTP ${r.status}` };
  } catch (e) {
    const why = e.name === "TimeoutError" ? "timed out" : [e.message, e.cause?.code || e.cause?.message].filter(Boolean).join(": ");
    return { ok: false, status: 0, url, error: why };
  }
}

async function collect(sources) {
  const docs = [], report = [];
  // Only articles get a publication time from metadata. A listing page's metadata/<time> belongs
  // to whichever story is first, so for those the model must quote the time from the text.
  const add = (name, url, page, fetchedAt, isArticle) => {
    // Articles: only the article's own text (title + summary + body). If the body can't be found
    // with confidence, treat the page like a listing page: full text, and no metadata time.
    const body = isArticle ? mainText(page.html) : null;
    const desc = (page.html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i) || [])[1];
    const text = body ? [pageTitle(page.html), desc ? norm(decode(desc)) : "", body].filter(Boolean).join("\n") : pageText(page.html);
    const t = body ? publishedTime(page.html) : null;
    const doc = { id: `D${docs.length + 1}`, name, url: page.url || url, title: pageTitle(page.html), fetchedAt,
      publishedAt: t && t >= EARLIEST && t <= Date.now() + 15 * 60e3 ? t : null,
      text: text.slice(0, MAX_DOC_CHARS), truncated: text.length > MAX_DOC_CHARS };
    docs.push(doc); return doc;
  };
  for (const s of sources) {
    // "{NAME}" in a URL is filled in from the environment (a secret, e.g. {TMD_API_KEY}). The
    // filled-in URL is used only for the request itself; everything shown in the pull request,
    // the logs or sent to the model uses the URL with "{NAME}" kept, and secret values are masked.
    const needed = [...s.url.matchAll(/\{([A-Z0-9_]+)\}/g)].map(m => m[1]);
    const missing = needed.filter(n => !process.env[n]);
    if (missing.length) { report.push({ name: s.name, url: s.url, ok: false, detail: `skipped: ${missing.join(" and ")} not set` }); continue; }
    const secrets = needed.map(n => process.env[n]);
    const mask = str => secrets.reduce((out, v) => out.split(v).join("***").split(encodeURIComponent(v)).join("***"), String(str));
    const realUrl = s.url.replace(/\{([A-Z0-9_]+)\}/g, (_, n) => encodeURIComponent(process.env[n]));
    const fetchedAt = Date.now();
    const got = await get(realUrl);
    if (!got.ok) { report.push({ name: s.name, url: s.url, ok: false, detail: mask(got.error) }); continue; }
    // Some APIs (e.g. TMD) answer a wrong key with HTTP 200 and a short "Authentication fail".
    const short = norm(pageText(got.html));
    if (needed.length && short.length < 200 && /authenticat\w* fail|invalid (api )?key|unauthori[sz]ed|access denied/i.test(short)) {
      report.push({ name: s.name, url: s.url, ok: false, detail: `rejected the key (“${mask(short)}”): check ${needed.join(" and ")}` });
      continue;
    }
    const shownUrl = needed.length ? s.url : got.url || s.url;
    const page = { ...got, url: shownUrl, html: mask(got.html) };
    const doc = add(s.name, shownUrl, page, fetchedAt, false);
    report.push({ name: s.name, url: shownUrl, ok: true, detail: `${doc.text.length.toLocaleString()} chars of text${doc.text.length < 500 ? " (very little text, page may need JavaScript)" : ""}` });
    const follow = needed.length ? 0 : Math.min(4, s.followLinks || 0); // never follow links from a URL that carries a secret
    for (const link of floodLinks(page.html, shownUrl, follow)) {
      const art = await get(link);
      if (!art.ok) { report.push({ name: `${s.name} (article)`, url: link, ok: false, detail: art.error }); continue; }
      const d = add(s.name, link, art, Date.now(), true);
      report.push({ name: `${s.name} (article)`, url: d.url, ok: true, detail: d.publishedAt ? `published ${bkkIso(d.publishedAt)}` : "no reliable publication time (article text not identified, or no time in its metadata)" });
    }
  }
  return { docs, report };
}

// ---------- asking Claude ----------

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["changes", "notes"],
  properties: {
    notes: { type: "string", description: "Short summary of what the sources say, and anything you chose not to change." },
    changes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["section", "action", "match", "valueJson", "docId", "quote", "publishedAt", "timeQuote", "reason"],
        properties: {
          section: { type: "string", enum: SECTIONS },
          action: { type: "string", enum: ["replace", "add", "update", "remove"] },
          match: { type: "string", description: "For update/remove of a road or shelter: its exact current name.th. Otherwise empty." },
          valueJson: { type: "string", description: "The new value as a JSON object (empty for remove). Same shape as in flood.json; 'updated' and 'source' are filled in automatically." },
          docId: { type: "string", description: "The document (D1, D2, ...) that supports this change." },
          quote: { type: "string", description: "A passage copied WORD FOR WORD from that document that supports the change (20-300 characters)." },
          publishedAt: { type: "string", description: "When the document was published, ISO 8601 with +07:00. Use the document's publishedAt if given; otherwise only if the page states it." },
          timeQuote: { type: "string", description: "If the document has no publishedAt: the exact words from the page that state its publication time. Otherwise empty." },
          reason: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You help volunteers keep an emergency flood information page for Bangkok up to date. Your output is a DRAFT that a person reviews before anything is published, so be conservative and precise.

Propose changes ONLY to these parts of flood.json: "status", "roadsNote", "roads", "shelters". Never propose changes to hotlines, phone numbers of hotlines, assistance amounts, or anything else.

Rules:
- Only propose a change that a provided document clearly supports. Every change cites one document (docId) and includes a passage copied word for word from it (quote). A change whose quote is not in the document is thrown away.
- Every change needs the document's publication time. Use the document's publishedAt when given. If it is not given, only include the change if the page itself states the time, and copy those exact words into timeQuote. Never guess a time.
- Keep existing entries unless a source says they changed. Do not rewrite wording just for style. Don't propose a change that repeats what flood.json already says.
- Write both Thai ("th") and English ("en") for every text. Copy names of roads, places and shelters exactly as the source writes them. If the source gives a name in only one language, write the other language as a careful rendering and say so in "reason" (e.g. "Thai name rendered from the English source; please check"), so the reviewer can confirm it. Road names are written in full as they should appear (e.g. "ถ.สุขุมวิท" / "Sukhumvit Rd"; a place that is not a road name has no "ถ." or "Rd").
- Road "type" is one of "avoid", "slow", "no-small-cars". Shelter phone numbers use the format "081-234-5678" and may be null if not given; district may be null.
- If nothing should change, return an empty "changes" list. That is a good outcome.`;

async function askClaude(current, docs) {
  if (MOCK) return JSON.parse(readFileSync(MOCK, "utf8"));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const docText = docs.map(d => [
    `<document id="${d.id}">`,
    `source: ${d.name}`, `url: ${d.url}`, `title: ${d.title || "(none)"}`,
    `publishedAt: ${d.publishedAt ? bkkIso(d.publishedAt) : "(not stated in page metadata)"}`,
    d.truncated ? `note: text cut to the first ${MAX_DOC_CHARS} characters` : null,
    "text:", d.text, "</document>",
  ].filter(v => v !== null).join("\n")).join("\n\n");
  const user = `Current time in Bangkok: ${bkkIso(Date.now())}\n\nCurrent flood.json (only the parts you may change):\n` +
    JSON.stringify({ status: current.status, roadsNote: current.roadsNote, roads: current.roads, shelters: current.shelters }, null, 1) +
    `\n\nDocuments fetched just now:\n\n${docText}\n\nPropose changes as described.`;
  const body = {
    model: MODEL, max_tokens: 16000,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM, messages: [{ role: "user", content: user }],
  };
  for (let attempt = 1; ; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10 * 60e3),
    });
    const res = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(ok => setTimeout(ok, 15000 * attempt)); continue; }
    if (!r.ok) throw new Error(`Claude API error ${r.status}: ${res.error?.message || JSON.stringify(res).slice(0, 300)}`);
    if (res.stop_reason === "refusal") return { changes: [], notes: `The model declined this request (refusal${res.stop_details?.category ? ": " + res.stop_details.category : ""}). No changes proposed.`, model: res.model };
    if (res.stop_reason === "max_tokens") throw new Error("The model's answer was cut off (max_tokens); no changes applied.");
    const text = (res.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const out = JSON.parse(text);
    out.model = res.model;
    return out;
  }
}

// ---------- checking and applying proposed changes ----------

function validates(data) {
  const dir = mkdtempSync(join(tmpdir(), "draft-")), file = join(dir, "flood.json");
  writeFileSync(file, JSON.stringify(data, null, 2));
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/validate.mjs"), file], { encoding: "utf8" });
  const firstError = (r.stdout.match(/❌ ERROR ([^\n]+)/) || [])[1];
  return { ok: r.status === 0, error: firstError };
}

const describe = {
  status: s => s ? `${s.title?.th || ""}: ${clip(norm(s.body?.th), 90)}` : "—",
  roadsNote: n => n ? clip(norm(n.text?.th), 110) : "—",
  roads: r => r ? `${r.name?.th} (${r.type})` : "—",
  shelters: s => s ? `${s.name?.th}${s.tel ? " · " + s.tel : ""}${s.district ? " · เขต" + s.district.th : ""}` : "—",
};

function applyOne(data, c, doc, t) {
  const next = structuredClone(data);
  let value = c.action === "remove" ? null : JSON.parse(c.valueJson);
  if (value && (typeof value !== "object" || Array.isArray(value))) throw new Error("value is not a JSON object");
  if (value) {
    value.updated = bkkIso(t);
    value.source = doc.name;
    if (c.section === "shelters" && /^https:\/\//.test(doc.url)) value.sourceUrl = doc.url;
    value = ordered(c.section, value);
  }
  let before = null;
  if (c.section === "status" || c.section === "roadsNote") {
    if (c.action !== "replace") throw new Error(`${c.section} can only be replaced`);
    before = data[c.section];
    next[c.section] = value;
  } else {
    const list = next[c.section], i = list.findIndex(x => x.name?.th === c.match);
    if (c.action === "add") {
      if (list.some(x => x.name?.th === value.name?.th)) throw new Error(`"${value.name?.th}" is already listed`);
      list.push(value);
    } else if (c.action === "update" || c.action === "remove" || c.action === "replace") {
      if (i < 0) throw new Error(`no existing ${c.section} entry named "${c.match}"`);
      before = list[i];
      if (c.action === "remove") list.splice(i, 1); else list[i] = value;
    }
  }
  return { next, before, after: value };
}

function checkChange(c, docs) {
  const doc = docs.find(d => d.id === c.docId);
  if (!doc) return { why: `cites unknown document "${c.docId}"` };
  const q = norm(c.quote);
  if (q.length < 20) return { why: "quote too short to verify" };
  if (!norm(doc.text).includes(q)) return { why: `quote not found in ${doc.id} (${doc.url})` };
  let t = doc.publishedAt;
  if (!t) {
    const tq = norm(c.timeQuote), claimed = Date.parse(c.publishedAt);
    if (!tq || !norm(doc.text).includes(tq)) return { why: "no publication time in the page's metadata, and no time quoted word-for-word from the page" };
    if (isNaN(claimed)) return { why: `publication time "${c.publishedAt}" is not a valid date` };
    t = claimed;
  }
  if (t > Date.now() + 15 * 60e3) return { why: "publication time is in the future" };
  if (t < EARLIEST) return { why: "publication time is before September 2026" };
  return { doc, t };
}

// Write flood.json changing only what changed: unchanged fields and unchanged list entries keep
// their exact original text, and new entries follow the style already used in that list (roads
// are one line each), so the pull request's diff shows just the real changes.
const KEY_ORDER = {
  status: ["updated", "source", "title", "body"], roadsNote: ["updated", "source", "text"],
  roads: ["name", "type", "updated", "source"], shelters: ["name", "district", "tel", "updated", "source", "sourceUrl"],
};
const ordered = (section, v) => v && typeof v === "object"
  ? Object.fromEntries([...(KEY_ORDER[section] || []).filter(k => k in v), ...Object.keys(v).filter(k => !(KEY_ORDER[section] || []).includes(k))].map(k => [k, v[k]]))
  : v;
const oneLine = v => Array.isArray(v) ? "[" + v.map(oneLine).join(", ") + "]"
  : v && typeof v === "object" ? "{ " + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${oneLine(x)}`).join(", ") + " }"
  : JSON.stringify(v);

// End of the JSON value starting at text[i]; for arrays also the [start, end) of each item.
function scanValue(text, i) {
  const items = []; let depth = 0, inStr = false, itemStart = -1;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (ch === "\\") j++; else if (ch === '"') inStr = false; continue; }
    if (depth === 1 && itemStart < 0 && !/[\s,\]]/.test(ch)) itemStart = j;
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { if (itemStart >= 0) items.push([itemStart, j]); return { end: j + 1, items: items.map(([a, b]) => text.slice(a, b).trimEnd()) }; }
    } else if (ch === "," && depth === 1 && itemStart >= 0) { items.push([itemStart, j]); itemStart = -1; }
    if (depth === 0 && (ch === "," || ch === "\n")) return { end: j, items };
  }
  return { end: text.length, items };
}

function rewriteFields(text, before, after) {
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const at = text.indexOf(`\n  "${key}": `);
    if (at < 0) return JSON.stringify(after, null, 2) + "\n"; // a new field: fall back to a full rewrite
    const valueStart = text.indexOf(": ", at) + 2;
    const { end, items } = scanValue(text, valueStart);
    let value;
    if (Array.isArray(after[key]) && Array.isArray(before[key])) {
      const reuse = new Map(items.map(t => [JSON.stringify(JSON.parse(t)), t]));
      const singleLine = items.length > 0 && !items[0].includes("\n");
      const parts = after[key].map(it => reuse.get(JSON.stringify(it)) ??
        (singleLine ? oneLine(it) : JSON.stringify(it, null, 2).replace(/\n/g, "\n    ")));
      value = parts.length ? "[\n    " + parts.join(",\n    ") + "\n  ]" : "[]";
    } else value = JSON.stringify(after[key], null, 2).replace(/\n/g, "\n  ");
    text = text.slice(0, valueStart) + value + text.slice(end);
  }
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(after)) throw new Error("rewriteFields produced different data"); // must round-trip exactly
  return text;
}

// ---------- main ----------

const original = JSON.parse(readFileSync(DATA, "utf8"));
const { sources } = JSON.parse(readFileSync(join(ROOT, "scripts/draft-sources.json"), "utf8"));
// --replay-docs <file>: re-use documents saved earlier with --save-docs (repeatable tests).
const { docs, report } = arg("--replay-docs")
  ? (d => ({ docs: d, report: d.map(x => ({ name: x.name, url: x.url, ok: true, detail: "replayed from a saved download" })) }))(
      JSON.parse(readFileSync(arg("--replay-docs"), "utf8")).map(x => ({ ...x, publishedAt: x.publishedAt ? Date.parse(x.publishedAt) : null })))
  : await collect(sources);
const failed = report.filter(r => !r.ok);
if (arg("--save-docs")) writeFileSync(arg("--save-docs"), JSON.stringify(docs.map(d => ({ ...d, publishedAt: d.publishedAt && bkkIso(d.publishedAt) })), null, 1));
console.log(`Fetched ${docs.length} documents; ${failed.length} source(s) could not be fetched.`);

let answer = { changes: [], notes: "" }, apiError = null;
if (docs.length) {
  try { answer = await askClaude(original, docs); } catch (e) { apiError = e.message; }
} else apiError = "No source could be fetched.";

let data = structuredClone(original);
const accepted = [], dropped = [];
for (const c of answer.changes || []) {
  const label = `${c.section} ${c.action}${c.match ? ` "${c.match}"` : ""}`;
  if (!SECTIONS.includes(c.section)) { dropped.push({ label, why: "section is not allowed" }); continue; }
  const chk = checkChange(c, docs);
  if (chk.why) { dropped.push({ label, why: chk.why }); continue; }
  let step;
  try { step = applyOne(data, c, chk.doc, chk.t); } catch (e) { dropped.push({ label, why: e.message }); continue; }
  const v = validates(step.next);
  if (!v.ok) { dropped.push({ label, why: `would break flood.json: ${v.error || "validator failed"}` }); continue; }
  data = step.next;
  accepted.push({ c, doc: chk.doc, t: chk.t, before: step.before, after: step.after });
}

// Nothing outside the four sections may change (hotlines, assistance, sources, ...).
const untouched = Object.keys({ ...original, ...data }).filter(k => !SECTIONS.includes(k));
const leaked = untouched.filter(k => JSON.stringify(original[k]) !== JSON.stringify(data[k]));
if (leaked.length) { console.error(`Refusing: fields outside the allowed sections changed: ${leaked.join(", ")}`); process.exit(1); }


// ---------- pull-request description ----------

const cell = s => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
const lines = [];
lines.push("> [!WARNING]",
  "> **Draft for human review.** Generated automatically from the news sources below. A person must check every change against its source before merging. **Never merge without reviewing each row.**",
  "");
if (accepted.length) {
  lines.push(`### ${accepted.length} proposed change(s)`, "",
    "| # | Section | Change | Before | After | Source |", "|---|---|---|---|---|---|");
  accepted.forEach((a, i) => lines.push(`| ${i + 1} | ${a.c.section} | ${a.c.action} | ${cell(describe[a.c.section](a.before))} | ${cell(describe[a.c.section](a.after))} | [${cell(a.doc.name)}](${a.doc.url})<br>published ${bkkIso(a.t).replace("T", " ").slice(0, 16)} |`));
  lines.push("", "<details><summary>Supporting quotes (copied word for word from each source)</summary>", "");
  accepted.forEach((a, i) => lines.push(`${i + 1}. “${clip(norm(a.c.quote), 300)}” — ${a.doc.url}${a.c.reason ? `\n   _Why:_ ${norm(a.c.reason)}` : ""}`));
  lines.push("", "</details>", "");
} else {
  lines.push("### No changes proposed", "");
}
if (dropped.length) {
  lines.push(`### ${dropped.length} proposal(s) dropped automatically`, "");
  dropped.forEach(d => lines.push(`- ${d.label}: ${d.why}`));
  lines.push("");
}
if (answer.notes) lines.push("### Model notes", "", norm(answer.notes), "");
if (apiError) lines.push("### Error", "", apiError, "");
lines.push("### Sources", "");
report.forEach(r => lines.push(`- ${r.ok ? "✅" : "⚠️ **could not fetch**"} ${r.name}: ${r.url} (${r.detail})`));
lines.push("", `Model: \`${answer.model || MODEL}\` · run at ${bkkIso(Date.now()).replace("T", " ").slice(0, 16)} Bangkok time`,
  "", "Hotlines and assistance amounts are never changed by this workflow.");
writeFileSync(BODY_FILE, lines.join("\n") + "\n");

if (accepted.length && !DRY) writeFileSync(DATA, rewriteFields(readFileSync(DATA, "utf8"), original, data));
console.log(`${accepted.length} change(s) accepted, ${dropped.length} dropped${apiError ? `; error: ${apiError}` : ""}. Description: ${BODY_FILE}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${accepted.length && !DRY ? "true" : "false"}\ncount=${accepted.length}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
if (apiError && !accepted.length) process.exit(docs.length ? 1 : 0);

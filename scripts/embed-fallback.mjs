#!/usr/bin/env node
// Builds index.html and damage.html from data/flood.json. Runs in the deploy workflow after
// validation; volunteers never need to run it. Usage: node scripts/embed-fallback.mjs
//
// 1. Pre-renders every data section (status, hotlines, shelters, roads, sources) into the
//    <!--render:ID--> ... <!--/render:ID--> markers, in Thai and English, using render.js,
//    so the page shows all phone numbers even with JavaScript disabled.
// 2. Embeds a copy of the data in <script id="fallback-data"> for when the live file can't load.
// 3. Checks that every hotline, shelter and donation-point phone number ended up as a tel: link, and that the
//    road list has exactly as many rows of each type as flood.json has roads. If not, it fails
//    and nothing is deployed.
// 4. damage.html: pre-renders the assistance table and its source line from "assistance".
// 5. Both pages: copies SVG files (icons.svg, img/*.svg) into <!--include:FILE--> markers, so
//    icons and illustrations need no extra download and work offline and without JavaScript.

import { readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { sections, damageSections, telHref } = require("../render.js");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Replace the contents of every <!--include:FILE--> ... <!--/include:FILE--> marker with that
// file from the repo (SVG only).
function includeFiles(html) {
  return html.replace(/(<!--include:([\w./-]+\.svg)-->)[\s\S]*?(<!--\/include:\2-->)/g, (_, open, file, close) => {
    const path = normalize(join(ROOT, file));
    if (!path.startsWith(ROOT)) throw new Error(`include outside the site: ${file}`);
    return open + readFileSync(path, "utf8").trim() + close;
  });
}

// Replace the contents of every <!--render:ID--> ... <!--/render:ID--> marker.
function fill(html, parts, file) {
  for (const [id, content] of Object.entries(parts)) {
    const re = new RegExp(`(<!--render:${id}-->)[\\s\\S]*?(<!--/render:${id}-->)`, "g");
    const found = html.match(re);
    if (!found || found.length !== 1) throw new Error(`${file} needs exactly one <!--render:${id}--> ... <!--/render:${id}--> marker`);
    html = html.replace(re, (_, open, close) => open + content + close);
  }
  return html;
}

export function buildDamagePage(html, data) {
  return includeFiles(fill(html, damageSections(data), "damage.html"));
}

export function buildPage(html, data) {
  html = includeFiles(fill(html, sections(data), "index.html"));

  // Compact, and escape "<" so text like "</script>" inside the data can't end the block early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const fb = /(<script type="application\/json" id="fallback-data">)[\s\S]*?(<\/script>)/;
  if (!fb.test(html)) throw new Error('index.html has no <script type="application/json" id="fallback-data"> block');
  html = html.replace(fb, (_, open, close) => open + json + close);

  const numbers = [
    ...data.hotlines.filter(h => h.number).map(h => h.number),
    ...data.shelters.filter(s => s.tel).map(s => s.tel),
    ...((data.donations && data.donations.points) || []).flatMap(p => p.phones),
  ];
  const missing = numbers.filter(n => !html.includes(`href="${telHref(n)}"`));
  if (missing.length) throw new Error(`Pre-rendered page is missing tel: links for ${missing.join(", ")}`);

  // Roads: count the rows actually written into the HTML (what people see with JavaScript off),
  // per type, and compare with flood.json.
  const roadsHtml = html.match(/<!--render:roads-->([\s\S]*?)<!--\/render:roads-->/)[1];
  const rows = roadsHtml.match(/<li>[\s\S]*?<\/li>/g) || [];
  const count = types => types.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {});
  const shown = count(rows.map(li => (li.match(/class="tag ([\w-]+)"/) || [, "(no type)"])[1]));
  const want = count(data.roads.map(r => r.type));
  const diff = Object.keys({ ...want, ...shown }).filter(t => want[t] !== shown[t]);
  if (rows.length !== data.roads.length || diff.length) {
    throw new Error(`Pre-rendered road list has ${rows.length} rows but flood.json has ${data.roads.length} roads` +
      (diff.length ? ` (${diff.map(t => `${t}: ${shown[t] || 0} shown, ${want[t] || 0} in data`).join("; ")})` : ""));
  }
  return { html, telCount: numbers.length, roadCount: rows.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = ROOT;
  const data = JSON.parse(readFileSync(root + "data/flood.json", "utf8"));
  const { html, telCount, roadCount } = buildPage(readFileSync(root + "index.html", "utf8"), data);
  writeFileSync(root + "index.html", html);
  console.log(`Built index.html: all sections pre-rendered, ${telCount} tel: links present, ${roadCount}/${data.roads.length} roads rendered, fallback data embedded`);
  writeFileSync(root + "damage.html", buildDamagePage(readFileSync(root + "damage.html", "utf8"), data));
  console.log(`Built damage.html: ${data.assistance.items.length} assistance rows pre-rendered`);
}

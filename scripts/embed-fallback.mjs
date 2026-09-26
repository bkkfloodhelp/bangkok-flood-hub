#!/usr/bin/env node
// Builds index.html from data/flood.json. Runs in the deploy workflow after validation;
// volunteers never need to run it. Usage: node scripts/embed-fallback.mjs
//
// 1. Pre-renders every data section (status, hotlines, shelters, roads, sources) into the
//    <!--render:ID--> ... <!--/render:ID--> markers, in Thai and English, using render.js,
//    so the page shows all phone numbers even with JavaScript disabled.
// 2. Embeds a copy of the data in <script id="fallback-data"> for when the live file can't load.
// 3. Checks that every hotline and shelter phone number ended up as a tel: link, and fails
//    (blocking the deploy) if one is missing.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { sections, telHref } = require("../render.js");

export function buildPage(html, data) {
  const parts = sections(data);
  for (const [id, content] of Object.entries(parts)) {
    const re = new RegExp(`(<!--render:${id}-->)[\\s\\S]*?(<!--/render:${id}-->)`, "g");
    const found = html.match(re);
    if (!found || found.length !== 1) throw new Error(`index.html needs exactly one <!--render:${id}--> ... <!--/render:${id}--> marker`);
    html = html.replace(re, (_, open, close) => open + content + close);
  }

  // Compact, and escape "<" so text like "</script>" inside the data can't end the block early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const fb = /(<script type="application\/json" id="fallback-data">)[\s\S]*?(<\/script>)/;
  if (!fb.test(html)) throw new Error('index.html has no <script type="application/json" id="fallback-data"> block');
  html = html.replace(fb, (_, open, close) => open + json + close);

  const numbers = [
    ...data.hotlines.filter(h => h.number).map(h => h.number),
    ...data.shelters.filter(s => s.tel).map(s => s.tel),
  ];
  const missing = numbers.filter(n => !html.includes(`href="${telHref(n)}"`));
  if (missing.length) throw new Error(`Pre-rendered page is missing tel: links for ${missing.join(", ")}`);
  return { html, telCount: numbers.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const data = JSON.parse(readFileSync(root + "data/flood.json", "utf8"));
  const { html, telCount } = buildPage(readFileSync(root + "index.html", "utf8"), data);
  writeFileSync(root + "index.html", html);
  console.log(`Built index.html: all sections pre-rendered, ${telCount} tel: links present, fallback data embedded`);
}

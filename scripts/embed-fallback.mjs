#!/usr/bin/env node
// Copies data/flood.json into index.html's <script id="fallback-data"> block, so the page
// still has data if the live file fails to load. Runs in the deploy workflow after validation;
// volunteers never need to run it. Usage: node scripts/embed-fallback.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const htmlPath = root + "index.html";
const data = JSON.parse(readFileSync(root + "data/flood.json", "utf8"));

// Compact, and escape "<" so text like "</script>" inside the data can't end the block early.
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const html = readFileSync(htmlPath, "utf8");
const re = /(<script type="application\/json" id="fallback-data">)[\s\S]*?(<\/script>)/;
if (!re.test(html)) {
  console.error('index.html has no <script type="application/json" id="fallback-data"> block.');
  process.exit(1);
}
writeFileSync(htmlPath, html.replace(re, (_, open, close) => open + json + close));
console.log(`Embedded fallback data (${json.length} bytes) into index.html`);

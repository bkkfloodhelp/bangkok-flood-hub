#!/usr/bin/env node
// One-off check for the road-name migration (names now hold the full text, e.g. "ถ.สุขุมวิท",
// instead of the page adding "ถ." and " Rd"). Renders the page's data sections with the OLD
// render.js + flood.json from git and with the current files, and requires identical output.
//
//   node scripts/check-road-migration.mjs [git-revision]   (default: 6c012d4, the last commit before the change)
//
// Only meaningful for the roads that existed before the change; safe to delete once reviewed.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REV = process.argv[2] || "6c012d4";
const require = createRequire(import.meta.url);
const git = path => execFileSync("git", ["show", `${REV}:${path}`], { cwd: ROOT, encoding: "utf8" });

const tmp = mkdtempSync(join(tmpdir(), "roads-"));
writeFileSync(join(tmp, "render.js"), git("render.js"));
const oldRender = require(join(tmp, "render.js"));
const newRender = require(join(ROOT, "render.js"));
const oldData = JSON.parse(git("data/flood.json"));
const newData = JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
rmSync(tmp, { recursive: true, force: true });

// Compare only the roads that existed before, in the same order, with the same other fields.
const oldRoads = oldData.roads;
const newRoads = newData.roads.slice(0, oldRoads.length);
const before = oldRender.sections({ ...oldData, roads: oldRoads });
const after = newRender.sections({ ...oldData, roads: newRoads });
const text = html => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

let failures = 0;
for (const id of Object.keys(before)) {
  const same = before[id] === after[id];
  if (!same) failures++;
  console.log(`${same ? "✓" : "✗"} section "${id}" ${same ? "identical" : "DIFFERS"}`);
  if (!same) console.log(`    before: ${text(before[id]).slice(0, 200)}\n    after:  ${text(after[id]).slice(0, 200)}`);
}

// Show the displayed road names side by side for a human to eyeball.
console.log(`\n${oldRoads.length} roads as displayed (before → after):`);
const shown = (html, lang) => [...html.matchAll(new RegExp(`<span class="rn"><span data-th[^>]*>([^<]*)</span><span data-en[^>]*>([^<]*)</span>`, "g"))]
  .map(m => (lang === "th" ? m[1] : m[2]));
const bTh = shown(before.roads, "th"), aTh = shown(after.roads, "th"), bEn = shown(before.roads, "en"), aEn = shown(after.roads, "en");
bTh.forEach((_, i) => {
  const ok = bTh[i] === aTh[i] && bEn[i] === aEn[i];
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${bTh[i]} / ${bEn[i]}${ok ? "" : `  →  ${aTh[i]} / ${aEn[i]}`}`);
});
if (bTh.length !== oldRoads.length) { failures++; console.log(`✗ expected ${oldRoads.length} road names, found ${bTh.length}`); }

console.log(failures ? `\n✗ ${failures} difference(s)` : `\n✓ All ${oldRoads.length} roads render exactly as before (HTML identical in every section)`);
process.exit(failures ? 1 : 0);

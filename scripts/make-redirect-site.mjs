#!/usr/bin/env node
// Builds the tiny "this site has moved" site for the OLD address (phantawat.github.io/bangkok-flood-hub/),
// published from the Phantawat/bangkok-flood-hub repo after the project moved to bkkfloodhelp.
//
//   node scripts/make-redirect-site.mjs <outDir> [newBase] [oldPath]
//     newBase  default https://bkkfloodhelp.github.io/bangkok-flood-hub/
//     oldPath  path the old site is served under, default /bangkok-flood-hub/
//
// Output: index.html, damage.html and 404.html that send visitors to the matching page on the
// new address (JavaScript: immediately, keeping ?query and #hash; without JavaScript: a 1-second
// meta refresh; always: a visible link), sw.js = the service worker off-switch so phones that
// cached the old site are released, plus README.md and .nojekyll. Nothing else.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [out, newBase = "https://bkkfloodhelp.github.io/bangkok-flood-hub/", oldPath = "/bangkok-flood-hub/"] = process.argv.slice(2);
if (!out) { console.error("Usage: node scripts/make-redirect-site.mjs <outDir> [newBase] [oldPath]"); process.exit(1); }
const esc = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function page(target) {
  const T = esc(target);
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ย้ายแล้ว · Moved · Bangkok Flood Help</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${T}">
<!-- Without JavaScript: go to the new address after 1 second. -->
<meta http-equiv="refresh" content="1; url=${T}">
<script>
// With JavaScript: release this old site's offline copy (service worker + its caches) on this
// phone, then go straight to the same page on the new address, keeping ?query and #hash.
(function () {
  var oldPath = ${JSON.stringify(oldPath)}, newBase = ${JSON.stringify(newBase)};
  var rest = location.pathname.indexOf(oldPath) === 0 ? location.pathname.slice(oldPath.length) : "";
  if (/(^|\\/)(index|404)\\.html$/.test(rest)) rest = rest.replace(/(index|404)\\.html$/, "");
  var go = function () { location.replace(newBase + rest + location.search + location.hash); };
  var jobs = [];
  try {
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.unregister(); }));
    }));
    if (window.caches) jobs.push(caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf("flood-hub-") === 0; }).map(function (k) { return caches.delete(k); }));
    }));
  } catch (e) {}
  Promise.all(jobs).then(go, go);
  setTimeout(go, 800); // never wait long for the clean-up
})();
</script>
<style>
body{margin:0;padding:24px 16px;font-family:"IBM Plex Sans Thai",system-ui,sans-serif;font-size:17px;line-height:1.6;background:#f3f6f8;color:#0f2233}
a{color:#1d5c8a;font-weight:700;word-break:break-all}
@media (prefers-color-scheme:dark){body{background:#0c1822;color:#e6eef4}a{color:#6fb1e0}}
</style>
</head>
<body>
<p>เว็บไซต์ข้อมูลช่วยเหลือน้ำท่วม กรุงเทพฯ ย้ายไปที่อยู่ใหม่แล้ว<br><a href="${T}">${T}</a></p>
<p lang="en">Bangkok flood help has moved to<br><a href="${T}">${T}</a></p>
<p>เหตุฉุกเฉินโทร <a href="tel:1669">1669</a> หรือ <a href="tel:1555">1555</a><br><span lang="en">In an emergency call <a href="tel:1669">1669</a> or <a href="tel:1555">1555</a></span></p>
</body>
</html>
`;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), page(newBase));
writeFileSync(join(out, "damage.html"), page(newBase + "damage.html"));
writeFileSync(join(out, "404.html"), page(newBase)); // any other old path; the script keeps the path
writeFileSync(join(out, "sw.js"), readFileSync(join(ROOT, "scripts/sw-disable.js"), "utf8"));
writeFileSync(join(out, ".nojekyll"), "");
writeFileSync(join(out, "README.md"), `# This site has moved · เว็บไซต์ย้ายแล้ว

**Bangkok flood help / ข้อมูลช่วยเหลือน้ำท่วม กรุงเทพฯ** is now at
**${newBase}**

The project (code, data and how to update it) is now at
**https://github.com/bkkfloodhelp/bangkok-flood-hub**

This repository only keeps the old address working: its pages send visitors to the new site,
and \`sw.js\` removes the old site's offline copy from phones that had it saved. Please make
changes in the new repository, not here.

In an emergency call **1669** (medical) or **1555** (BMA).
`);
console.log(`Redirect site written to ${out} → ${newBase} (old path ${oldPath})`);

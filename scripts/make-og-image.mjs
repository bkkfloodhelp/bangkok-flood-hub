#!/usr/bin/env node
// Builds og-image.png (1200×630), the picture shown when the link is shared on LINE / Facebook.
// Uses the site's own fonts and colours, and takes the urgent hotlines from data/flood.json.
// No date on purpose: LINE and Facebook cache preview images for a long time.
//
//   node scripts/make-og-image.mjs        (needs Node 22+ and Chrome)
//
// After changing the image, ask Facebook to refresh it: https://developers.facebook.com/tools/debug/

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "og-image.png");
const data = JSON.parse(readFileSync(join(ROOT, "data/flood.json"), "utf8"));
const urgent = data.hotlines.filter(h => h.urgent && h.number);

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fonts are embedded as data: URLs so the page renders from a local file without a server.
const faces = ["400", "600", "700"].flatMap(w => ["thai", "latin"].map(sub => {
  const b64 = readFileSync(join(ROOT, `fonts/ibm-plex-sans-thai-${sub}-${w}.woff2`)).toString("base64");
  const range = sub === "thai" ? "U+0E01-0E5B, U+200C-200D, U+25CC" : "U+0000-00FF, U+2000-206F";
  return `@font-face{font-family:"IBM Plex Sans Thai";font-weight:${w};src:url(data:font/woff2;base64,${b64}) format("woff2");unicode-range:${range}}`;
})).join("\n");

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
${faces}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#f3f6f8;color:#0f2233;
  font-family:"IBM Plex Sans Thai",sans-serif;display:flex;flex-direction:column;align-items:center;
  justify-content:center;text-align:center;border-top:18px solid #1d5c8a;padding:0 60px}
h1{font-size:74px;font-weight:700;line-height:1.25}
.sub{font-size:36px;font-weight:600;color:#1d5c8a;margin-top:10px;line-height:1.35}
.calls{display:flex;gap:28px;margin-top:40px}
.call{background:#fff;border:4px solid #b3261e;border-radius:18px;padding:14px 32px 16px;min-width:380px;max-width:470px}
.call b{display:block;font-size:72px;line-height:1.1;color:#b3261e}
.call span{display:block;font-size:26px;line-height:1.35}
.foot{margin-top:36px;font-size:25px;color:#51667a;line-height:1.4}
</style></head><body>
<h1>ข้อมูลช่วยเหลือน้ำท่วม กรุงเทพฯ</h1>
<p class="sub">เบอร์ฉุกเฉิน · ศูนย์พักพิงชั่วคราว · ถนนที่ควรหลีกเลี่ยง</p>
<div class="calls">${urgent.map(h => `<div class="call"><b>${esc(h.number)}</b><span>${esc(h.label.th)}</span></div>`).join("")}</div>
<p class="foot">รวบรวมโดยอาสาสมัคร · ไม่ใช่เว็บไซต์ทางการ · Volunteer-run, unofficial</p>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "og-"));
const page = join(tmp, "og.html");
writeFileSync(page, html);
const chrome = await launchChrome(join(tmp, "profile"));
try {
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await chrome.send("Page.navigate", { url: "file://" + page });
  await sleep(500);
  const r = await chrome.send("Runtime.evaluate", {
    expression: `document.fonts.ready.then(() => JSON.stringify({
      fonts: [...document.fonts].filter(f => f.status === "loaded").length,
      overflow: document.body.scrollHeight > 630 || document.body.scrollWidth > 1200 }))`,
    awaitPromise: true, returnByValue: true });
  const check = JSON.parse(r.result.result.value);
  if (check.fonts < 2) throw new Error("Fonts did not load");
  if (check.overflow) throw new Error("Content does not fit in 1200×630; shorten the text");
  const shot = await chrome.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
  console.log(`Wrote og-image.png (${Math.round(readFileSync(OUT).length / 1024)} KB, hotlines: ${urgent.map(h => h.number).join(", ")})`);
} finally {
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

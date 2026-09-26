#!/usr/bin/env node
// Builds the PNG icons from the same water-drop shape as icon.svg:
//   favicon-32.png        32×32, transparent, for browsers without SVG favicon support
//   apple-touch-icon.png  180×180, white drop on the site's water blue, for iPhone home screens
//                         (must be opaque: iOS fills transparent areas with black)
//
//   node scripts/make-icons.mjs        (needs Node 22+ and Chrome)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sleep } from "./lib/chrome.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DROP = readFileSync(join(ROOT, "icon.svg"), "utf8").match(/<path d="([^"]+)"/)[1];
const WATER = "#1d5c8a";

const ICONS = [
  { file: "favicon-32.png", size: 32, bg: null, fill: WATER, pad: 0 },
  { file: "apple-touch-icon.png", size: 180, bg: WATER, fill: "#ffffff", pad: 0.2 },
];

const tmp = mkdtempSync(join(tmpdir(), "icons-"));
const chrome = await launchChrome(join(tmp, "profile"));
try {
  // Transparent page background, so the favicon keeps see-through corners.
  await chrome.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const icon of ICONS) {
    const inner = 64 * (1 - 2 * icon.pad), off = 64 * icon.pad;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}" viewBox="0 0 64 64">` +
      (icon.bg ? `<rect width="64" height="64" fill="${icon.bg}"/>` : "") +
      `<g transform="translate(${off} ${off}) scale(${inner / 64})"><path d="${DROP}" fill="${icon.fill}"/></g></svg>`;
    const page = join(tmp, icon.file + ".html");
    writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await chrome.send("Emulation.setDeviceMetricsOverride", { width: icon.size, height: icon.size, deviceScaleFactor: 1, mobile: false });
    await chrome.send("Page.navigate", { url: "file://" + page });
    await sleep(400);
    const shot = await chrome.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: icon.size, height: icon.size, scale: 1 } });
    writeFileSync(join(ROOT, icon.file), Buffer.from(shot.result.data, "base64"));
    console.log(`Wrote ${icon.file} (${icon.size}×${icon.size}, ${readFileSync(join(ROOT, icon.file)).length} bytes)`);
  }
} finally {
  chrome.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

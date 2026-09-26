// Sample tools, live-roads links and roads, used by the tests only while flood.json has none
// yet, so these sections are always checked. example.org is a reserved test domain.
export const SAMPLE_TOOLS = [
  { name: { th: "ตัวอย่างเครื่องมือทางการ", en: "Sample official tool" }, description: { th: "ใช้ทดสอบเท่านั้น", en: "For tests only" },
    url: "https://example.org/official", official: true, note: { th: "ล่มบ่อย กดรีเฟรช", en: "Often down, try refreshing" },
    updated: "2026-09-26T13:00:00+07:00", source: "Test data" },
  { name: { th: "ตัวอย่างเครื่องมือไม่เป็นทางการ", en: "Sample unofficial tool" }, description: { th: "ใช้ทดสอบเท่านั้น", en: "For tests only" },
    url: "http://example.org/unofficial", official: false, updated: "2026-09-26T13:00:00+07:00", source: "ข้อมูลทดสอบ" },
];
export const SAMPLE_LIVE = { roadsLiveUrl: "https://example.org/live", roadsLiveUrlAlt: "http://example.org/live-backup" };

// One sample road for each road type that flood.json doesn't use yet, so every type's rendering
// is checked (with and without JavaScript) before real entries of that type exist.
import { createRequire } from "node:module";
const { ROAD_TAGS } = createRequire(import.meta.url)("../../render.js");
export function sampleRoads(roads) {
  return Object.keys(ROAD_TAGS).filter(type => !roads.some(r => r.type === type)).map(type => ({
    name: { th: `ถนนตัวอย่าง (${ROAD_TAGS[type].th})`, en: `Sample road (${ROAD_TAGS[type].en})` },
    type, updated: "2026-09-26T13:00:00+07:00", source: "Test data",
  }));
}

// Fill in the sample sections where the real data doesn't have them yet.
export function withSamples(data) {
  const d = structuredClone(data);
  d.roads = [...d.roads, ...sampleRoads(d.roads)];
  if (!d.tools || !d.tools.length) d.tools = SAMPLE_TOOLS;
  if (!d.roadsLiveUrl) Object.assign(d, SAMPLE_LIVE);
  return d;
}

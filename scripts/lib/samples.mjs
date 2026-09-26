// Sample "tools" and live-roads links, used by the tests only while flood.json has none yet,
// so these sections are always checked. example.org is a reserved test domain.
export const SAMPLE_TOOLS = [
  { name: { th: "ตัวอย่างเครื่องมือทางการ", en: "Sample official tool" }, description: { th: "ใช้ทดสอบเท่านั้น", en: "For tests only" },
    url: "https://example.org/official", official: true, note: { th: "ล่มบ่อย กดรีเฟรช", en: "Often down, try refreshing" },
    updated: "2026-09-26T13:00:00+07:00", source: "Test data" },
  { name: { th: "ตัวอย่างเครื่องมือไม่เป็นทางการ", en: "Sample unofficial tool" }, description: { th: "ใช้ทดสอบเท่านั้น", en: "For tests only" },
    url: "http://example.org/unofficial", official: false, updated: "2026-09-26T13:00:00+07:00", source: "ข้อมูลทดสอบ" },
];
export const SAMPLE_LIVE = { roadsLiveUrl: "https://example.org/live", roadsLiveUrlAlt: "http://example.org/live-backup" };

// Fill in the sample sections where the real data doesn't have them yet.
export function withSamples(data) {
  const d = structuredClone(data);
  if (!d.tools || !d.tools.length) d.tools = SAMPLE_TOOLS;
  if (!d.roadsLiveUrl) Object.assign(d, SAMPLE_LIVE);
  return d;
}

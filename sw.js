// Service worker: keeps the page usable offline after the first visit.
// Strategy: network first (always try for fresh data), fall back to the cached copy if the
// network fails or takes longer than NETWORK_TIMEOUT_MS. Cached responses are marked with an
// X-Served-From header so the page can show its "may be out of date" notice.
// Exception: font files are served cache first, because they never change. If a font file is
// ever replaced, give it a new file name (or bump CACHE) so visitors get the new one.
//
// EMERGENCY OFF-SWITCH: replace this whole file with scripts/sw-disable.js (see README).

// Only caches starting with this prefix belong to this site. phantawat.github.io is shared
// with other project sites, so never touch other caches.
const PREFIX = "flood-hub-";
const CACHE = PREFIX + "v5";
const NETWORK_TIMEOUT_MS = 4000;
const FONTS = ["400", "600", "700"].flatMap(w => ["thai", "latin"].map(sub => `fonts/ibm-plex-sans-thai-${sub}-${w}.woff2`));
const ICONS = ["icon.svg", "favicon-32.png", "apple-touch-icon.png"];
const SHELL = ["./", "index.html", "damage.html", "style.css", "render.js", "lang.js", "app.js", "damage.js", "data/flood.json", ...FONTS, ...ICONS];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  // Same-origin GETs only; requests to other sites go straight to the network.
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes("/fonts/") ? cacheFirst(event) : networkFirst(event));
});

async function fromCache(req) {
  const cache = await caches.open(CACHE);
  let hit = await cache.match(req, { ignoreSearch: true });
  if (!hit && req.mode === "navigate") hit = (await cache.match("./")) || (await cache.match("index.html"));
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set("X-Served-From", "sw-cache");
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

async function cacheFirst(event) {
  const hit = await (await caches.open(CACHE)).match(event.request, { ignoreSearch: true });
  return hit || networkFirst(event);
}

function networkFirst(event) {
  const req = event.request;
  let saved = Promise.resolve();
  const network = fetch(req).then(res => {
    // Clone synchronously, before the page starts reading the body.
    if (res.ok) {
      const copy = res.clone();
      saved = caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  });
  // Keep the worker alive until a slow response has been stored, even after a timeout.
  event.waitUntil(network.then(() => saved, () => {}));

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS));

  return Promise.race([network, timeout]).then(
    async res => (res.ok ? res : (await fromCache(req)) || res),
    // Offline or slow: use the cache. With nothing cached, keep waiting for the network.
    async () => (await fromCache(req)) || network
  );
}

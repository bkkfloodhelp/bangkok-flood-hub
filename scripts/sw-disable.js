// EMERGENCY SERVICE WORKER OFF-SWITCH
// To use: copy this whole file over sw.js (in the repository root) and commit.
// Each visitor's browser picks it up on their next visit: it deletes this site's caches,
// unregisters the service worker and reloads the page straight from the network.
// To turn the service worker back on later, restore the previous sw.js from History.

const PREFIX = "flood-hub-"; // only this site's caches; the github.io address is shared with other sites

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX)).map(k => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    windows.forEach(w => w.navigate(w.url));
  })());
});
// No fetch handler: every request goes straight to the network.

// Squad's service worker: it only exists so browsers offer "Install Squad". It caches nothing — every request goes
// to the network, so a new version or a sign-out always takes effect.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => event.respondWith(fetch(event.request)));

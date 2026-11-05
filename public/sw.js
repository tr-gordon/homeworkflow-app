/* HomeworkFlow service worker: makes the static app open offline.
 *
 * All homework data lives in the browser's localStorage, not in any cache, so
 * caching the app's own files is safe and is what lets it work with no signal.
 *  - Only same-origin GET requests are handled; nothing else is ever fetched.
 *  - Page navigations: network first (so updates arrive), cache as the fallback.
 *  - Hashed build assets (/_next/static/): cache first, they never change.
 * Pages you have opened once keep working offline. Paths are derived from the
 * worker's scope so it works under a sub-path such as /Homeworkflow/.
 */
const CACHE = "homeworkflow-v2";
const SCOPE = new URL(self.registration.scope);
const ROUTES = ["", "student/", "parent/", "new/", "assignment/", "share/", "settings/", "setup/", "offline/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(ROUTES.map((r) => cache.add(new URL(r, SCOPE)).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  const put = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  };

  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(put)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(put)
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match(new URL("offline/", SCOPE)))),
    );
  }
});

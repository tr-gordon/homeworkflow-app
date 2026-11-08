/* HomeworkFlow service worker: makes the static app open instantly and work offline.
 *
 * All homework data lives in the browser's localStorage, not in any cache, so caching the
 * app's own files is safe, and nothing about the app ever needs the network to be fast.
 *
 *  - Only same-origin requests inside this worker's scope are handled; nothing else is fetched.
 *  - Page loads: answered from the cache AT ONCE, then refreshed in the background (so a new
 *    version arrives on the next open). A stalled or slow connection (common on phones) must never
 *    leave a blank screen. Only the very first visit has to wait for the network.
 *  - Hashed build files (/_next/static/): cache first; they never change. At install every page and
 *    its scripts are cached, so a page that was never opened still opens on a bad connection.
 *  - Next.js link prefetch/navigation requests (and HEAD checks): network with a short time limit,
 *    then fail fast. Next then does a normal page load, which the cache answers instantly.
 * Paths come from the worker's scope, so it works under a sub-path such as /homeworkflow-app/.
 */
const CACHE = "homeworkflow-v4";
const SCOPE = new URL(self.registration.scope);
const ROUTES = ["", "student/", "parent/", "new/", "assignment/", "share/", "settings/", "setup/", "offline/"];
const LINK_TIMEOUT_MS = 2000; // prefetch / client navigation requests
const FIRST_VISIT_TIMEOUT_MS = 8000; // a page that is not cached yet

/** fetch() that gives up (rejects) after `ms`. */
function fetchWithTimeout(input, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(input, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Cache key for a page: its URL without query or hash (the app reads ?id= in the browser). */
function pageKey(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.href;
}

/** URLs of the scripts and styles a page's HTML asks for. */
function assetsIn(html) {
  const found = new Set();
  const text = html.replace(/\\\//g, "/");
  for (const m of text.matchAll(/_next\/static\/[A-Za-z0-9_\-./%~]+?\.(?:js|css)/g)) found.add(new URL(m[0], SCOPE).href);
  return found;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set();
      await Promise.allSettled(
        ROUTES.map(async (route) => {
          const url = new URL(route, SCOPE).href;
          const res = await fetch(url, { cache: "reload" });
          if (!res.ok) return;
          assetsIn(await res.clone().text()).forEach((a) => assets.add(a));
          await cache.put(url, res);
        }),
      );
      // Individual failures are fine: anything missing is fetched on demand.
      await Promise.allSettled([...assets].map((a) => cache.add(a)));
      await self.skipWaiting();
    })(),
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

async function handleNavigation(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const key = pageKey(request.url);
  const cached = await cache.match(key);

  if (cached) {
    // Instant from the cache; update it quietly for next time.
    event.waitUntil(
      fetchWithTimeout(key, 15000)
        .then((res) => (res.ok && !res.redirected ? cache.put(key, res) : undefined))
        .catch(() => undefined),
    );
    return cached;
  }
  try {
    const res = await fetchWithTimeout(request, FIRST_VISIT_TIMEOUT_MS);
    if (res.ok && !res.redirected) event.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch {
    return (await cache.match(new URL("offline/", SCOPE).href)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (Next.js prefetch and navigation payloads, HEAD checks): short limit, then fail fast.
  event.respondWith(fetchWithTimeout(request, LINK_TIMEOUT_MS).catch(() => Response.error()));
});

// Tapping a notification brings the app forward (or opens it).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(SCOPE.href));
      return open ? open.focus() : self.clients.openWindow(SCOPE.href);
    }),
  );
});

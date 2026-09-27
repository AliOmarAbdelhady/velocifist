// VELOCIFIST service worker (M10): offline-after-first-visit.
// Vite hashes every asset name, so a precache manifest would go stale the
// moment a new build ships — instead everything same-origin is runtime-cached
// on first fetch (cache-first for assets, network-first for navigations).
// The 20 MB wasm+model land in the same cache: once you have played with the
// camera once, the whole game — tracking included — works offline.
const CACHE = 'roben-v5'; // ADR-020: AR engine precached on first visit + visible camera loading state // zero-assist directness (ADR-019) // phone-remote auto-reconnect + versus restart fixes

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (const key of keys) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// First-visit priming: assets load BEFORE the SW activates, so the page hands
// us its resource list once we take control — otherwise offline only works
// from the second visit onward.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'prime') return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of event.data.urls) {
        try {
          const res = await fetch(url);
          if (res && res.status === 200) await cache.put(url, res);
        } catch {
          // best effort — a failed asset stays uncached
        }
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    req.mode === 'navigate' ? networkFirst(req) : cacheFirst(req),
  );
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // stale-while-revalidate (unhashed files: manifest, icons, sw) — never
    // blocks the response; hashed assets are immutable so this is a no-op.
    void fetch(req)
      .then((res) =>
        res && res.status === 200
          ? caches.open(CACHE).then((c) => c.put(req, res))
          : undefined,
      )
      .catch(() => undefined);
    return cached;
  }
  const res = await fetch(req).catch(() => null);
  // AWAIT the put: the fetch() promise must not resolve to the page before
  // the body is durably in the cache (a detached put races 20 MB artifacts).
  if (res && res.status === 200) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res ?? new Response('offline', { status: 503 });
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('offline', { status: 503 });
  }
}

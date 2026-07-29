const CACHE = 'fmf-pod-v1';
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CDN_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Cache-first for CDN assets and fonts
  const isCDN = url.includes('cdnjs.cloudflare.com') || url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com');
  // Network-first (with a short-timeout cache fallback) for the app itself
  const isAppShell = url.includes('jack-thompson-ln.github.io') || url.includes('proof-of-delivery') || url.includes('localhost');

  if (isCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        // clone() must happen here, synchronously, before res is returned and
        // its body starts being consumed by the page — caches.open() is async,
        // so calling clone() inside its .then() below (the original pattern)
        // fails with "Response body is already used" once anything actually
        // reads res in the meantime.
        const resClone = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      }).catch(() => cached))
    );
    return;
  }

  if (isAppShell) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        // Kick off the network request regardless — this is what keeps the
        // cached shell fresh. Runs independently of the race below and is
        // kept alive via waitUntil even after we've already responded from cache.
        const networkFetch = fetch(e.request).then(res => {
          // clone() must happen here, synchronously, on receipt of res —
          // caches.open() is async, so cloning inside its .then() (the
          // original pattern) fails with "Response body is already used"
          // once res has actually been handed to the page in the meantime.
          const resClone = res.clone();
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, resClone));
          return res;
        }).catch(() => cached);
        e.waitUntil(networkFetch.catch(() => {}));

        // First-ever load: nothing cached to fall back to, must wait on network.
        if (!cached) return networkFetch;

        // On poor signal a fetch typically doesn't reject, it just hangs
        // (still retrying at the TCP level). Race the network against a
        // short timer and serve the cached shell the instant the timer
        // wins, rather than leaving the driver staring at a blank tab
        // waiting for a connection that may not resolve either way for
        // a long time.
        return Promise.race([
          networkFetch,
          new Promise(resolve => setTimeout(() => resolve(cached), 4000))
        ]);
      })
    );
    return;
  }
  // Everything else (Supabase API, Nominatim) — network only, never cache
});

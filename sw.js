'use strict';

// Change this version whenever any runtime file changes before deployment.
// The old root worker deletes x-patrol-*; this separate prefix survives it.
const CACHE_PREFIX = 'xp054-watch-shell-';
const CACHE_NAME = `${CACHE_PREFIX}20261024-iris-watch-org-v2`;
const APP_ROOT = new URL(self.registration.scope);
const INDEX_URL = new URL('index.html', APP_ROOT).href;
const REQUIRED_FILES = Object.freeze([
 'index.html','style.css','app.mjs','core.mjs','storage.mjs','migration.mjs',
 'candidate-ui.mjs','reorder-ui.mjs','rss.mjs','analytics.mjs',
 'manifest.webmanifest','sw.js','icon.svg','combined-backup.mjs'
]);
const ASSET_URLS = REQUIRED_FILES.map(file => new URL(file, APP_ROOT).href);
const ASSET_SET = new Set(ASSET_URLS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch the complete release before making it available offline. A missing
    // core.mjs or any other required dependency fails installation visibly.
    const responses = await Promise.all(ASSET_URLS.map(async url => {
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok || response.type === 'opaque' || response.redirected) {
        throw new Error(`WATCH BOX precache failed: ${new URL(url).pathname} (${response.status})`);
      }
      // Consume each body before waiting for every response: Chrome limits
      // concurrent install fetches. Holding their unread bodies can stall the
      // remaining shell requests, even though the first headers have arrived.
      const body = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSET_URLS.map((url, index) => cache.put(url, responses[index])));
    // No skipWaiting here: an open older release keeps its complete shell.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;
  const isEntry = url.pathname === APP_ROOT.pathname || url.pathname === new URL(INDEX_URL).pathname;
  if (request.mode === 'navigate' && isEntry) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Preserve the query for the foreground page to consume, but never use
      // shared title/text/url as a cache key or a network request in this worker.
      const cached = await cache.match(INDEX_URL);
      if (cached) return cached;
      return fetch(new Request(INDEX_URL, { cache: 'no-store', credentials: 'same-origin' }));
    })());
    return;
  }
  // Cache only exact release assets. No X requests, unknown routes, shared
  // queries, user backup files, or runtime data enter the shell cache.
  if (!ASSET_SET.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    return cached || fetch(request);
  })());
});

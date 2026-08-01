// Service Worker — Institutional Trading Terminal (XAUUSD)
// Hanya meng-cache "app shell" (file statis) agar app bisa dibuka offline / install sebagai PWA.
// TIDAK menyentuh request live (harga, Telegram, Sheets, calendar, WebSocket) — itu semua harus selalu network-fresh.

const CACHE_VERSION = 'trading-terminal-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './tailwind.css',
  './app.js',
  './manifest.webmanifest',
  './favicon-64.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani GET, dan hanya file same-origin (app shell).
  // Semua request lain (API pihak ketiga, WS, POST, dll) dilewatkan langsung ke network tanpa campur tangan SW.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // offline → fallback ke cache kalau ada
      // Cache-first untuk shell: kalau ada di cache, tampilkan cepat, tapi tetap update cache di background.
      return cached || network;
    })
  );
});

// Service Worker — Institutional Trading Terminal (XAUUSD)
// Hanya meng-cache "app shell" (file statis) agar app bisa dibuka offline / install sebagai PWA.
// TIDAK menyentuh request live (harga, Telegram, Sheets, calendar, WebSocket) — itu semua harus selalu network-fresh.
//
// STRATEGI: network-first (bukan cache-first). App ini sering di-update, jadi versi terbaru harus
// langsung kepakai begitu online — cache cuma jadi fallback kalau offline, bukan sumber utama.
// Naikkan CACHE_VERSION setiap kali app.js/index.html/style.css diubah, supaya cache lama otomatis dibuang.

const CACHE_VERSION = 'trading-terminal-shell-v14';
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
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req)) // offline → fallback ke cache terakhir yang berhasil disimpan
  );
});

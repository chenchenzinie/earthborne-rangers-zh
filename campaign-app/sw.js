/* Service Worker：离线缓存全部应用外壳 */
const CACHE = 'ebr-campaign-v20261008j';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=20261008j',
  './data.js?v=20261008j',
  './app.js?v=20261008j',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './maps/valley-map.jpg',
  './maps/valley-map-p.jpg',
  './maps/ancestral-map.jpg',
  './maps/arcology-map.jpg',
  './maps/underground-map.jpg',
  // 奖励牌（引入山谷 31 张 / 先祖遗产 29 张）
  ...Array.from({ length: 31 }, (_, i) => `./rewards-valley/奖励-${i + 1}-31.jpg`),
  ...Array.from({ length: 29 }, (_, i) => `./rewards-ancestral/奖励XZ-${i + 1}-29.jpg`),
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 同源资源：网络优先（拿到新版），失败回退缓存；非同源直接放行
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

/*
 * 오프라인 실행용 서비스 워커.
 * 네트워크 우선 → 실패하면 캐시. (업데이트가 바로 반영되고, 인터넷이 없어도 마지막 버전으로 실행)
 */
var CACHE = 'summerolympic-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});

/* DOPA-radio service worker
 * - 更新は常に即時反映（skipWaiting + clients.claim）
 * - 画面遷移（HTML）はネットワーク優先・HTTPキャッシュ無視
 * - それ以外はブラウザ標準に任せる（ハッシュ付き静的アセットは不変）
 */

const CACHE_NAME = "dopa-radio-shell-v4";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // 画面遷移は常に最新のHTMLを取りに行く（PWAの古い画面が残るのを防ぐ）
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => fetch(request).catch(() => Response.error())),
    );
    return;
  }
  // それ以外はブラウザ標準のキャッシュ戦略に任せる
});

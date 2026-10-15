/* DOPA-radio service worker (Phase 0: installability only) */
/* Phase 3 でオフラインキャッシュ（アプリシェル・自分のプレイリスト）を追加する */

const CACHE_NAME = "dopa-radio-shell-v2";

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

self.addEventListener("fetch", () => {
  /* no-op: ネットワークのみ。Phase 3 でキャッシュ戦略を実装 */
});

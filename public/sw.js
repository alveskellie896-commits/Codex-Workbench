const CACHE_NAME = "codex-workbench-chat-polish-2026-05-05";
const STATIC_ASSETS = ["/manifest.webmanifest", "/pwa-icon.svg"];
const CACHE_PREFIX = "codex-workbench-";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .catch(() => undefined)
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_OLD_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname === "/ws") return;

  const isHtml = request.mode === "navigate" || url.pathname === "/" || url.pathname === "/pair";
  if (isHtml) {
    event.respondWith(
      fetch(new Request(request, { cache: "reload" })).catch(
        () =>
          new Response("电脑端服务暂时不可用，请确认电脑没有断网或休眠后刷新。", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            status: 503
          })
      )
    );
    return;
  }

  const cacheableStaticAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico");

  event.respondWith(
    fetch(new Request(request, { cache: "reload" }))
      .then((response) => {
        if (cacheableStaticAsset && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            new Response("资源暂时不可用，请刷新页面。", {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
              status: 503
            })
        )
      )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification?.data?.threadId || "";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => "focus" in client);
        if (existing) {
          if (threadId && "postMessage" in existing) existing.postMessage({ type: "OPEN_THREAD", threadId });
          return existing.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(threadId ? `/?thread=${encodeURIComponent(threadId)}` : "/");
        return undefined;
      })
      .catch(() => undefined)
  );
});

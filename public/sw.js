/* Atalaya push SW. Does not run the engine. Does not fetch market data. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "ATALAYA",
    body: "Nueva evaluación",
    url: "/",
    episodeId: "",
    assetId: "",
    state: "",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep defaults */
  }
  const tag = data.episodeId && data.state ? `${data.episodeId}:${data.state}` : "atalaya";
  event.waitUntil(
    self.registration.showNotification(data.title || "ATALAYA", {
      body: data.body || "",
      data: {
        url: data.url || "/",
        episodeId: data.episodeId,
        assetId: data.assetId,
        state: data.state,
      },
      tag,
      renotify: true,
      silent: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "ATALAYA_OPEN", url });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});

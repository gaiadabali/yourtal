// Served as /sw.js on yourtal.gaiada.com once the app has moved to
// member.yourtal.gaiada.com (yourtal.gaiada.com.website.conf). The app's Serwist
// worker had scope / there and would keep serving cached app pages offline.
// The browser's update check fetches this instead: it drops every cache,
// unregisters itself and reloads the open tabs, which then get the website.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: "window" });
      for (const tab of tabs) tab.navigate(tab.url);
    })(),
  );
});

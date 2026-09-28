// Thoth service worker. It makes the app installable and shows critical
// alert notifications; it deliberately caches nothing, so the terminal
// never shows stale data. Tapping a notification focuses the app (or
// opens it) and asks it to open that alert.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (e) => {
	e.notification.close();
	const item = e.notification.data?.item;
	e.waitUntil(
		(async () => {
			const all = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			const client = all.find(
				(c) => new URL(c.url).origin === self.location.origin,
			);
			if (client) {
				await client.focus();
				if (item) client.postMessage({ type: "thoth:open-alert", item });
				return;
			}
			await self.clients.openWindow("/");
		})(),
	);
});

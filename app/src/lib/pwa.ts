"use client";
// Installable app + critical-alert notifications (Settings → Alerts).
// Notifications go through the service worker (public/sw.js) so they work
// in an installed window and on Android, and show only while this page is
// hidden: a visible page already shows the toast.
import type { LayerItem } from "./api";

export const OPEN_ALERT = "thoth:open-alert";

export function registerServiceWorker(): void {
	if (!("serviceWorker" in navigator)) return;
	navigator.serviceWorker.register("/sw.js").catch(() => {
		/* not installable here (http on a LAN host, private mode): the app works without */
	});
}

export function notificationsSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		"serviceWorker" in navigator
	);
}

/** Asks for permission; true when notifications may be shown. */
export async function enableNotifications(): Promise<boolean> {
	if (!notificationsSupported()) return false;
	if (Notification.permission === "granted") return true;
	if (Notification.permission === "denied") return false;
	return (await Notification.requestPermission()) === "granted";
}

export async function notifyCritical(items: LayerItem[]): Promise<void> {
	if (!notificationsSupported() || Notification.permission !== "granted")
		return;
	if (document.visibilityState === "visible") return;
	const reg = await navigator.serviceWorker.getRegistration();
	if (!reg) return;
	for (const a of items.slice(0, 3))
		await reg.showNotification(a.title || "Critical alert", {
			body: `${a.layer} · ${a.source}`,
			tag: a.id,
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
			data: { item: a },
		});
}

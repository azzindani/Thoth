"use client";
// Phone bottom sheets (layers, inspector, full view) share one gesture
// model: they open at HALF height, a swipe up takes them to FULL (just
// under the top bar), a swipe down steps FULL → HALF → closed. A tap on the
// grabber flips HALF ↔ FULL; the ✕ closes. The snap lives on the sheet as
// data-snap so CSS owns the resting heights; JS only drives the finger-
// follow and animates between measured rest heights (FLIP), so the numbers
// are never duplicated here. Desk/tablet: the header is display:none.
import { type ReactNode, useEffect, useRef } from "react";

type Snap = "half" | "full";
// A flick counts even if short: project the release point this many ms ahead.
const FLING_MS = 180;
// px/ms cap, so one jittery sample cannot turn a nudge into a fling.
const MAX_VEL = 2.5;
// Below this travel a pointerup is a tap, not a drag.
const TAP_PX = 6;

function isPhone() {
	return document.body.dataset.bp === "phone";
}

export function SheetHead({
	title,
	onClose,
	closeButton = false,
	children,
}: {
	title?: string;
	/** Runs when the sheet is swiped shut (and on the ✕, if shown). */
	onClose?: () => void;
	closeButton?: boolean;
	children?: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	useEffect(() => {
		const head = ref.current;
		const sheet = head?.parentElement;
		if (!head || !sheet) return;
		// Closed from anywhere (LAYERS button, Esc, a tab) → reopen at half.
		const mo = new MutationObserver(() => {
			if (!sheet.classList.contains("open")) delete sheet.dataset.snap;
		});
		mo.observe(sheet, { attributes: true, attributeFilter: ["class"] });

		let startY = 0;
		let startH = 0;
		let lastY = 0;
		let lastT = 0;
		let vel = 0; // px/ms, + = downward
		let dragging = false;
		let maxH = 0;
		let id: number | null = null;

		const snapOf = (): Snap =>
			sheet.dataset.snap === "full" ? "full" : "half";
		const clearInline = () => {
			sheet.style.height = "";
			sheet.style.maxHeight = "";
			sheet.style.transform = "";
			sheet.style.transition = "";
		};
		// Resting height of a snap, measured from the CSS, not assumed.
		const restHeight = (s: Snap) => {
			const prev = sheet.style.cssText;
			const prevSnap = sheet.dataset.snap;
			clearInline();
			sheet.dataset.snap = s;
			const h = sheet.getBoundingClientRect().height;
			if (prevSnap) sheet.dataset.snap = prevSnap;
			else delete sheet.dataset.snap;
			sheet.style.cssText = prev;
			return h;
		};
		const dur = () =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--t-sheet")
				.trim() || "260ms";
		const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";

		const settle = (from: number, to: Snap) => {
			const target = restHeight(to);
			sheet.dataset.snap = to;
			sheet.style.maxHeight = "none";
			sheet.style.height = `${from}px`;
			sheet.style.transform = "";
			void sheet.offsetHeight; // commit the start frame
			sheet.style.transition = `height ${dur()} ${ease}`;
			sheet.style.height = `${target}px`;
			let done = false;
			const end = () => {
				if (done) return;
				done = true;
				clearInline();
			};
			sheet.addEventListener("transitionend", end, { once: true });
			setTimeout(end, 400);
		};
		const dismiss = (from: number) => {
			sheet.style.maxHeight = "none";
			sheet.style.height = `${from}px`;
			void sheet.offsetHeight;
			sheet.style.transition = `transform ${dur()} ${ease}`;
			sheet.style.transform = "translateY(100%)";
			let done = false;
			const end = () => {
				if (done) return;
				done = true;
				closeRef.current?.();
				sheet.classList.remove("open");
				delete sheet.dataset.snap;
				clearInline();
			};
			sheet.addEventListener("transitionend", end, { once: true });
			setTimeout(end, 400);
		};

		function down(e: PointerEvent) {
			if (!isPhone() || e.button > 0) return;
			if ((e.target as HTMLElement).closest("button, input, select, a")) return;
			id = e.pointerId;
			head?.setPointerCapture(e.pointerId);
			startY = lastY = e.clientY;
			lastT = e.timeStamp;
			vel = 0;
			startH = sheet?.getBoundingClientRect().height ?? 0;
			dragging = false;
		}
		function move(e: PointerEvent) {
			if (e.pointerId !== id || !sheet) return;
			const dy = e.clientY - startY;
			if (!dragging && Math.abs(dy) < TAP_PX) return;
			if (!dragging) {
				dragging = true;
				maxH = restHeight("full");
				sheet.style.transition = "none";
				sheet.style.maxHeight = "none";
			}
			const dt = e.timeStamp - lastT;
			if (dt > 0) vel = 0.7 * ((e.clientY - lastY) / dt) + 0.3 * vel;
			lastY = e.clientY;
			lastT = e.timeStamp;
			let h = startH - dy;
			// resist past full: the sheet never covers the top bar
			if (h > maxH) h = maxH + (h - maxH) * 0.2;
			sheet.style.height = `${Math.max(0, h)}px`;
		}
		function up(e: PointerEvent) {
			if (e.pointerId !== id || !sheet) return;
			id = null;
			if (!dragging) {
				// tap on the grabber: flip half ↔ full
				if (e.type === "pointerup")
					settle(
						sheet.getBoundingClientRect().height,
						snapOf() === "full" ? "half" : "full",
					);
				return;
			}
			dragging = false;
			const cur = sheet.getBoundingClientRect().height;
			const v = Math.max(-MAX_VEL, Math.min(MAX_VEL, vel));
			const projected = cur - v * FLING_MS;
			const half = restHeight("half");
			const full = restHeight("full");
			const mid = (half + full) / 2;
			// Nearest rest point to where the flick would carry the sheet.
			// From FULL a swipe down always stops at HALF (two-step close).
			if (projected > mid) settle(cur, "full");
			else if (snapOf() === "full" || projected >= half * 0.6)
				settle(cur, "half");
			else dismiss(cur);
		}
		head.addEventListener("pointerdown", down);
		head.addEventListener("pointermove", move);
		head.addEventListener("pointerup", up);
		head.addEventListener("pointercancel", up);
		return () => {
			mo.disconnect();
			head.removeEventListener("pointerdown", down);
			head.removeEventListener("pointermove", move);
			head.removeEventListener("pointerup", up);
			head.removeEventListener("pointercancel", up);
		};
	}, []);

	return (
		<div className="sheet-head" ref={ref}>
			<span className="sheet-grip" aria-hidden="true" />
			{(title || closeButton || children) && (
				<div className="sheet-bar">
					{title && <span className="sheet-title">{title}</span>}
					{children}
					{closeButton && (
						<button
							type="button"
							className="sheet-close"
							aria-label={`close ${title?.toLowerCase() ?? "sheet"}`}
							onClick={onClose}
						>
							✕
						</button>
					)}
				</div>
			)}
		</div>
	);
}

"use client";
// Modal dialogs (changelog, sitrep): focus moves in on open, Tab stays
// inside, Escape closes, and focus goes back to whatever opened it. The
// palette and shortcut sheet already manage their own focus.
import { type RefObject, useEffect } from "react";

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
	onClose: () => void,
): void {
	useEffect(() => {
		if (!open) return;
		const box = ref.current;
		if (!box) return;
		const back = document.activeElement as HTMLElement | null;
		const items = () =>
			[...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
				(e) => e.offsetParent !== null,
			);
		requestAnimationFrame(() => (items()[0] ?? box).focus());
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
				return;
			}
			if (e.key !== "Tab") return;
			const list = items();
			if (!list.length) return;
			const first = list[0];
			const last = list[list.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		box.addEventListener("keydown", onKey);
		return () => {
			box.removeEventListener("keydown", onKey);
			if (back?.isConnected) back.focus();
		};
	}, [open, ref, onClose]);
}

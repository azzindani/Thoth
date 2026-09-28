"use client";
import { useCallback, useEffect, useState } from "react";
import {
	loadSettings,
	SETTINGS_EVENT,
	type Settings,
	saveSettings,
	settings,
} from "./settings";

/** Current display settings plus a patch-and-save function; every hook
 * instance re-renders when any of them saves. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
	const [s, setS] = useState<Settings>(settings);
	useEffect(() => {
		setS(loadSettings());
		const on = () => setS(settings());
		window.addEventListener(SETTINGS_EVENT, on);
		return () => window.removeEventListener(SETTINGS_EVENT, on);
	}, []);
	const patch = useCallback(
		(p: Partial<Settings>) => saveSettings({ ...settings(), ...p }),
		[],
	);
	return [s, patch];
}

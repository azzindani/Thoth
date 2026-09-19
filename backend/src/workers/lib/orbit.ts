// Minimal Keplerian propagator for TLE line-pairs (two-body, no drag/J2).
// Accuracy: tens of km for LEO within a day of epoch — honest for a situational
// globe, NOT for conjunction analysis (that needs full SGP4; documented limit).
// Pure math, fully unit-tested below via collectors' tests.

const MU = 398600.4418; // km^3/s^2
const DAY = 86400;
const D2R = Math.PI / 180;

export interface TLE {
	name: string;
	norad: string;
	epochMs: number;
	incl: number; // deg
	raan: number; // deg
	ecc: number; // 0..1
	argp: number; // deg
	ma: number; // deg at epoch
	n: number; // rev/day
}

export function parseTLE3(name: string, l1: string, l2: string): TLE | null {
	try {
		const norad = l1.slice(2, 7).trim();
		const epochYear = Number(l1.slice(18, 20));
		const epochDay = Number(l1.slice(20, 32));
		const year = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
		const epochMs = Date.UTC(year, 0, 1) + (epochDay - 1) * 864e5;
		const t: TLE = {
			name: name.trim(),
			norad,
			epochMs,
			incl: Number(l2.slice(8, 16)),
			raan: Number(l2.slice(17, 25)),
			ecc: Number(`0.${l2.slice(26, 33).trim()}`),
			argp: Number(l2.slice(34, 42)),
			ma: Number(l2.slice(43, 51)),
			n: Number(l2.slice(52, 63)),
		};
		if (
			!t.norad ||
			!Number.isFinite(t.epochMs) ||
			!Number.isFinite(t.incl) ||
			!Number.isFinite(t.raan) ||
			!Number.isFinite(t.ecc) ||
			!Number.isFinite(t.argp) ||
			!Number.isFinite(t.ma) ||
			!Number.isFinite(t.n) ||
			t.n <= 0
		)
			return null;
		return t;
	} catch {
		return null;
	}
}

export function solveKepler(m: number, e: number): number {
	let eA = m + e * Math.sin(m);
	for (let i = 0; i < 8; i++)
		eA -= (eA - e * Math.sin(eA) - m) / (1 - e * Math.cos(eA));
	return eA;
}

function gmst(dateMs: number): number {
	const jd = dateMs / 864e5 + 2440587.5;
	const t = (jd - 2451545.0) / 36525.0;
	return (
		((280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t) %
			360) *
		D2R
	);
}

export function propagate(
	tle: TLE,
	atMs: number,
): { lat: number; lon: number; altKm: number } {
	const a = (MU / (2 * Math.PI * (tle.n / DAY)) ** 2) ** (1 / 3);
	const m =
		(tle.ma * D2R +
			((tle.n * 2 * Math.PI) / DAY) * ((atMs - tle.epochMs) / 1000)) %
		(2 * Math.PI);
	const eA = solveKepler(m < 0 ? m + 2 * Math.PI : m, tle.ecc);
	const nu =
		2 *
		Math.atan2(
			Math.sqrt(1 + tle.ecc) * Math.sin(eA / 2),
			Math.sqrt(1 - tle.ecc) * Math.cos(eA / 2),
		);
	const r = a * (1 - tle.ecc * Math.cos(eA));
	// perifocal → ECI
	const [O, i, w] = [tle.raan * D2R, tle.incl * D2R, tle.argp * D2R];
	const xp = r * Math.cos(nu);
	const yp = r * Math.sin(nu);
	const x =
		(Math.cos(O) * Math.cos(w) - Math.sin(O) * Math.sin(w) * Math.cos(i)) * xp +
		(-Math.cos(O) * Math.sin(w) - Math.sin(O) * Math.cos(w) * Math.cos(i)) * yp;
	const y =
		(Math.sin(O) * Math.cos(w) + Math.cos(O) * Math.sin(w) * Math.cos(i)) * xp +
		(-Math.sin(O) * Math.sin(w) + Math.cos(O) * Math.cos(w) * Math.cos(i)) * yp;
	const z = Math.sin(w) * Math.sin(i) * xp + Math.cos(w) * Math.sin(i) * yp;
	// ECI → ECEF via GMST, spherical lat/lon
	const g = gmst(atMs);
	const lon = Math.atan2(y, x) - g;
	const hyp = Math.hypot(x, y);
	return {
		lat: Math.atan2(z, hyp) / D2R,
		lon: ((((lon / D2R + 540) % 360) - 180 + 540) % 360) - 180,
		altKm: Math.hypot(x, y, z) - 6378.137,
	};
}

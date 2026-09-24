// Country name → map anchor (capital city, [lat, lon]). Used by feeds that
// publish per-country records without coordinates (travel advisories).
// Capitals, not centroids: a marker on the seat of government is where an
// analyst expects it, and centroids of archipelagos land in the sea.
// Names are matched after normalizeCountry(); add aliases below, never
// fuzzy-match ("niger" must not hit "nigeria").
const CAPITALS: Record<string, [number, number]> = {
	afghanistan: [34.53, 69.17],
	albania: [41.33, 19.82],
	algeria: [36.75, 3.06],
	andorra: [42.51, 1.52],
	angola: [-8.84, 13.23],
	anguilla: [18.22, -63.05],
	"antigua and barbuda": [17.12, -61.85],
	argentina: [-34.6, -58.38],
	armenia: [40.18, 44.51],
	aruba: [12.52, -70.03],
	australia: [-35.28, 149.13],
	austria: [48.21, 16.37],
	azerbaijan: [40.41, 49.87],
	bahamas: [25.05, -77.35],
	bahrain: [26.23, 50.59],
	bangladesh: [23.81, 90.41],
	barbados: [13.1, -59.61],
	belarus: [53.9, 27.57],
	belgium: [50.85, 4.35],
	belize: [17.25, -88.77],
	benin: [6.5, 2.6],
	bermuda: [32.29, -64.78],
	bhutan: [27.47, 89.64],
	bolivia: [-16.49, -68.12],
	bonaire: [12.15, -68.27],
	"bosnia and herzegovina": [43.86, 18.41],
	botswana: [-24.65, 25.91],
	brazil: [-15.79, -47.88],
	"british virgin islands": [18.43, -64.62],
	brunei: [4.9, 114.94],
	bulgaria: [42.7, 23.32],
	"burkina faso": [12.37, -1.52],
	burma: [19.76, 96.13],
	burundi: [-3.43, 29.92],
	"cabo verde": [14.93, -23.51],
	cambodia: [11.56, 104.92],
	cameroon: [3.85, 11.5],
	canada: [45.42, -75.7],
	"cayman islands": [19.29, -81.37],
	"central african republic": [4.39, 18.56],
	chad: [12.13, 15.06],
	chile: [-33.45, -70.67],
	china: [39.9, 116.41],
	colombia: [4.71, -74.07],
	comoros: [-11.7, 43.26],
	"cook islands": [-21.21, -159.78],
	"costa rica": [9.93, -84.09],
	"cote divoire": [6.83, -5.29],
	croatia: [45.81, 15.98],
	cuba: [23.11, -82.37],
	curacao: [12.12, -68.93],
	cyprus: [35.19, 33.38],
	czechia: [50.08, 14.44],
	"democratic republic of the congo": [-4.32, 15.31],
	denmark: [55.68, 12.57],
	djibouti: [11.59, 43.15],
	dominica: [15.3, -61.39],
	"dominican republic": [18.49, -69.93],
	ecuador: [-0.18, -78.47],
	egypt: [30.04, 31.24],
	"el salvador": [13.69, -89.22],
	"equatorial guinea": [3.75, 8.78],
	eritrea: [15.32, 38.93],
	estonia: [59.44, 24.75],
	eswatini: [-26.31, 31.14],
	ethiopia: [9.03, 38.74],
	"falkland islands": [-51.7, -57.85],
	"faroe islands": [62.01, -6.77],
	fiji: [-18.14, 178.44],
	finland: [60.17, 24.94],
	france: [48.86, 2.35],
	"french guiana": [4.94, -52.33],
	"french polynesia": [-17.54, -149.57],
	gabon: [0.42, 9.47],
	gambia: [13.45, -16.58],
	gaza: [31.5, 34.47],
	georgia: [41.72, 44.79],
	germany: [52.52, 13.4],
	ghana: [5.6, -0.19],
	gibraltar: [36.14, -5.35],
	greece: [37.98, 23.73],
	greenland: [64.18, -51.72],
	grenada: [12.06, -61.75],
	guadeloupe: [16.24, -61.53],
	guatemala: [14.63, -90.51],
	guinea: [9.64, -13.58],
	"guinea bissau": [11.86, -15.6],
	guyana: [6.8, -58.16],
	haiti: [18.59, -72.31],
	"holy see": [41.9, 12.45],
	honduras: [14.07, -87.19],
	"hong kong": [22.32, 114.17],
	hungary: [47.5, 19.04],
	iceland: [64.15, -21.94],
	india: [28.61, 77.21],
	indonesia: [-6.21, 106.85],
	iran: [35.69, 51.39],
	iraq: [33.31, 44.36],
	ireland: [53.35, -6.26],
	israel: [31.77, 35.21],
	italy: [41.9, 12.5],
	jamaica: [18.02, -76.8],
	japan: [35.68, 139.69],
	jordan: [31.95, 35.93],
	kazakhstan: [51.17, 71.45],
	kenya: [-1.29, 36.82],
	kiribati: [1.45, 173.03],
	kosovo: [42.66, 21.17],
	kuwait: [29.38, 47.99],
	kyrgyzstan: [42.87, 74.59],
	laos: [17.98, 102.63],
	latvia: [56.95, 24.11],
	lebanon: [33.89, 35.5],
	lesotho: [-29.31, 27.48],
	liberia: [6.3, -10.8],
	libya: [32.89, 13.19],
	liechtenstein: [47.14, 9.52],
	lithuania: [54.69, 25.28],
	luxembourg: [49.61, 6.13],
	macau: [22.2, 113.55],
	madagascar: [-18.88, 47.51],
	malawi: [-13.96, 33.79],
	malaysia: [3.14, 101.69],
	maldives: [4.18, 73.51],
	mali: [12.64, -8.0],
	malta: [35.9, 14.51],
	"marshall islands": [7.09, 171.38],
	martinique: [14.6, -61.07],
	mauritania: [18.08, -15.98],
	mauritius: [-20.16, 57.5],
	mayotte: [-12.78, 45.23],
	mexico: [19.43, -99.13],
	micronesia: [6.92, 158.16],
	moldova: [47.01, 28.86],
	monaco: [43.74, 7.42],
	mongolia: [47.89, 106.91],
	montenegro: [42.44, 19.26],
	montserrat: [16.74, -62.19],
	morocco: [34.02, -6.84],
	mozambique: [-25.97, 32.57],
	namibia: [-22.56, 17.08],
	nauru: [-0.55, 166.92],
	nepal: [27.72, 85.32],
	netherlands: [52.37, 4.9],
	"new caledonia": [-22.28, 166.46],
	"new zealand": [-41.29, 174.78],
	nicaragua: [12.11, -86.24],
	niger: [13.51, 2.11],
	nigeria: [9.08, 7.4],
	niue: [-19.06, -169.92],
	"north korea": [39.04, 125.76],
	"north macedonia": [42.0, 21.43],
	norway: [59.91, 10.75],
	oman: [23.59, 58.41],
	pakistan: [33.68, 73.05],
	palau: [7.5, 134.62],
	panama: [8.98, -79.52],
	"papua new guinea": [-9.44, 147.18],
	paraguay: [-25.26, -57.58],
	peru: [-12.05, -77.04],
	philippines: [14.6, 120.98],
	poland: [52.23, 21.01],
	portugal: [38.72, -9.14],
	qatar: [25.29, 51.53],
	"republic of the congo": [-4.27, 15.28],
	reunion: [-20.88, 55.45],
	romania: [44.43, 26.1],
	russia: [55.76, 37.62],
	rwanda: [-1.94, 30.06],
	"saint barthelemy": [17.9, -62.85],
	"saint kitts and nevis": [17.3, -62.72],
	"saint lucia": [14.01, -60.99],
	"saint martin": [18.07, -63.08],
	"saint pierre and miquelon": [46.78, -56.18],
	"saint vincent and the grenadines": [13.16, -61.22],
	samoa: [-13.83, -171.76],
	"san marino": [43.94, 12.45],
	"sao tome and principe": [0.34, 6.73],
	"saudi arabia": [24.71, 46.68],
	senegal: [14.72, -17.47],
	serbia: [44.79, 20.45],
	seychelles: [-4.62, 55.45],
	"sierra leone": [8.48, -13.23],
	singapore: [1.35, 103.82],
	"sint maarten": [18.03, -63.05],
	slovakia: [48.15, 17.11],
	slovenia: [46.06, 14.51],
	"solomon islands": [-9.43, 159.95],
	somalia: [2.05, 45.32],
	"south africa": [-25.75, 28.19],
	"south korea": [37.57, 126.98],
	"south sudan": [4.85, 31.58],
	spain: [40.42, -3.7],
	"sri lanka": [6.93, 79.85],
	sudan: [15.5, 32.56],
	suriname: [5.85, -55.2],
	sweden: [59.33, 18.07],
	switzerland: [46.95, 7.45],
	syria: [33.51, 36.29],
	taiwan: [25.03, 121.57],
	tajikistan: [38.56, 68.79],
	tanzania: [-6.16, 35.75],
	thailand: [13.76, 100.5],
	"timor leste": [-8.56, 125.57],
	togo: [6.13, 1.22],
	tonga: [-21.14, -175.2],
	"trinidad and tobago": [10.65, -61.52],
	tunisia: [36.81, 10.18],
	turkey: [39.93, 32.86],
	turkmenistan: [37.95, 58.38],
	"turks and caicos islands": [21.46, -71.14],
	tuvalu: [-8.52, 179.2],
	uganda: [0.35, 32.58],
	ukraine: [50.45, 30.52],
	"united arab emirates": [24.45, 54.38],
	"united kingdom": [51.51, -0.13],
	"united states": [38.9, -77.04],
	uruguay: [-34.9, -56.16],
	uzbekistan: [41.3, 69.24],
	vanuatu: [-17.73, 168.32],
	venezuela: [10.48, -66.9],
	vietnam: [21.03, 105.85],
	"west bank": [31.9, 35.2],
	yemen: [15.37, 44.19],
	zambia: [-15.39, 28.32],
	zimbabwe: [-17.83, 31.05],
};

const ALIASES: Record<string, string> = {
	myanmar: "burma",
	"burma myanmar": "burma",
	"ivory coast": "cote divoire",
	"czech republic": "czechia",
	turkiye: "turkey",
	"cape verde": "cabo verde",
	"east timor": "timor leste",
	swaziland: "eswatini",
	macedonia: "north macedonia",
	"vatican city": "holy see",
	vatican: "holy see",
	uk: "united kingdom",
	usa: "united states",
	us: "united states",
	"united states of america": "united states",
	"great britain": "united kingdom",
	uae: "united arab emirates",
	"mainland china": "china",
	"peoples republic of china": "china",
	"russian federation": "russia",
	lao: "laos",
	"lao pdr": "laos",
	"syrian arab republic": "syria",
	"viet nam": "vietnam",
	"republic of korea": "south korea",
	"korea south": "south korea",
	"korea north": "north korea",
	"democratic peoples republic of korea": "north korea",
	dprk: "north korea",
	"federated states of micronesia": "micronesia",
	drc: "democratic republic of the congo",
	"congo kinshasa": "democratic republic of the congo",
	"democratic republic of congo": "democratic republic of the congo",
	"congo brazzaville": "republic of the congo",
	congo: "republic of the congo",
	"republic of congo": "republic of the congo",
	"united republic of tanzania": "tanzania",
	"palestinian territories": "west bank",
	"gaza strip": "gaza",
	"st maarten": "sint maarten",
	"netherlands antilles": "curacao",
	"turks and caicos": "turks and caicos islands",
	"bosnia herzegovina": "bosnia and herzegovina",
	"sao tome": "sao tome and principe",
	"brunei darussalam": "brunei",
	falklands: "falkland islands",
	// UNHCR abbreviations ("Syrian Arab Rep.", "Dem. Rep. of the Congo").
	"syrian arab rep": "syria",
	"dem rep of the congo": "democratic republic of the congo",
	"central african rep": "central african republic",
	"dominican rep": "dominican republic",
	"rep of moldova": "moldova",
	"rep of korea": "south korea",
	"united rep of tanzania": "tanzania",
	"lao peoples dem rep": "laos",
	"dem peoples rep of korea": "north korea",
	"state of palestine": "west bank",
	palestinian: "west bank",
	// GeoIP names ("Korea, Republic of", "Moldova, Republic of").
	"korea republic of": "south korea",
	"korea democratic peoples republic of": "north korea",
	"iran islamic republic of": "iran",
	"moldova republic of": "moldova",
	"tanzania united republic of": "tanzania",
	"lao peoples democratic republic": "laos",
};

export function normalizeCountry(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[’'`]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\bst\b/g, "saint")
		.trim()
		.replace(/^the /, "")
		.replace(/\s+/g, " ");
}

function hit(key: string): string | null {
	if (CAPITALS[key]) return key;
	const a = ALIASES[key];
	return a && CAPITALS[a] ? a : null;
}

/** Resolve a feed's country label to a canonical key + capital anchor.
 * Tries the whole label, then its parts: "Burma (Myanmar)", "Korea, North",
 * "Congo, Democratic Republic of the", "Israel, the West Bank and Gaza". */
export function locateCountry(
	label: string,
): { key: string; lat: number; lon: number } | null {
	const raw = label.trim();
	const paren = raw.match(/\(([^)]+)\)/)?.[1];
	const noParen = raw.replace(/\([^)]*\)/g, " ");
	const comma = noParen.split(",");
	const cands = [
		raw,
		noParen,
		paren ?? "",
		comma.length === 2 ? `${comma[1]} ${comma[0]}` : "",
		comma[0],
	];
	for (const c of cands) {
		if (!c) continue;
		const k = hit(normalizeCountry(c));
		if (k) {
			const [lat, lon] = CAPITALS[k];
			return { key: k, lat, lon };
		}
	}
	return null;
}

/** Nearest capital's country (display name) within `maxKm`, for naming a
 * map cell ("near Latvia"). Coarse by design: capitals, not borders. */
export function nearestCountry(
	lat: number,
	lon: number,
	maxKm = 1200,
): string | null {
	const rad = Math.PI / 180;
	let best: string | null = null;
	let bestKm = maxKm;
	for (const [k, [la, lo]] of Object.entries(CAPITALS)) {
		const dLat = (la - lat) * rad;
		const dLon = (lo - lon) * rad;
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(lat * rad) * Math.cos(la * rad) * Math.sin(dLon / 2) ** 2;
		const km = 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
		if (km < bestKm) {
			bestKm = km;
			best = k;
		}
	}
	return best ? best.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
}

/** Every country key the locator knows, title-cased for display. */
export function countryNames(): string[] {
	return Object.keys(CAPITALS)
		.map((k) => k.replace(/\b[a-z]/g, (c) => c.toUpperCase()))
		.sort();
}

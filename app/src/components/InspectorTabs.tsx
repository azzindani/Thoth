"use client";
import { useEffect, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { STREAMS } from "../lib/layer-catalog";
import { Field, ItemRow } from "../lib/ui";

export function FeedTab({ layer, title }: { layer: string; title: string }) {
	const [items, setItems] = useState<LayerItem[] | null>(null);
	useEffect(() => {
		let stop = false;
		api
			.layer(layer)
			.then((j) => {
				if (!stop) setItems(j.items);
			})
			.catch(() => {
				if (!stop) setItems([]);
			});
		return () => {
			stop = true;
		};
	}, [layer]);
	if (!items)
		return <div style={{ color: "var(--dim)" }}>loading {title}…</div>;
	return (
		<>
			<h3>
				{title} · {items.length}{" "}
				<a
					href={api.exportUrl(layer, "csv")}
					target="_blank"
					rel="noreferrer"
					title="download CSV"
				>
					CSV
				</a>{" "}
				<a
					href={api.exportUrl(layer, "geojson")}
					target="_blank"
					rel="noreferrer"
					title="download GeoJSON"
				>
					GEO
				</a>
			</h3>
			{items.slice(0, 60).map((a) => (
				<ItemRow key={a.id}>
					<b>{a.source}</b> · {a.title}
					{a.url && (
						<>
							{" "}
							<a href={a.url} target="_blank" rel="noreferrer">
								↗
							</a>
						</>
					)}
					<br />
					<span style={{ color: "var(--dim)" }}>
						{String(a.ts).slice(0, 16)}
					</span>
				</ItemRow>
			))}
		</>
	);
}

export function CyberTab({
	onOsint,
}: {
	onOsint?: (kind: string, arg: string) => void;
}) {
	const cveOf = (t: LayerItem) => {
		const m = `${t.title ?? ""} ${t.body ?? ""}`.match(/CVE-\d{4}-\d{4,}/i);
		return m ? m[0].toUpperCase() : null;
	};
	const [items, setItems] = useState<LayerItem[] | null>(null);
	const [q, setQ] = useState("");
	const [mitre, setMitre] = useState<
		{ id: string; name: string; tactics?: string[] }[] | null
	>(null);
	useEffect(() => {
		let stop = false;
		api
			.layer("cyber")
			.then((j) => {
				if (!stop) setItems(j.items);
			})
			.catch(() => {
				if (!stop) setItems([]);
			});
		return () => {
			stop = true;
		};
	}, []);
	async function goMitre() {
		if (!q.trim()) return;
		try {
			const j = (await api.osint("mitre", q)) as {
				items?: { id: string; name: string; tactics?: string[] }[];
			};
			setMitre(j.items ?? []);
		} catch {
			setMitre([]);
		}
	}
	const kev = (items ?? []).filter((i) => i.source === "cisa-kev");
	const urls = (items ?? []).filter((i) => i.source === "urlhaus");
	return (
		<>
			<h3>
				CYBER · KEV {kev.length} · URLHAUS {urls.length}
			</h3>
			<div className="row2" style={{ margin: "6px 0" }}>
				<Field
					placeholder="mitre technique…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") goMitre();
					}}
				/>
				<button className="go" onClick={goMitre}>
					Go
				</button>
			</div>
			{mitre && (
				<>
					<h3>MITRE · {mitre.length}</h3>
					{mitre.map((t) => (
						<ItemRow key={t.id}>
							<b>{t.id}</b> · {t.name}
							<br />
							<span style={{ color: "var(--dim)" }}>
								{(t.tactics ?? []).join(", ")}
							</span>
						</ItemRow>
					))}
				</>
			)}
			<h3>Known exploited</h3>
			{kev.slice(0, 20).map((a) => {
				const cve = cveOf(a);
				return (
					<ItemRow key={a.id}>
						<b>{a.title}</b>{" "}
						{cve && onOsint && (
							<button
								className="go"
								title={`NVD lookup ${cve}`}
								onClick={() => onOsint("cve", cve)}
							>
								{cve}
							</button>
						)}
						<br />
						<span style={{ color: "var(--dim)" }}>
							{String(a.ts).slice(0, 10)}
						</span>
					</ItemRow>
				);
			})}
		</>
	);
}

export function BriefBlock() {
	const [b, setB] = useState<{
		generated_at: string;
		critical: LayerItem[];
		watch: LayerItem[];
		gaps: { source: string; error: string | null }[];
	} | null>(null);
	useEffect(() => {
		let stop = false;
		api
			.brief()
			.then((j) => {
				if (!stop) setB(j);
			})
			.catch(() => {});
		return () => {
			stop = true;
		};
	}, []);
	if (!b) return null;
	return (
		<>
			<h3>Brief · {String(b.generated_at).slice(11, 16)}Z</h3>
			{[
				...b.critical.slice(0, 5).map((a) => ({ a, sev: "critical" })),
				...b.watch.slice(0, 5).map((a) => ({ a, sev: "watch" })),
			].map(({ a, sev }) => (
				<div key={a.id} className="item sev-row" data-sev={sev}>
					<span className="lyr">{a.layer}</span>
					{a.title}
				</div>
			))}
			{b.gaps.length > 0 && (
				<details className="gaps">
					<summary>{b.gaps.length} feeds without fresh data</summary>
					<div className="gaps-list">
						{b.gaps.map((g) => g.source).join(" · ")}
					</div>
				</details>
			)}
		</>
	);
}

export function AreaTab({
	area,
	goArea,
}: {
	area: {
		lat: string;
		lng: string;
		r: string;
		label: string;
		counts: { layer: string; count: string }[];
		items: LayerItem[];
		threat?: { score: number; level: string };
	} | null;
	goArea: (lat: string, lng: string, r: string) => void;
}) {
	const [lat, setLat] = useState(area?.lat ?? "51.5");
	const [lng, setLng] = useState(area?.lng ?? "-0.12");
	const [r, setR] = useState("300");
	if (!area)
		return (
			<>
				<div className="row2" style={{ margin: "6px 0" }}>
					<Field value={lat} onChange={(e) => setLat(e.target.value)} />
					<Field value={lng} onChange={(e) => setLng(e.target.value)} />
					<select value={r} onChange={(e) => setR(e.target.value)}>
						<option>100</option>
						<option>300</option>
						<option>1000</option>
					</select>
					<button className="go" id="ar-go" onClick={() => goArea(lat, lng, r)}>
						Go
					</button>
				</div>
				<div style={{ color: "var(--dim)" }}>
					right-click the map or enter coords
				</div>
			</>
		);
	return (
		<>
			<h3>
				AREA · {area.lat},{area.lng} · {area.r}KM
			</h3>
			{area.threat && (
				<div style={{ fontSize: 14, margin: "4px 0" }}>
					THREAT{" "}
					<b
						style={{
							color:
								area.threat.level === "HIGH"
									? "var(--red)"
									: area.threat.level === "ELEVATED"
										? "var(--amber)"
										: "var(--grn)",
						}}
					>
						{area.threat.level} {area.threat.score}
					</b>
				</div>
			)}
			{area.label && (
				<div style={{ color: "var(--txt)", fontWeight: 600, fontSize: 13 }}>
					{area.label}
				</div>
			)}
			<div>
				{area.counts.length === 0 && "nothing in window"}
				{area.counts.map((c) => (
					<span key={c.layer}>
						{c.layer}{" "}
						<b
							style={{
								color: "var(--dim)",
								fontWeight: 500,
								fontVariantNumeric: "tabular-nums",
							}}
						>
							{c.count}
						</b>{" "}
						·{" "}
					</span>
				))}
			</div>
			{area.items.slice(0, 30).map((i) => (
				<ItemRow key={i.id}>
					<b>{i.layer}</b> · {i.title}
					{i.url && (
						<>
							{" "}
							<a href={i.url} target="_blank" rel="noreferrer">
								↗
							</a>
						</>
					)}
					<br />
					<span style={{ color: "var(--dim)" }}>
						{i.source} · {String(i.ts).slice(0, 10)}
					</span>
				</ItemRow>
			))}
		</>
	);
}

export function SdnTab({
	sdn,
	goSdn,
}: {
	sdn: { q: string; items: Record<string, unknown>[] } | null;
	goSdn: (q: string) => void;
}) {
	const [q, setQ] = useState(sdn?.q ?? "");
	return (
		<>
			<div className="row2" style={{ margin: "6px 0" }}>
				<Field
					placeholder="sanctions search…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") goSdn(q);
					}}
				/>
				<button className="go" id="sdn-go" onClick={() => goSdn(q)}>
					Go
				</button>
			</div>
			{(sdn?.items ?? []).map((s, i) => (
				<ItemRow key={i}>
					<b>{String(s.name ?? "")}</b>
					<br />
					<span style={{ color: "var(--dim)" }}>
						{String((s as { dataset?: string }).dataset ?? "")} ·{" "}
						{String((s as { countries?: string }).countries ?? "")}
					</span>
				</ItemRow>
			))}
		</>
	);
}

export function VideoTab({
	video,
	setVideo,
}: {
	video: string;
	setVideo: (v: string) => void;
}) {
	const v = STREAMS.find((s) => s[1] === video) ?? STREAMS[0];
	return (
		<>
			<h3>Live video · {v[0]}</h3>
			<iframe
				width="100%"
				height={180}
				src={`https://www.youtube.com/embed/${v[1]}?autoplay=1`}
				frameBorder={0}
				allow="autoplay; encrypted-media"
				allowFullScreen
				title={v[0]}
			/>
			<div>
				{STREAMS.map((s) => (
					<ItemRow key={s[1]} onClick={() => setVideo(s[1])}>
						<b>{s[0]}</b>
						<br />
						<span style={{ color: "var(--dim)" }}>{s[2]} · 24/7</span>
					</ItemRow>
				))}
			</div>
		</>
	);
}

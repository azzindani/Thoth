"use client";
// Country page (ROADMAP P5): one country across every layer — advisories
// (US + UK), displacement, what is happening within a radius of the
// capital (7 days), and wire stories that name it. Tables throughout;
// rows fly the map.
import { useEffect, useMemo, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { ageStr, Field } from "../lib/ui";
import { type Column, DataTable } from "./DataTable";
import { flyTo } from "./MapView";

type Country = Awaited<ReturnType<typeof api.country>>;
type Count = Country["counts"][number];

function Sev({ s }: { s?: string }) {
	return (
		<span className={`sev-${s || "info"}`}>{(s || "info").toUpperCase()}</span>
	);
}
const flyItem = (i: LayerItem) => {
	const g = i.geom as { type: string; coordinates: number[] } | null;
	if (g?.type === "Point") flyTo(g.coordinates[1], g.coordinates[0], 6);
};

export function CountryTab({ initial }: { initial?: string }) {
	const [q, setQ] = useState(initial ?? "");
	const [radius, setRadius] = useState(500);
	const [names, setNames] = useState<string[]>([]);
	const [data, setData] = useState<Country | null>(null);
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api
			.countryList()
			.then((j) => setNames(j.items))
			.catch(() => {});
	}, []);

	const go = async (name = q, r = radius) => {
		if (name.trim().length < 2) return;
		setBusy(true);
		setErr("");
		try {
			const j = await api.country(name.trim(), r);
			setData(j);
			flyTo(j.country.lat, j.country.lon, 4);
		} catch {
			setData(null);
			setErr(`No country called “${name.trim()}”.`);
		} finally {
			setBusy(false);
		}
	};
	// Opened with a name (command line / palette): load it once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: run once per requested name
	useEffect(() => {
		if (initial) void go(initial);
	}, [initial]);

	const countCols = useMemo<Column<Count>[]>(
		() => [
			{
				key: "layer",
				label: "Layer",
				sort: (c) => c.layer,
				render: (c) => <b className="dt-key">{c.layer}</b>,
			},
			{
				key: "n",
				label: "Events",
				num: true,
				sort: (c) => c.n,
				render: (c) => c.n,
			},
			{
				key: "critical",
				label: "Critical",
				num: true,
				sort: (c) => c.critical,
				render: (c) =>
					c.critical ? <span className="sev-critical">{c.critical}</span> : "—",
			},
			{
				key: "watch",
				label: "Watch",
				num: true,
				sort: (c) => c.watch,
				render: (c) =>
					c.watch ? <span className="sev-watch">{c.watch}</span> : "—",
			},
		],
		[],
	);
	const itemCols = useMemo<Column<LayerItem>[]>(
		() => [
			{
				key: "sev",
				label: "Severity",
				sort: (i) =>
					i.severity === "critical" ? 0 : i.severity === "watch" ? 1 : 2,
				render: (i) => <Sev s={i.severity} />,
			},
			{
				key: "title",
				label: "Item",
				sort: (i) => i.title ?? "",
				render: (i) => (
					<span className="dt-clip dt-key" title={i.title}>
						{i.title ?? i.id}
					</span>
				),
			},
			{
				key: "layer",
				label: "Layer",
				wide: true,
				sort: (i) => i.layer,
				render: (i) => i.layer,
			},
			{
				key: "ts",
				label: "When",
				num: true,
				sort: (i) => Date.parse(i.ts) || null,
				render: (i) => ageStr(i.ts),
			},
		],
		[],
	);

	return (
		<div className="country-tab">
			<form
				className="row2"
				style={{ margin: "6px 0" }}
				onSubmit={(e) => {
					e.preventDefault();
					void go();
				}}
			>
				<Field
					id="country-q"
					list="country-names"
					placeholder="Country…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					aria-label="country"
				/>
				<datalist id="country-names">
					{names.map((n) => (
						<option key={n} value={n} />
					))}
				</datalist>
				<select
					value={radius}
					aria-label="radius around the capital"
					onChange={(e) => {
						const r = Number(e.target.value);
						setRadius(r);
						if (data) void go(data.country.name, r);
					}}
				>
					{[250, 500, 1000, 2000].map((r) => (
						<option key={r} value={r}>
							{r} km
						</option>
					))}
				</select>
				<button className="go" id="country-go" type="submit" disabled={busy}>
					Go
				</button>
			</form>
			{err && <div className="dim">{err}</div>}
			{!data && !err && (
				<div className="dim">
					Advisories, displacement, hazards, conflicts and news for one country.
					Events are counted within the radius of its capital.
				</div>
			)}
			{data && (
				<>
					<div className="mon-head">
						<h3 id="country-name">{data.country.name}</h3>
					</div>
					<div className="mon-kpis" id="country-kpis">
						{data.advisories.map((a) => (
							<a
								key={`${a.source}:${a.title}`}
								className={`mon-kpi${a.severity === "critical" ? " bad" : a.severity === "watch" ? " warn" : ""}`}
								href={a.url ?? undefined}
								target="_blank"
								rel="noreferrer"
								title={a.title}
							>
								{a.source === "uk-fcdo" ? "UK" : "US"} ·{" "}
								{a.title
									.split(": ")
									.slice(1)
									.join(": ")
									.replace(" (fixture)", "") || a.severity}
							</a>
						))}
						{!data.advisories.length && (
							<span className="mon-kpi">no travel advisory</span>
						)}
						{data.displacement && (
							<span
								className={`mon-kpi${data.displacement.severity === "critical" ? " bad" : ""}`}
							>
								{data.displacement.title}
							</span>
						)}
					</div>
					<div className="mon-sub">
						Within {data.radius_km} km of the capital · 7 days
					</div>
					<DataTable
						label={`Layers near ${data.country.name}`}
						rows={data.counts}
						cols={countCols}
						rowKey={(c) => c.layer}
						initialSort={{ key: "n", dir: "desc" }}
						empty="Nothing within the radius in the last 7 days."
					/>
					<div className="mon-sub">Critical and watch items</div>
					<DataTable
						label="Critical and watch items"
						rows={data.items}
						cols={itemCols}
						rowKey={(i) => i.id}
						rowClass={() => "country-row"}
						initialSort={{ key: "sev", dir: "asc" }}
						onRowClick={flyItem}
						empty="No critical or watch items within the radius."
					/>
					<div className="mon-sub">In the news (3 days)</div>
					<DataTable
						label="News naming the country"
						rows={data.mentions}
						cols={itemCols}
						rowKey={(i) => i.id}
						initialSort={{ key: "ts", dir: "desc" }}
						onRowClick={flyItem}
						empty="No wire stories name this country in the last 3 days."
					/>
				</>
			)}
		</div>
	);
}

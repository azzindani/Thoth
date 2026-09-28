"use client";
// PROVENANCE — the record behind a map object and how to check it: the
// original report, the feed it came from (and whether that feed is
// healthy), when it was observed and last re-confirmed, independent
// reports of the same event, public trackers keyed by the object's own id,
// and the raw stored record. Replaces a detail view that showed fields
// with no way to trace them back.
import { useEffect, useState } from "react";
import { api, type EventProvenance } from "../lib/api";
import { hostOf, sourceHome, verifyLinks } from "../lib/sources";
import { ageStr, fmtCadence, KV } from "../lib/ui";
import type { ObjProps } from "./MapView";

function utc(ts: string | null | undefined): string {
	const t = Date.parse(String(ts ?? ""));
	if (!Number.isFinite(t)) return "—";
	return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer noopener">
			{children}
		</a>
	);
}

type Member = {
	id: string;
	ts: string;
	layer: string;
	source: string;
	title: string | null;
	url?: string | null;
};

export function Provenance({ sel }: { sel: ObjProps }) {
	const [p, setP] = useState<EventProvenance | null | undefined>(undefined);
	useEffect(() => {
		let stop = false;
		setP(undefined);
		api
			.event(sel.id)
			.then((j) => {
				if (!stop) setP(j);
			})
			.catch(() => {
				if (!stop) setP(null);
			});
		return () => {
			stop = true;
		};
	}, [sel.id]);

	if (p === undefined)
		return <div style={{ color: "var(--dim)" }}>source record…</div>;
	if (!p)
		return (
			<div className="prov-miss">
				The stored record is gone (it aged out or its feed dropped it). What is
				shown above is the map's last copy.
			</div>
		);

	const it = p.item;
	const meta = it.meta ?? {};
	// Flat fields read as a table; nested ones live in the raw record.
	const flat = Object.entries(meta).filter(
		([k, v]) => k !== "airline" && (v === null || typeof v !== "object"),
	);
	const members = Array.isArray(meta.timeline)
		? (meta.timeline as Member[])
		: [];
	const home = sourceHome(it.source);
	const host = hostOf(it.url);
	const f = p.feed;
	const failing = Boolean(f?.error);
	const lastOk = f?.last_ok ?? null;
	const late =
		lastOk && f?.intervalSec
			? Date.now() - Date.parse(lastOk) > f.intervalSec * 3 * 1000
			: false;
	const status = !f
		? "unknown"
		: failing
			? "failing"
			: late
				? "late"
				: lastOk
					? "ok"
					: "no successful poll";
	const links = verifyLinks({
		id: it.id,
		layer: it.layer,
		title: it.title,
		lat: sel.lat,
		lon: sel.lon,
	});
	const related = p.related.filter((r) => r.source !== it.source);
	const sameFeed = p.related.length - related.length;
	const sources = new Set(related.map((r) => r.source));

	return (
		<>
			{it.body && <div className="prov-body">{it.body}</div>}
			{flat.length > 0 && (
				<KV
					pairs={flat
						.slice(0, 14)
						.map(([k, v]) => [k.toUpperCase().slice(0, 12), String(v)])}
				/>
			)}

			<h3 className="prov-h">Source &amp; verification</h3>
			<div className="prov-card">
				{it.url ? (
					<a
						className="prov-open"
						href={it.url}
						target="_blank"
						rel="noreferrer noopener"
					>
						<span>Open original report</span>
						<span className="dim">{host ?? "link"} ↗</span>
					</a>
				) : (
					<div className="prov-miss">
						This feed publishes no per-item link.
						{home && (
							<>
								{" "}
								Check the publisher: <Ext href={home}>{hostOf(home)} ↗</Ext>
							</>
						)}
					</div>
				)}
				<KV
					pairs={[
						[
							"SOURCE",
							home ? (
								<Ext key="s" href={home}>
									{it.source} ↗
								</Ext>
							) : (
								it.source
							),
						],
						[
							"FEED",
							<span key="f">
								<span className={`prov-dot prov-${status.split(" ")[0]}`} />
								{status}
								{f?.intervalSec
									? ` · polled every ${fmtCadence(f.intervalSec)}`
									: ""}
								{lastOk ? ` · last ok ${ageStr(lastOk)}` : ""}
							</span>,
						],
						...(failing
							? [["ERROR", String(f?.error).slice(0, 140)] as [string, string]]
							: []),
						...(p.lastFetch
							? [
									[
										"FETCH",
										`${ageStr(p.lastFetch.fetched_at)} · HTTP ${p.lastFetch.http_status ?? "—"}`,
									] as [string, string],
								]
							: []),
						["OBSERVED", `${utc(it.ts)} · ${ageStr(it.ts)}`],
						[
							"CONFIRMED",
							`${utc(it.ingested_at)} · last poll that still carried it`,
						],
						...(it.confidence != null
							? [
									[
										"CONFIDENCE",
										`${Math.round(Number(it.confidence) * 100)}%`,
									] as [string, string],
								]
							: []),
						["ID", <code key="i">{it.id}</code>],
					]}
				/>
			</div>

			<h3 className="prov-h">
				Corroboration ·{" "}
				{sources.size
					? `${sources.size} other source${sources.size > 1 ? "s" : ""}`
					: "single source"}
			</h3>
			{related.length ? (
				<div className="prov-list">
					{related.map((r) => (
						<div key={r.id} className="prov-row">
							<span className="dim mono">{r.source}</span>
							<span className="prov-t">{r.title ?? r.id}</span>
							<span className="dim">
								{ageStr(r.ts)} · {r.reason}
							</span>
							{r.url && <Ext href={r.url}>{hostOf(r.url) ?? "open"} ↗</Ext>}
						</div>
					))}
				</div>
			) : (
				<div className="prov-miss">
					No other feed reported a matching event
					{sameFeed
						? ` (${sameFeed} repeat${sameFeed > 1 ? "s" : ""} from the same feed)`
						: ""}
					. Treat as unconfirmed until another source agrees.
				</div>
			)}

			{members.length > 0 && (
				<>
					<h3 className="prov-h">Member reports · {members.length}</h3>
					<div className="prov-list">
						{members.map((m) => (
							<div key={m.id} className="prov-row">
								<span className="dim mono">
									{m.layer} · {m.source}
								</span>
								<span className="prov-t">{m.title ?? m.id}</span>
								<span className="dim">{ageStr(m.ts)}</span>
								{m.url && <Ext href={m.url}>{hostOf(m.url) ?? "open"} ↗</Ext>}
							</div>
						))}
					</div>
				</>
			)}

			{links.length > 0 && (
				<>
					<h3 className="prov-h">Check independently</h3>
					<div className="prov-chips">
						{links.map((l) => (
							<Ext key={l.href} href={l.href}>
								{l.label} ↗
							</Ext>
						))}
					</div>
				</>
			)}

			<details className="prov-raw">
				<summary className="prov-sum">Raw stored record</summary>
				<pre>{JSON.stringify(it, null, 2)}</pre>
			</details>
		</>
	);
}

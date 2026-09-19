"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { LAYER_NAMES } from "../lib/layer-catalog";
import { ItemRow, KV } from "../lib/ui";

export default function OsintView({
	kind,
	arg,
}: {
	kind: string;
	arg: string;
}) {
	const [body, setBody] = useState<React.ReactNode>("looking up…");
	useEffect(() => {
		let stop = false;
		(async () => {
			try {
				if (kind === "geo") {
					const g = (await api.osint("geo", arg)) as {
						label?: string;
						error?: string;
					};
					if (!stop)
						setBody(
							<>
								<h3>Geo · {arg}</h3>
								<div style={{ fontSize: 14 }}>
									{g.label || g.error || "unknown"}
								</div>
							</>,
						);
					return;
				}
				// search/watch/cert/asn/cve/sitrep fetch inside their own branches —
				// the generic /api/osint/:kind call would 404 for non-OSINT kinds.
				const j = [
					"search",
					"watch",
					"cert",
					"asn",
					"cve",
					"epss",
					"osv",
					"circl",
					"mitre-cve",
					"ghsa",
					"ror",
					"geocode",
					"macro-imf",
					"ports",
					"doh",
					"doh-google",
					"doh-cf",
					"robtex",
					"fdic",
					"token",
					"wikidata",
					"wiki",
					"books",
					"stack",
					"nominatim",
					"omgeo",
					"maltiverse",
					"urlscan",
					"crfunder",
					"food",
					"music",
					"maltsearch",
					"fda-drug",
					"gene",
					"ontology",
					"protein",
					"package",
					"daylight",
					"zip",
					"transit",
					"name",
					"funder",
					"museum",
					"rxnorm",
					"chembl",
					"sbdb",
					"deps",
					"nasa-img",
					"planespotter",
					"ipwhois",
					"sitrep",
					"trend",
				].includes(kind)
					? ({} as Record<string, unknown> & {
							ok?: boolean;
							error?: string;
							hit?: Record<string, unknown>;
							hits?: Record<string, unknown>[];
							items?: { id: string; name: string; tactics?: string[] }[];
							query?: string;
							city?: string;
							regionName?: string;
							country?: string;
							isp?: string;
							as?: string;
							lat?: number;
							lon?: number;
						})
					: ((await api.osint(kind, arg)) as Record<string, unknown> & {
							ok?: boolean;
							error?: string;
							hit?: Record<string, unknown>;
							hits?: Record<string, unknown>[];
							items?: { id: string; name: string; tactics?: string[] }[];
							query?: string;
							city?: string;
							regionName?: string;
							country?: string;
							isp?: string;
							as?: string;
							lat?: number;
							lon?: number;
						});
				if (stop) return;
				if (j.ok === false) {
					setBody(<div>{String(j.error || "no result")}</div>);
					return;
				}
				if (kind === "aircraft")
					setBody(
						j.hit ? (
							<KV
								pairs={Object.entries(j.hit)
									.slice(0, 8)
									.map(
										([k, v]) =>
											[k.toUpperCase(), String(v).slice(0, 120)] as [
												string,
												string,
											],
									)}
							/>
						) : (
							<div>not on watchlist</div>
						),
					);
				else if (kind === "airport") {
					const h = j.hit as
						| {
								name?: string;
								city?: string;
								icao?: string;
								lat?: number;
								lon?: number;
						  }
						| undefined;
					setBody(
						h ? (
							<KV
								pairs={[
									["NAME", h.name ?? ""],
									["CITY", h.city ?? ""],
									["ICAO", h.icao ?? ""],
									["POS", `${h.lat},${h.lon}`],
								]}
							/>
						) : (
							<div>unknown code</div>
						),
					);
				} else if (kind === "vessel")
					setBody(
						<div>
							{((j.hits ?? []) as Record<string, unknown>[]).map((h, i) => (
								<ItemRow key={i}>
									<b>{String(h.name ?? h.mmsi ?? "")}</b>
									<br />
									<span style={{ color: "var(--dim)" }}>
										{String(h.class ?? h.owner ?? h.kind ?? "")}
									</span>
								</ItemRow>
							))}
							{(j.hits as unknown[])?.length === 0 && <div>no match</div>}
						</div>,
					);
				else if (kind === "mitre")
					setBody(
						<div>
							{(
								(j.items ?? []) as {
									id: string;
									name: string;
									tactics?: string[];
								}[]
							).map((t) => (
								<ItemRow key={t.id}>
									<b>{t.id}</b> · {t.name}
									<br />
									<span style={{ color: "var(--dim)" }}>
										{(t.tactics ?? []).join(", ")}
									</span>
								</ItemRow>
							))}
						</div>,
					);
				else if (kind === "btc")
					setBody(
						<KV
							pairs={[
								["ADDR", String(j.address ?? arg).slice(0, 44)],
								["BALANCE", `${j.balance_btc ?? "?"} BTC`],
								["TXS", String(j.tx_count ?? "?")],
							]}
						/>,
					);
				else if (kind === "ip")
					setBody(
						<KV
							pairs={[
								["IP", String(j.query ?? "")],
								[
									"GEO",
									`${j.city ?? ""} ${j.regionName ?? ""} ${j.country ?? ""}`,
								],
								["ISP", String(j.isp ?? "")],
								["AS", String(j.as ?? "")],
								["POS", `${j.lat},${j.lon}`],
							]}
						/>,
					);
				else if (kind === "cert") {
					const c = (await api.osint("cert", arg)) as {
						ok?: boolean;
						error?: string;
						count?: number;
						truncated?: boolean;
						subdomains?: { name: string; expiry: string; issuer: string }[];
					};
					if (stop) return;
					setBody(
						c.ok === false ? (
							<div>{String(c.error || "no result")}</div>
						) : (
							<div>
								<div style={{ color: "var(--dim)" }}>
									{c.count} names{c.truncated ? " (first 200)" : ""}
								</div>
								{(c.subdomains ?? []).slice(0, 60).map((s) => (
									<ItemRow key={s.name}>
										<b>{s.name}</b>
										<br />
										<span style={{ color: "var(--dim)" }}>
											exp {s.expiry} · {s.issuer}
										</span>
									</ItemRow>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "asn") {
					const a = (await api.osint("asn", arg)) as {
						ok?: boolean;
						error?: string;
						as?: string;
						holder?: string;
						announced?: boolean;
						prefixes?: string[];
					} & Record<string, unknown>;
					if (stop) return;
					setBody(
						a.ok === false ? (
							<div>{String(a.error || "no result")}</div>
						) : (
							<div>
								<KV
									pairs={[
										["AS", String(a.as ?? a.query ?? arg)],
										["HOLDER", String(a.holder ?? "?")],
										["ANNOUNCED", String(a.announced ?? "?")],
									]}
								/>
								<div style={{ color: "var(--dim)" }}>PREFIXES</div>
								{(a.prefixes ?? []).slice(0, 30).map((p) => (
									<div key={p}>{p}</div>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "cve") {
					const v = (await api.osint("cve", arg)) as {
						ok?: boolean;
						error?: string;
						total?: number;
						items?: {
							id: string;
							status: string;
							published: string;
							score: number | null;
							severity: string | null;
							summary: string;
						}[];
					};
					if (stop) return;
					setBody(
						v.ok === false ? (
							<div>{String(v.error || "no result")}</div>
						) : (
							<div>
								<div style={{ color: "var(--dim)" }}>{v.total} known</div>
								{(v.items ?? []).map((c) => (
									<ItemRow key={c.id}>
										<b>{c.id}</b>{" "}
										{c.score !== null && (
											<span style={{ color: "var(--amber)" }}>
												{c.score} {c.severity}
											</span>
										)}
										<br />
										<span style={{ color: "var(--dim)" }}>
											{c.published} · {c.summary.slice(0, 140)}
										</span>
									</ItemRow>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "epss") {
					const e = (await api.osint("epss", arg)) as {
						ok?: boolean;
						error?: string;
						cve?: string;
						epss?: string | null;
						percentile?: string | null;
						date?: string | null;
					};
					if (stop) return;
					setBody(
						e.ok === false ? (
							<div>{String(e.error || "no result")}</div>
						) : (
							<div>
								<h3>EPSS · {String(e.cve ?? arg).toUpperCase()}</h3>
								<KV
									pairs={[
										["SCORE", String(e.epss ?? "?")],
										["PERCENTILE", String(e.percentile ?? "?")],
										["DATE", String(e.date ?? "?")],
									]}
								/>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									FIRST.org exploit probability
								</div>
							</div>
						),
					);
					return;
				} else if (kind === "osv") {
					const o = (await api.osint("osv", arg)) as {
						ok?: boolean;
						error?: string;
						id?: string;
						summary?: string;
						severity?: string | null;
						published?: string | null;
						affected?: { package: string; versions: string }[];
						refs?: string[];
					};
					if (stop) return;
					setBody(
						o.ok === false ? (
							<div>{String(o.error || "no result")}</div>
						) : (
							<div>
								<h3>OSV · {String(o.id ?? arg).toUpperCase()}</h3>
								<div style={{ fontSize: 13 }}>{o.summary}</div>
								<KV
									pairs={[
										["SEVERITY", String(o.severity ?? "?")],
										["PUBLISHED", String(o.published ?? "?")],
									]}
								/>
								{(o.affected ?? []).slice(0, 10).map((a, i) => (
									<ItemRow key={i}>
										<b>{a.package}</b>
										<br />
										<span style={{ color: "var(--dim)" }}>
											{a.versions || "versions n/a"}
										</span>
									</ItemRow>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "circl") {
					const c = (await api.osint("circl", arg)) as {
						ok?: boolean;
						error?: string;
						id?: string;
						title?: string | null;
						state?: string | null;
						published?: string | null;
						summary?: string;
					};
					if (stop) return;
					setBody(
						c.ok === false ? (
							<div>{String(c.error || "no result")}</div>
						) : (
							<div>
								<h3>CIRCL · {String(c.id ?? arg).toUpperCase()}</h3>
								<div style={{ fontSize: 13 }}>{c.title ?? ""}</div>
								<KV
									pairs={[
										["STATE", String(c.state ?? "?")],
										["PUBLISHED", String(c.published ?? "?")],
									]}
								/>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									{String(c.summary ?? "").slice(0, 400)}
								</div>
							</div>
						),
					);
					return;
				} else if (
					kind === "doh" ||
					kind === "doh-google" ||
					kind === "doh-cf"
				) {
					const d = (await api.osint(kind, arg)) as {
						ok?: boolean;
						error?: string;
						name?: string;
						type?: string;
						answers?: { name?: string; type?: number; data?: string }[];
					};
					if (stop) return;
					setBody(
						d.ok === false ? (
							<div>{String(d.error || "no result")}</div>
						) : (
							<div>
								<h3>
									{kind.toUpperCase()} · {d.name} {d.type}
								</h3>
								{(d.answers ?? []).map((a, i) => (
									<div key={i}>{String(a.data ?? "")}</div>
								))}
								{!(d.answers ?? []).length && <div>no answers</div>}
							</div>
						),
					);
					return;
				} else if (kind === "ipwhois") {
					const w = (await api.osint("ipwhois", arg)) as {
						ok?: boolean;
						error?: string;
						ip?: string;
						country?: string;
						city?: string;
						isp?: string;
						asn?: string;
						latitude?: number;
						longitude?: number;
					};
					if (stop) return;
					setBody(
						w.ok === false ? (
							<div>{String(w.error || "no result")}</div>
						) : (
							<div>
								<h3>IPWHOIS · {String(w.ip ?? arg)}</h3>
								<KV
									pairs={[
										["GEO", `${w.city ?? ""} ${w.country ?? ""}`.trim()],
										["ISP", String(w.isp ?? "?")],
										["AS", String(w.asn ?? "?")],
										["POS", `${w.latitude},${w.longitude}`],
									]}
								/>
							</div>
						),
					);
					return;
				} else if (kind === "mitre-cve") {
					const mc = (await api.osint("mitre-cve", arg)) as {
						ok?: boolean;
						error?: string;
						id?: string;
						title?: string | null;
						state?: string | null;
						assigner?: string | null;
						published?: string | null;
						summary?: string;
					};
					if (stop) return;
					setBody(
						mc.ok === false ? (
							<div>{String(mc.error || "no result")}</div>
						) : (
							<div>
								<h3>MITRE · {String(mc.id ?? arg).toUpperCase()}</h3>
								<div style={{ fontSize: 13 }}>{mc.title ?? ""}</div>
								<KV
									pairs={[
										["STATE", String(mc.state ?? "?")],
										["ASSIGNER", String(mc.assigner ?? "?")],
										["PUBLISHED", String(mc.published ?? "?")],
									]}
								/>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									{String(mc.summary ?? "").slice(0, 400)}
								</div>
							</div>
						),
					);
					return;
				} else if (kind === "geocode") {
					const gc = (await api.osint("geocode", arg)) as {
						ok?: boolean;
						error?: string;
						label?: string | null;
					};
					if (stop) return;
					setBody(
						gc.ok === false ? (
							<div>{String(gc.error || "no result")}</div>
						) : (
							<div>
								<h3>GEOCODE · {arg}</h3>
								<div style={{ fontSize: 14 }}>{gc.label ?? "unknown"}</div>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									Photon (Komoot) · second opinion next to Nominatim
								</div>
							</div>
						),
					);
					return;
				} else if (kind === "macro-imf") {
					const mi = (await api.osint("macro-imf", arg)) as {
						ok?: boolean;
						error?: string;
						country?: string;
						items?: { key: string; date: string; value: number | null }[];
					};
					if (stop) return;
					setBody(
						mi.ok === false ? (
							<div>{String(mi.error || "no result")}</div>
						) : (
							<div>
								<h3>MACRO-IMF · {String(mi.country ?? arg).toUpperCase()}</h3>
								<KV
									pairs={(mi.items ?? []).map((i) => [
										`${i.key} · ${i.date}`,
										i.value === null
											? "?"
											: Number(i.value).toLocaleString("en-US"),
									])}
								/>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									IMF DataMapper · latest available
								</div>
							</div>
						),
					);
					return;
				} else if (kind === "ports") {
					const ps = (await api.osint("ports", arg)) as {
						ok?: boolean;
						error?: string;
						ip?: string;
						ports?: number[];
						hostnames?: string[];
						vulns?: string[];
					};
					if (stop) return;
					setBody(
						ps.ok === false ? (
							<div>{String(ps.error || "no result")}</div>
						) : (
							<div>
								<h3>PORTS · {String(ps.ip ?? arg)}</h3>
								<KV
									pairs={[
										["OPEN", (ps.ports ?? []).join(", ") || "none seen"],
										["VULNS", String((ps.vulns ?? []).length)],
									]}
								/>
								{(ps.hostnames ?? []).slice(0, 10).map((h) => (
									<div key={h} style={{ color: "var(--dim)" }}>
										{h}
									</div>
								))}
								{(ps.vulns ?? []).slice(0, 10).map((v) => (
									<ItemRow key={v}>
										<b>{v}</b>
									</ItemRow>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "robtex") {
					const rx = (await api.osint("robtex", arg)) as {
						ok?: boolean;
						error?: string;
						ip?: string;
						asn?: number | null;
						asname?: string | null;
						whois?: string | null;
						route?: string | null;
						geo?: string | null;
						hosts?: string[];
						hostCount?: number;
					};
					if (stop) return;
					setBody(
						rx.ok === false ? (
							<div>{String(rx.error || "no result")}</div>
						) : (
							<div>
								<h3>ROBTEX · {String(rx.ip ?? arg)}</h3>
								<KV
									pairs={[
										["AS", `AS${rx.asn ?? "?"} ${rx.asname ?? ""}`.trim()],
										["ROUTE", String(rx.route ?? "?")],
										["GEO", String(rx.geo ?? "?")],
										["HOSTS", String(rx.hostCount ?? 0)],
									]}
								/>
								{(rx.hosts ?? []).slice(0, 15).map((h) => (
									<div key={h} style={{ color: "var(--dim)" }}>
										{h}
									</div>
								))}
							</div>
						),
					);
					return;
				} else if (kind === "fdic") {
					const fd = (await api.osint("fdic", arg)) as {
						ok?: boolean;
						error?: string;
						total?: number;
						banks?: { CERT?: number; NAME?: string; ACTIVE?: number }[];
					};
					if (stop) return;
					setBody(
						fd.ok === false ? (
							<div>{String(fd.error || "no result")}</div>
						) : (
							<div>
								<h3>
									FDIC · {arg} ({fd.total ?? 0})
								</h3>
								{(fd.banks ?? []).map((b) => (
									<ItemRow key={String(b.CERT)}>
										<b>{b.NAME}</b>{" "}
										<span style={{ color: "var(--dim)" }}>
											CERT {b.CERT} · {b.ACTIVE ? "active" : "inactive"}
										</span>
									</ItemRow>
								))}
								{!(fd.banks ?? []).length && <div>no bank match</div>}
							</div>
						),
					);
					return;
				} else if (kind === "token") {
					const tk = (await api.osint("token", arg)) as {
						ok?: boolean;
						error?: string;
						pairs?: {
							chain?: string;
							dex?: string;
							symbol?: string;
							priceUsd?: string;
							liquidityUsd?: number | null;
						}[];
					};
					if (stop) return;
					setBody(
						tk.ok === false ? (
							<div>{String(tk.error || "no result")}</div>
						) : (
							<div>
								<h3>TOKEN · {arg.slice(0, 20)}…</h3>
								{(tk.pairs ?? []).map((p, i) => (
									<ItemRow key={i}>
										<b>
											{p.symbol} · {p.chain}/{p.dex}
										</b>{" "}
										<span style={{ color: "var(--dim)" }}>
											${p.priceUsd} · liq $
											{(p.liquidityUsd ?? 0).toLocaleString()}
										</span>
									</ItemRow>
								))}
								{!(tk.pairs ?? []).length && <div>no DEX pairs</div>}
							</div>
						),
					);
					return;
				} else if (
					kind === "wikidata" ||
					kind === "wiki" ||
					kind === "books" ||
					kind === "stack" ||
					kind === "nominatim" ||
					kind === "omgeo" ||
					kind === "maltiverse" ||
					kind === "urlscan" ||
					kind === "crfunder" ||
					kind === "food" ||
					kind === "music" ||
					kind === "maltsearch" ||
					kind === "fda-drug" ||
					kind === "gene" ||
					kind === "ontology" ||
					kind === "protein" ||
					kind === "package" ||
					kind === "daylight" ||
					kind === "zip" ||
					kind === "transit" ||
					kind === "name" ||
					kind === "funder" ||
					kind === "museum" ||
					kind === "rxnorm" ||
					kind === "chembl" ||
					kind === "sbdb" ||
					kind === "deps" ||
					kind === "nasa-img" ||
					kind === "planespotter" ||
					kind === "dailymed" ||
					kind === "holidays" ||
					kind === "npm-dl"
				) {
					const wj = (await api.osint(kind, arg)) as {
						ok?: boolean;
						error?: string;
						items?: Record<string, unknown>[];
						title?: string;
						extract?: string;
						url?: string | null;
					};
					if (stop) return;
					setBody(
						wj.ok === false ? (
							<div>{String(wj.error || "no result")}</div>
						) : (
							<div>
								<h3>
									{kind.toUpperCase()} · {arg}
								</h3>
								{wj.title && (
									<div style={{ fontSize: 14 }}>
										<b>{wj.title}</b>
									</div>
								)}
								{wj.extract && (
									<div style={{ color: "var(--dim)", fontSize: 12 }}>
										{String(wj.extract).slice(0, 400)}
									</div>
								)}
								{(wj.items ?? []).slice(0, 8).map((x, i) => (
									<div key={i} style={{ fontSize: 13 }}>
										<b>
											{String(x.label ?? x.title ?? x.name ?? x.qid ?? "?")}
										</b>{" "}
										<span style={{ color: "var(--dim)" }}>
											{String(
												x.desc ?? x.description ?? x.author ?? x.type ?? "",
											).slice(0, 120)}
										</span>
									</div>
								))}
								{wj.url && (
									<div style={{ fontSize: 12 }}>
										<a href={String(wj.url)} target="_blank" rel="noreferrer">
											open ↗
										</a>
									</div>
								)}
							</div>
						),
					);
					return;
				} else if (kind === "ghsa") {
					const gh = (await api.osint("ghsa", arg)) as {
						ok?: boolean;
						error?: string;
						q?: string;
						items?: {
							ghsa?: string;
							cve?: string | null;
							severity?: string;
							published?: string;
							summary?: string;
						}[];
					};
					if (stop) return;
					setBody(
						gh.ok === false ? (
							<div>{String(gh.error || "no result")}</div>
						) : (
							<div>
								{(gh.items ?? []).map((a) => (
									<ItemRow key={a.ghsa ?? a.cve ?? a.summary}>
										<b>{a.cve ?? a.ghsa}</b>{" "}
										<span style={{ color: "var(--amber)" }}>{a.severity}</span>
										<br />
										<span style={{ color: "var(--dim)" }}>
											{a.published} · {String(a.summary ?? "").slice(0, 140)}
										</span>
									</ItemRow>
								))}
								{!(gh.items ?? []).length && <div>no advisory match</div>}
							</div>
						),
					);
					return;
				} else if (kind === "ror") {
					const ro = (await api.osint("ror", arg)) as {
						ok?: boolean;
						error?: string;
						items?: {
							ror?: string;
							name?: string;
							established?: number | null;
							country?: string | null;
							wikidata?: string | null;
							website?: string | null;
						}[];
					};
					if (stop) return;
					setBody(
						ro.ok === false ? (
							<div>{String(ro.error || "no result")}</div>
						) : (
							<div>
								{(ro.items ?? []).map((o) => (
									<ItemRow key={o.ror ?? o.name}>
										<b>{o.name}</b> · {o.country ?? "?"}
										<br />
										<span style={{ color: "var(--dim)" }}>
											{o.ror} · est {o.established ?? "?"} · {o.website ?? ""}
										</span>
									</ItemRow>
								))}
								{!(ro.items ?? []).length && <div>no ROR match</div>}
							</div>
						),
					);
					return;
				} else if (kind === "company") {
					const c = (await api.osint("company", arg)) as {
						ok?: boolean;
						error?: string;
						items?: {
							lei: string;
							name: string;
							country: string;
							city: string;
							jurisdiction: string;
							status: string;
							regStatus: string;
						}[];
					};
					if (stop) return;
					setBody(
						c.ok === false ? (
							<div>{String(c.error || "no result")}</div>
						) : (
							<div>
								{(c.items ?? []).map((m) => (
									<ItemRow key={m.lei}>
										<b>{m.name}</b> · {m.country}
										<br />
										<span style={{ color: "var(--dim)" }}>
											LEI {m.lei} · {m.jurisdiction} · {m.status}/{m.regStatus}
										</span>
									</ItemRow>
								))}
								{!(c.items ?? []).length && <div>no LEI match</div>}
							</div>
						),
					);
					return;
				} else if (kind === "macro") {
					const m = (await api.osint("macro", arg)) as {
						ok?: boolean;
						error?: string;
						country?: string;
						items?: { key: string; date: string; value: number | null }[];
					};
					if (stop) return;
					setBody(
						m.ok === false ? (
							<div>{String(m.error || "no result")}</div>
						) : (
							<div>
								<h3>MACRO · {String(m.country ?? arg).toUpperCase()}</h3>
								<KV
									pairs={(m.items ?? []).map((i) => [
										`${i.key} · ${i.date}`,
										i.value === null
											? "?"
											: Number(i.value).toLocaleString("en-US"),
									])}
								/>
								<div style={{ color: "var(--dim)", fontSize: 12 }}>
									World Bank · latest available
								</div>
							</div>
						),
					);
					return;
				} else if (kind === "sitrep") {
					const s = (await api.sitrep(arg.trim().toLowerCase() === "save")) as {
						ok?: boolean;
						day?: string | null;
						md?: string;
					};
					if (stop) return;
					setBody(
						<div>
							<div style={{ color: "var(--dim)" }}>
								{s.day ? `archived ${s.day}` : "no archive yet"}
							</div>
							<pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
								{String(s.md ?? "empty").slice(0, 4000)}
							</pre>
						</div>,
					);
					return;
				} else if (kind === "trend") {
					const [tl, td] = arg.split(/\s+/);
					const tlayer =
						LAYER_NAMES.find((l) => l.startsWith((tl || "").toLowerCase())) ??
						"";
					const tdays = Math.min(
						Math.max(parseInt(td ?? "14", 10) || 14, 1),
						90,
					);
					if (!tlayer) {
						setBody(<div>usage: trend {"<layer>"} [days]</div>);
						return;
					}
					const t = await api.trend(tlayer, tdays);
					if (stop) return;
					const rows = t.series;
					const max = Math.max(1, ...rows.map((r) => Number(r.n)));
					const W = 300;
					const H = 90;
					const bw = W / Math.max(1, rows.length);
					setBody(
						<div>
							<div style={{ color: "var(--dim)" }}>
								{tlayer} · {rows.length}d since {t.depth_days ?? "—"}
							</div>
							<svg width={W} height={H} role="img">
								<title>{tlayer} daily counts</title>
								{rows.map((r, i) => {
									const h = Math.max(2, (Number(r.n) / max) * (H - 14));
									return (
										<g key={r.day}>
											<title>
												{r.day}: {r.n}
											</title>
											<rect
												x={i * bw + 1}
												y={H - h}
												width={Math.max(1, bw - 2)}
												height={h}
												fill="var(--accent)"
												opacity="0.85"
											/>
										</g>
									);
								})}
							</svg>
							{t.sitreps.length > 0 && (
								<div style={{ color: "var(--dim)" }}>
									sitrep:{" "}
									{t.sitreps
										.slice(0, 5)
										.map(
											(s) => `${s.day} C${s.critical_count}/W${s.watch_count}`,
										)
										.join(" · ")}
								</div>
							)}
						</div>,
					);
					return;
				} else if (kind === "search") {
					const s = await api.search(arg);
					if (stop) return;
					setBody(
						<div>
							<div style={{ color: "var(--dim)" }}>{s.count} hits</div>
							{s.items.slice(0, 40).map((r) => (
								<ItemRow key={r.id}>
									<b>{r.layer}</b> · {r.title}
									<br />
									<span style={{ color: "var(--dim)" }}>
										{r.source} · {String(r.ts).slice(0, 16)}
									</span>
								</ItemRow>
							))}
						</div>,
					);
					return;
				} else if (kind === "watch") {
					const [sub, ...rest] = arg.split(/\s+/);
					const restArg = rest.join(" ");
					let note = "";
					if ((sub || "").toLowerCase() === "add") {
						const [k, ...v] = restArg.split(/\s+/);
						if (
							["keyword", "layer", "severity"].includes(
								(k ?? "").toLowerCase(),
							) &&
							v.length
						) {
							const r = await api.watchAdd(k.toLowerCase(), v.join(" "));
							note = r.ok ? `added ${r.id}` : `failed: ${r.error}`;
						} else note = "usage: watch add keyword|layer|severity <value>";
					} else if ((sub || "").toLowerCase() === "del" && restArg) {
						await api.watchDel(
							restArg.startsWith("w:")
								? restArg
								: `w:keyword:${restArg.toLowerCase()}`,
						);
						note = `deleted ${restArg}`;
					}
					const [wl, wm] = await Promise.all([
						api.watchList(),
						api.watchMatches(),
					]);
					if (stop) return;
					setBody(
						<div>
							{note && <div style={{ color: "var(--grn)" }}>{note}</div>}
							<div style={{ color: "var(--dim)" }}>
								WATCHES ({wl.items.length})
							</div>
							{wl.items.map((w) => (
								<div key={w.id}>
									{w.kind}:{w.value}
								</div>
							))}
							<div style={{ color: "var(--dim)" }}>MATCHES ({wm.count})</div>
							{wm.items.slice(0, 30).map((r) => (
								<ItemRow key={r.id}>
									<b>{r.layer}</b> · {r.title}
								</ItemRow>
							))}
						</div>,
					);
					return;
				}
			} catch {
				if (!stop) setBody(<div>lookup failed</div>);
			}
		})();
		return () => {
			stop = true;
		};
	}, [kind, arg]);
	return (
		<>
			<h3>
				{kind.toUpperCase()} · {arg}
			</h3>
			{body}
		</>
	);
}

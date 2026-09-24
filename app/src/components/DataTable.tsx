"use client";
// DataTable: the one tabular primitive (docs/UI_PRIMITIVES.md §2).
// Sticky header, sortable columns (header buttons with aria-sort), numeric
// columns right-aligned in the mono voice, optional expandable rows. Rows
// stay real <tr>s so the table reads correctly to assistive tech; on
// compact panels the wrapper scrolls horizontally.
import { Fragment, type ReactNode, useMemo, useState } from "react";

export type Column<T> = {
	key: string;
	label: string;
	/** numbers/durations: right-aligned, tabular mono */
	num?: boolean;
	/** sort value; omit to make the column unsortable */
	sort?: (r: T) => number | string | null;
	render: (r: T) => ReactNode;
	title?: string;
	/** hide below this container width class (compact tables) */
	wide?: boolean;
};

export function DataTable<T>({
	rows,
	cols,
	rowKey,
	rowClass,
	rowTitle,
	initialSort,
	expanded,
	onRowClick,
	renderExpanded,
	empty,
	label,
}: {
	rows: T[];
	cols: Column<T>[];
	rowKey: (r: T) => string;
	rowClass?: (r: T) => string;
	rowTitle?: (r: T) => string | undefined;
	initialSort?: { key: string; dir: "asc" | "desc" };
	expanded?: string | null;
	onRowClick?: (r: T) => void;
	renderExpanded?: (r: T) => ReactNode;
	empty?: ReactNode;
	label: string;
}) {
	const [sort, setSort] = useState(initialSort ?? null);
	const sorted = useMemo(() => {
		if (!sort) return rows;
		const col = cols.find((c) => c.key === sort.key);
		if (!col?.sort) return rows;
		const f = col.sort;
		const dir = sort.dir === "asc" ? 1 : -1;
		return [...rows].sort((a, b) => {
			const x = f(a);
			const y = f(b);
			// Missing values always sink, whatever the direction.
			if (x == null && y == null) return 0;
			if (x == null) return 1;
			if (y == null) return -1;
			return (x < y ? -1 : x > y ? 1 : 0) * dir;
		});
	}, [rows, cols, sort]);

	if (!rows.length)
		return <div className="dim dt-empty">{empty ?? "No rows."}</div>;
	return (
		<div className="dt-wrap">
			<table className="dt" aria-label={label}>
				<thead>
					<tr>
						{cols.map((c) => {
							const active = sort?.key === c.key;
							const aria = active
								? sort?.dir === "asc"
									? "ascending"
									: "descending"
								: "none";
							return (
								<th
									key={c.key}
									scope="col"
									className={`${c.num ? "num" : ""}${c.wide ? " wide" : ""}`}
									aria-sort={c.sort ? aria : undefined}
									title={c.title}
								>
									{c.sort ? (
										<button
											type="button"
											className={`dt-sort${c.num ? " rev" : ""}${active ? " on" : ""}`}
											onClick={() =>
												setSort((s) =>
													s?.key === c.key
														? {
																key: c.key,
																dir: s.dir === "asc" ? "desc" : "asc",
															}
														: { key: c.key, dir: c.num ? "desc" : "asc" },
												)
											}
										>
											{c.label}
											<span className="dt-arrow" aria-hidden="true">
												{active ? (sort?.dir === "asc" ? "↑" : "↓") : ""}
											</span>
										</button>
									) : (
										c.label
									)}
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{sorted.map((r) => {
						const k = rowKey(r);
						const open = expanded === k;
						return (
							<Fragment key={k}>
								<tr
									className={`${rowClass?.(r) ?? ""}${open ? " open" : ""}${onRowClick ? " click" : ""}`}
									title={rowTitle?.(r)}
									aria-expanded={renderExpanded ? open : undefined}
									tabIndex={onRowClick ? 0 : undefined}
									onClick={() => onRowClick?.(r)}
									onKeyDown={(e) => {
										if (onRowClick && (e.key === "Enter" || e.key === " ")) {
											e.preventDefault();
											onRowClick(r);
										}
									}}
								>
									{cols.map((c) => (
										<td
											key={c.key}
											className={`${c.num ? "num" : ""}${c.wide ? " wide" : ""}`}
										>
											{c.render(r)}
										</td>
									))}
								</tr>
								{open && renderExpanded && (
									<tr className="dt-detail">
										<td colSpan={cols.length}>{renderExpanded(r)}</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

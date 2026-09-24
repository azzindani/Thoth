// @vitest-environment jsdom
// Render tests: pure components without a map instance. Closes the last test gap.
import "@testing-library/jest-dom/vitest";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api", () => ({
	api: {
		brief: async () => ({
			critical: [{ id: "c1", title: "Test critical" }],
		}),
		dossier: async () => ({
			counts: [{ layer: "quakes", count: "3" }],
			items: [
				{ id: "self-1", layer: "fires", title: "Self" },
				{ id: "q-1", layer: "quakes", title: "Nearby quake" },
			],
		}),
	},
	esc: (s: unknown) => String(s ?? ""),
}));

import CmdBar from "../src/components/CmdBar";
import EntityGraph from "../src/components/EntityGraph";
import { Nearby } from "../src/components/Inspector";
import ThreatClock from "../src/components/ThreatClock";
import { Badge, Glyph, KV } from "../src/lib/ui";

afterEach(cleanup);

describe("ui primitives", () => {
	it("Glyph returns null for unknown layer", () => {
		const { container } = render(<Glyph layer="nope" />);
		expect(container.firstChild).toBeNull();
	});
	it("Glyph renders svg for known layer", () => {
		const { container } = render(<Glyph layer="quakes" />);
		expect(container.querySelector("svg")).toBeInTheDocument();
	});
	it("Badge shows text", () => {
		render(<Badge text="HI" kind="info" />);
		expect(screen.getByText("HI")).toBeInTheDocument();
	});
	it("KV renders pairs", () => {
		render(<KV pairs={[["A", "1"]]} />);
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("1")).toBeInTheDocument();
	});
});

describe("ThreatClock", () => {
	it("shows DEFCON number from live brief", async () => {
		const { container } = render(<ThreatClock />);
		const txt = await screen.findByText("DEFCON 4", undefined, {
			timeout: 5000,
		});
		expect(txt).toBeInTheDocument();
		// meter: DEFCON 4 lights two of five cells
		const cells = container.querySelectorAll(".tc-meter i");
		expect(cells).toHaveLength(5);
		expect(
			[...cells].filter((c) => (c as HTMLElement).style.background),
		).toHaveLength(2);
	});
});

describe("EntityGraph", () => {
	it("renders empty state with no map", async () => {
		const onClose = vi.fn();
		render(
			<EntityGraph
				getMap={() => null}
				sel={null}
				onSelect={() => {}}
				onClose={onClose}
			/>,
		);
		expect(screen.getByText("Entity graph")).toBeInTheDocument();
		await act(async () => {
			screen.getByText("CLOSE").click();
		});
		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe("Nearby", () => {
	it("lists proximal other-layer items, self excluded", async () => {
		render(<Nearby lat={34} lon={-118} selfId="self-1" />);
		await screen.findByText("Nearby · 100 km", undefined, { timeout: 5000 });
		expect(screen.getByText("quakes 3")).toBeInTheDocument();
		expect(document.body.textContent).toContain("Nearby quake");
		expect(document.body.textContent).not.toContain("Self");
	});
	it("renders nothing without coordinates", () => {
		const { container } = render(
			<Nearby lat={Number.NaN} lon={Number.NaN} selfId="x" />,
		);
		expect(container.textContent).toContain("nearby…");
	});
});

describe("CmdBar", () => {
	function setup() {
		const handlers = {
			onLayer: vi.fn(),
			onMode: vi.fn(),
			onDossier: vi.fn(),
			onSdn: vi.fn(),
			onAlerts: vi.fn(),
			onOsint: vi.fn(),
			onChangelog: vi.fn(),
			onFocus: vi.fn(),
			onTab: vi.fn(),
		};
		render(<CmdBar {...handlers} />);
		return handlers;
	}
	async function type(cmd: string) {
		const input = document.querySelector("#cmd") as HTMLInputElement;
		await act(async () => {
			fireEvent.change(input, { target: { value: cmd } });
		});
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});
	}
	it("help prints grammar", async () => {
		setup();
		await type("help");
		expect(document.body.textContent).toContain("dossier");
	});
	it("unknown command suggests help", async () => {
		setup();
		await type("frobnicate");
		expect(document.body.textContent).toContain("try help");
	});
	it("routes cert to osint channel", async () => {
		const h = setup();
		await type("cert example.com");
		expect(h.onOsint).toHaveBeenCalledWith("cert", "example.com");
	});
	it("routes pulse|portfolio|screen|notes to tab channel", async () => {
		const h = setup();
		await type("pulse");
		expect(h.onTab).toHaveBeenCalledWith("pulse");
		await type("portfolio");
		expect(h.onTab).toHaveBeenCalledWith("portfolio");
		await type("screen");
		expect(h.onTab).toHaveBeenCalledWith("screen");
		await type("notes");
		expect(h.onTab).toHaveBeenCalledWith("notes");
	});
	it("routes monitor|health|feeds to monitor tab", async () => {
		const h = setup();
		await type("monitor");
		expect(h.onTab).toHaveBeenCalledWith("monitor");
		await type("health");
		expect(h.onTab).toHaveBeenCalledWith("monitor");
		await type("feeds");
		expect(h.onTab).toHaveBeenCalledWith("monitor");
	});
	it("routes cve + sitrep + search", async () => {
		const h = setup();
		await type("cve CVE-2024-3094");
		expect(h.onOsint).toHaveBeenCalledWith("cve", "CVE-2024-3094");
		await type("sitrep");
		expect(h.onOsint).toHaveBeenCalledWith("sitrep", "show");
		await type("search reactor");
		expect(h.onOsint).toHaveBeenCalledWith("search", "reactor");
		await type("trend quakes 7");
		expect(h.onOsint).toHaveBeenCalledWith("trend", "quakes 7");
	});
});

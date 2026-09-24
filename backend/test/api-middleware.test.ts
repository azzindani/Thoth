// API hardening tests — middleware + app wiring, in-process on an ephemeral
// port. No network, no DB rows needed (the pool never connects for these).
// Run: npm run test:unit

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createApp, trustProxyValue } from "../src/api/app.js";
import {
	cors,
	errorHandler,
	rateLimit,
	requireWriteKey,
} from "../src/api/middleware.js";
import { parseKnown } from "../src/api/stream.js";
import { closePool } from "../src/db/client.js";

type Srv = { url: string; close: () => Promise<void> };

async function serve(app: express.Express): Promise<Srv> {
	const s = app.listen(0);
	await new Promise((r) => s.once("listening", r));
	const { port } = s.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((r) => s.close(() => r())),
	};
}

function mini(...mw: express.RequestHandler[]): express.Express {
	const app = express();
	app.set("trust proxy", "loopback");
	for (const m of mw) app.use(m);
	app.all("/{*any}", (req, res) => {
		res.json({ ok: true, ip: req.ip });
	});
	app.use(errorHandler);
	return app;
}

after(() => closePool());

describe("requireWriteKey", () => {
	let srv: Srv;
	before(async () => {
		srv = await serve(mini(requireWriteKey("s3cret-key")));
	});
	after(() => srv.close());

	it("lets reads through without a key", async () => {
		assert.equal((await fetch(`${srv.url}/x`)).status, 200);
	});
	it("rejects writes without a key (401 + WWW-Authenticate)", async () => {
		const r = await fetch(`${srv.url}/x`, { method: "POST" });
		assert.equal(r.status, 401);
		assert.match(r.headers.get("www-authenticate") ?? "", /Bearer/);
	});
	it("rejects a wrong key, including a same-prefix one", async () => {
		for (const k of ["nope", "s3cret-key-longer", "s3cret-kez"]) {
			const r = await fetch(`${srv.url}/x`, {
				method: "DELETE",
				headers: { "X-Thoth-Key": k },
			});
			assert.equal(r.status, 401, k);
		}
	});
	it("accepts Bearer and X-Thoth-Key", async () => {
		const a = await fetch(`${srv.url}/x`, {
			method: "POST",
			headers: { Authorization: "Bearer s3cret-key" },
		});
		const b = await fetch(`${srv.url}/x`, {
			method: "POST",
			headers: { "X-Thoth-Key": "s3cret-key" },
		});
		assert.equal(a.status, 200);
		assert.equal(b.status, 200);
	});
	it("is open in dev when no key is configured", async () => {
		const open = await serve(mini(requireWriteKey("")));
		try {
			const r = await fetch(`${open.url}/x`, { method: "POST" });
			assert.equal(r.status, 200);
		} finally {
			await open.close();
		}
	});
});

describe("rateLimit", () => {
	it("429s past the budget with Retry-After, exempts /stream", async () => {
		const srv = await serve(mini(rateLimit(2)));
		try {
			assert.equal((await fetch(`${srv.url}/a`)).status, 200);
			const second = await fetch(`${srv.url}/a`);
			assert.equal(second.headers.get("ratelimit-remaining"), "0");
			const third = await fetch(`${srv.url}/a`);
			assert.equal(third.status, 429);
			assert.ok(Number(third.headers.get("retry-after")) > 0);
			assert.equal((await fetch(`${srv.url}/stream`)).status, 200);
		} finally {
			await srv.close();
		}
	});
	it("keys on the forwarded client IP behind a trusted proxy", async () => {
		const srv = await serve(mini(rateLimit(1)));
		try {
			const as = (ip: string) =>
				fetch(`${srv.url}/a`, { headers: { "X-Forwarded-For": ip } });
			assert.equal((await as("203.0.113.1")).status, 200);
			// A different client behind the same proxy has its own bucket.
			const other = await as("203.0.113.2");
			assert.equal(other.status, 200);
			assert.equal((await other.json()).ip, "203.0.113.2");
			assert.equal((await as("203.0.113.1")).status, 429);
		} finally {
			await srv.close();
		}
	});
});

describe("cors", () => {
	it("echoes only allowlisted origins", async () => {
		const srv = await serve(mini(cors("https://a.example, https://b.example")));
		try {
			const ok = await fetch(`${srv.url}/x`, {
				headers: { Origin: "https://b.example" },
			});
			assert.equal(
				ok.headers.get("access-control-allow-origin"),
				"https://b.example",
			);
			const no = await fetch(`${srv.url}/x`, {
				headers: { Origin: "https://evil.example" },
			});
			assert.equal(no.headers.get("access-control-allow-origin"), null);
			const pre = await fetch(`${srv.url}/x`, { method: "OPTIONS" });
			assert.equal(pre.status, 204);
		} finally {
			await srv.close();
		}
	});
});

describe("createApp wiring", () => {
	let srv: Srv;
	before(async () => {
		srv = await serve(createApp());
	});
	after(() => srv.close());

	it("answers unknown /api paths with JSON 404", async () => {
		const r = await fetch(`${srv.url}/api/definitely-not-a-route`);
		assert.equal(r.status, 404);
		const j = (await r.json()) as { ok: boolean; error: string };
		assert.equal(j.ok, false);
		assert.match(j.error, /\/api\/definitely-not-a-route/);
	});
	it("maps malformed JSON bodies to 400 with a request id", async () => {
		const r = await fetch(`${srv.url}/api/notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{not json",
		});
		assert.equal(r.status, 400);
		const j = (await r.json()) as { error: string; request_id: string };
		assert.equal(j.error, "malformed JSON body");
		assert.equal(j.request_id, r.headers.get("x-request-id"));
	});
	it("sets security headers and hides the framework", async () => {
		const r = await fetch(`${srv.url}/api/livez`);
		assert.equal(r.status, 200);
		assert.equal(r.headers.get("x-content-type-options"), "nosniff");
		assert.equal(r.headers.get("x-frame-options"), "DENY");
		assert.match(r.headers.get("content-security-policy") ?? "", /'none'/);
		assert.equal(r.headers.get("x-powered-by"), null);
	});
	it("propagates a sane inbound X-Request-Id, replaces a hostile one", async () => {
		const good = await fetch(`${srv.url}/api/livez`, {
			headers: { "X-Request-Id": "trace-123" },
		});
		assert.equal(good.headers.get("x-request-id"), "trace-123");
		const hostile = `<script>${"a".repeat(80)}`;
		const bad = await fetch(`${srv.url}/api/livez`, {
			headers: { "X-Request-Id": hostile },
		});
		const echoed = bad.headers.get("x-request-id") ?? "";
		assert.notEqual(echoed, hostile);
		assert.match(echoed, /^[0-9a-f-]{36}$/);
	});
});

describe("trustProxyValue", () => {
	it("parses booleans, hop counts and subnet lists", () => {
		assert.equal(trustProxyValue("true"), true);
		assert.equal(trustProxyValue("false"), false);
		assert.equal(trustProxyValue(""), false);
		assert.equal(trustProxyValue("2"), 2);
		assert.equal(
			trustProxyValue("loopback, uniquelocal"),
			"loopback, uniquelocal",
		);
	});
});

describe("parseKnown (SSE resume state)", () => {
	it("accepts raw JSON and base64 JSON, stringifies versions", () => {
		const b64 = Buffer.from(JSON.stringify({ quakes: 7 })).toString("base64");
		assert.deepEqual(parseKnown(b64), { quakes: "7" });
		assert.deepEqual(parseKnown('{"fires":"3"}'), { fires: "3" });
	});
	it("drops garbage instead of throwing", () => {
		assert.deepEqual(parseKnown(undefined), {});
		assert.deepEqual(parseKnown("%%%"), {});
		assert.deepEqual(parseKnown("[1,2]"), {});
		assert.deepEqual(parseKnown('{"a":{"nested":1}}'), {});
	});
});

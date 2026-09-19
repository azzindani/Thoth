import { inflateRawSync } from "node:zlib";

// Minimal ZIP reader for one-time build scripts: fetch a .zip into a Buffer,
// extract one entry by exact (or suffix) name. Stored + deflated only.
// Keeps builders dependency-free (no unzip binary, no npm package).
export function unzipEntry(buf: Buffer, name: string): string {
	const EOCD = 0x06054b50;
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i--) {
		if (buf.readUInt32LE(i) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("EOCD not found (not a zip?)");
	const count = buf.readUInt16LE(eocd + 10);
	let off = buf.readUInt32LE(eocd + 16);
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(off) !== 0x02014b50)
			throw new Error(`bad central entry ${n}`);
		const method = buf.readUInt16LE(off + 10);
		const csize = buf.readUInt32LE(off + 20);
		const fnLen = buf.readUInt16LE(off + 28);
		const efLen = buf.readUInt16LE(off + 30);
		const fcLen = buf.readUInt16LE(off + 32);
		const lho = buf.readUInt32LE(off + 42);
		const fname = buf.toString("utf8", off + 46, off + 46 + fnLen);
		off += 46 + fnLen + efLen + fcLen;
		if (fname !== name && !fname.endsWith(name)) continue;
		if (buf.readUInt32LE(lho) !== 0x04034b50)
			throw new Error(`bad local header for ${fname}`);
		const lhFn = buf.readUInt16LE(lho + 26);
		const lhEf = buf.readUInt16LE(lho + 28);
		const start = lho + 30 + lhFn + lhEf;
		const raw = buf.subarray(start, start + csize);
		if (method === 0) return raw.toString("utf8");
		if (method === 8) return inflateRawSync(raw).toString("utf8");
		throw new Error(`unsupported method ${method} for ${fname}`);
	}
	throw new Error(`entry not found: ${name}`);
}

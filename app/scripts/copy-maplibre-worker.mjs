// maplibre-gl 6 is ESM-only and loads its web worker from a separate file.
// Bundlers cannot resolve it from import.meta.url, so we self-host the worker
// (and the shared chunk it imports) under public/maplibre/ and point
// setWorkerUrl() at it (src/lib/maplibre.ts). Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";

const SRC = new URL("../node_modules/maplibre-gl/dist/", import.meta.url);
const DEST = new URL("../public/maplibre/", import.meta.url);
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(DEST, { recursive: true });
for (const f of FILES) copyFileSync(new URL(f, SRC), new URL(f, DEST));
console.log(`maplibre worker → public/maplibre (${FILES.join(", ")})`);

import * as maplibregl from "maplibre-gl";

// Single entry point for maplibre in the app. v6 needs the worker URL set
// once before the first Map is constructed when bundled; the file is copied
// to public/maplibre/ by scripts/copy-maplibre-worker.mjs.
export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

export default maplibregl;

#!/bin/sh
# Thoth app restart: build, stop the old server, start detached, verify.
# Bracket patterns ([n]ext-server) never match this shell's own command line
# (plain `pkill -f "npm start"` once killed the invoking shell itself).
# Lesson 2026-09-13: never serve a stale build over a fresh .next —
# chunk 500s freeze the UI at SSR text with zero backend errors.
set -e
cd "$(dirname "$0")"
npm run build
pkill -f "[n]ext-server" 2>/dev/null || true
sleep 3
setsid nohup npm start >>restart-3000.log 2>&1 < /dev/null &
sleep 12
curl -sf -m 8 -o /dev/null http://localhost:3000/ || {
	echo "restart: root not answering"
	exit 1
}
CHUNK=$(curl -s -m 8 http://localhost:3000/ | grep -o 'chunks/[a-z0-9]*\.js' | head -1)
curl -sf -m 8 -o /dev/null "http://localhost:3000/_next/static/$CHUNK" || {
	echo "restart: chunk $CHUNK not servable — stale build, investigate"
	exit 1
}
echo "app: up, chunk $CHUNK servable"

#!/bin/sh
# Thoth backend restart: stop api + worker, start both detached, verify.
# Bracket patterns ([t]sx ...) never match this shell's own command line.
# API must run with REQUESTS_PER_MIN=2000 (CI value) — the 120 default 429s
# the app's own page loads and the live test suite (seen 2026-09-13).
set -e
cd "$(dirname "$0")"
pkill -f "[t]sx src/api/server" 2>/dev/null || true
pkill -f "[t]sx src/workers/run" 2>/dev/null || true
sleep 3
setsid nohup env REQUESTS_PER_MIN=2000 npm exec tsx src/api/server.ts >>api.log 2>&1 < /dev/null &
setsid nohup npm run dev:worker >>worker.log 2>&1 < /dev/null &
sleep 10
curl -sf -m 8 -o /dev/null http://localhost:4000/api/stats || {
	echo "restart: api not answering"
	exit 1
}
echo "backend: api + worker restarted"

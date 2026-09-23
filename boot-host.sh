#!/bin/sh
# Thoth host boot: compose stack + verification + public tunnel link.
# Run ON THE HOST (not the lab sandbox) from the repo root containing
# backend/docker-compose.yml:
#
#   export POSTGRES_PASSWORD=$(openssl rand -hex 32)
#   export API_WRITE_KEY=$(openssl rand -hex 32)
#   export APP_BASIC_AUTH="ops:$(openssl rand -hex 12)"   # the tunnel is public
#   sh boot-host.sh
#
# Prints a https://<name>.trycloudflare.com link at the end. Tunnel is
# temporary by nature — see docs/HOSTING.md for the DNS cutover path.
set -e

command -v docker >/dev/null || { echo "need docker"; exit 1; }
if ! command -v cloudflared >/dev/null; then
	echo "installing cloudflared..."
	if command -v apt-get >/dev/null; then
		sudo apt-get install -y cloudflared 2>/dev/null || {
			ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
			curl -sL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}"
			chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
		}
	else
		echo "install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
		exit 1
	fi
fi
[ -n "$POSTGRES_PASSWORD" ] || { echo "export POSTGRES_PASSWORD first"; exit 1; }
[ -n "$API_WRITE_KEY" ] || { echo "export API_WRITE_KEY first (openssl rand -hex 32)"; exit 1; }
if [ -z "$APP_BASIC_AUTH" ] && [ -z "$APP_TRUST_UPSTREAM_AUTH" ]; then
	echo "warning: no APP_BASIC_AUTH — anyone with the tunnel link can read; UI writes will be refused"
fi
[ -f backend/docker-compose.yml ] || { echo "run from repo root (backend/docker-compose.yml not found)"; exit 1; }

cd backend
echo "== building + starting stack =="
docker compose up -d --build

echo "== waiting for API =="
for i in $(seq 1 30); do
	if curl -sf -m 5 -o /dev/null http://localhost:4000/api/readyz; then break; fi
	sleep 10
done
LAYERS=$(curl -s -m 10 http://localhost:4000/api/stats | grep -o '"layer"' | wc -l)
echo "api: up, layers in stats: $LAYERS (expect ~33; full freshness within ~6h)"

echo "== waiting for app =="
for i in $(seq 1 30); do
	if curl -sf -m 5 -o /dev/null http://localhost:3000/healthz; then break; fi
	sleep 10
done
AUTH=${APP_BASIC_AUTH:+-u $APP_BASIC_AUTH}
CHUNK=$(curl -s -m 10 $AUTH http://localhost:3000/ | grep -o 'chunks/[a-z0-9]*\.js' | head -1)
curl -sf -m 10 -o /dev/null "http://localhost:3000/_next/static/$CHUNK" \
	|| { echo "app chunk not servable — stale build, rerun app/restart.sh logic"; exit 1; }
echo "app: up, chunk $CHUNK servable"

echo "== opening tunnel =="
pkill -f "[c]loudflared tunnel" 2>/dev/null || true
setsid nohup cloudflared tunnel --url http://localhost:3000 >>../tunnel.log 2>&1 < /dev/null &
for i in $(seq 1 12); do
	LINK=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ../tunnel.log 2>/dev/null | head -1)
	if [ -n "$LINK" ]; then break; fi
	sleep 5
done
if [ -z "$LINK" ]; then
	echo "tunnel log:"; tail -n 20 ../tunnel.log
	exit 1
fi
echo ""
echo "THOTH LIVE AT: $LINK"
echo "(tunnel dies with the shell session — run under tmux/nohup on the host; DNS cutover per docs/HOSTING.md)"

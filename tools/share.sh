#!/usr/bin/env bash
# Share the join website (web/) from this computer with a temporary public link.
# No Cloudflare account needed. Ctrl+C stops both.
set -e
cd "$(dirname "$0")/../web"
PORT="${PORT:-8080}"

python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

echo "Local:  http://localhost:$PORT"
echo "Public: look for the https://*.trycloudflare.com link below"
# --config /dev/null: ignore ~/.cloudflared/config.yml (the permanent api tunnel), or quick tunnels 404
cloudflared --config /dev/null tunnel --url "http://localhost:$PORT"

#!/usr/bin/env bash
# Serve the game locally and expose it with a free Cloudflare quick tunnel.
# No Cloudflare account needed. Ctrl+C stops both.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8080}"

python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

echo "Local:  http://localhost:$PORT"
echo "Public: look for the https://*.trycloudflare.com link below"
cloudflared tunnel --url "http://localhost:$PORT"

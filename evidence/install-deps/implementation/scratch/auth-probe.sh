#!/usr/bin/env bash
# Ad-hoc auth probe: boot comp1, then try request variants and print status+headers.
set -u
SB="$1"; shift
LOG="$SB/boot.log"
: > "$LOG"
cd "$SB/ws" || exit 1
DSH_HOME="$SB/dsh" HOME="$SB/home" dsh --profile web --port 3411 --no-open > "$LOG" 2>&1 &
PID=$!
for i in $(seq 1 90); do grep -q "dsh web: http" "$LOG" && break; sleep 1; done
URL=$(grep -o "http://127.0.0.1:3411/?token=[A-Za-z0-9_-]*" "$LOG" | head -1)
TOKEN=$(printf '%s' "$URL" | sed 's/.*token=//')
echo "URL=$URL"
probe() { echo "--- $1"; curl -s -o /tmp/probe-body -w "status=%{http_code} bytes=%{size_download}\n" "${@:2}"; head -c 200 /tmp/probe-body; echo; }
probe "GET / no token"            "http://127.0.0.1:3411/"
probe "GET /?token"               "http://127.0.0.1:3411/?token=$TOKEN"
probe "GET / bearer"              -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3411/"
probe "GET / x-dsh-token"         -H "x-dsh-token: $TOKEN" "http://127.0.0.1:3411/"
probe "GET / cookie token"        -H "Cookie: token=$TOKEN" "http://127.0.0.1:3411/"
probe "GET / cookie dsh_token"    -H "Cookie: dsh_token=$TOKEN" "http://127.0.0.1:3411/"
probe "GET /plugins/mpd-better-sidebar/client.js" "http://127.0.0.1:3411/plugins/mpd-better-sidebar/client.js"
probe "GET /plugins/mpd-better-sidebar/client.js?token" "http://127.0.0.1:3411/plugins/mpd-better-sidebar/client.js?token=$TOKEN"
probe "GET /sidebar/api"          "http://127.0.0.1:3411/sidebar/api"
kill $PID 2>/dev/null
sleep 1
echo "=== guard lines ==="
grep -o "\[mpd-better-sidebar\] mount guard: [A-Z]*" "$LOG" | sort -u

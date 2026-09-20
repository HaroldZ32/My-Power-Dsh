#!/usr/bin/env bash
# Ad-hoc probe 2: authenticate via the token URL (303 -> cookie jar), read the index
# HTML, and request every /plugins URL that mentions the sidebar.
set -u
SB="$1"
LOG="$SB/boot.log"
: > "$LOG"
cd "$SB/ws" || exit 1
DSH_HOME="$SB/dsh" HOME="$SB/home" dsh --profile web --port 3412 --no-open > "$LOG" 2>&1 &
PID=$!
for i in $(seq 1 90); do grep -q "dsh web: http" "$LOG" && break; sleep 1; done
TOKEN=$(grep -o "http://127.0.0.1:3412/?token=[A-Za-z0-9_-]*" "$LOG" | head -1 | sed 's/.*token=//')
JAR="$SB/cookies.txt"
echo "--- index via token + jar"
curl -s -c "$JAR" -o "$SB/index.html" -w "status=%{http_code} bytes=%{size_download}\n" "http://127.0.0.1:3412/?token=$TOKEN"
echo "--- index with jar"
curl -s -b "$JAR" -o "$SB/index2.html" -w "status=%{http_code} bytes=%{size_download}\n" "http://127.0.0.1:3412/"
echo "--- plugins URLs in HTML mentioning sidebar"
grep -o '/plugins/[^"'"'"'\\ ]*' "$SB/index.html" | sort -u | grep -i "sidebar" | head
echo "--- all plugins bundles (first 5)"
grep -o '/plugins/[^"'"'"'\\ ]*' "$SB/index.html" | sort -u | head -5
for u in $(grep -o '/plugins/[^"'"'"'\\ ]*' "$SB/index.html" | sort -u | head -40); do
  code=$(curl -s -b "$JAR" -o /tmp/pb -w "%{http_code} %{size_download}" "http://127.0.0.1:3412$u")
  echo "$code  $u"
done
echo "--- direct name variants"
for u in "/plugins/dsh-better-sidebar/client.js" "/plugins/web-ui-better-sidebar/client.js" "/sidebar/bundle"; do
  echo "$(curl -s -b "$JAR" -o /tmp/pb -w "%{http_code} %{size_download}" "http://127.0.0.1:3412$u")  $u"
done
kill $PID 2>/dev/null
sleep 1

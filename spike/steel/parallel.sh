#!/usr/bin/env bash
# Question 5, the concurrency half: run N copies of the SAME 20-page sweep at
# once and see where it stops scaling.
#
#   ./parallel.sh steel 4
#   ./parallel.sh local 4
#
# The two backends need different machinery for the same reason, and it is the
# single most important structural fact about Steel here: **one Steel container
# is one browser**. `CDPService` is a singleton and `activeSession` is one
# session, so `POST /v1/sessions` reconfigures the one browser rather than
# adding another. Concurrency therefore means N containers, each with its own
# API port, its own CDP port and its own ~1GB of Chromium. The local harness
# needs none of that: N processes, N profiles, N Xvfb displays.
#
# Everything lands in out/parallel-<mode>-<n>/.
set -u

MODE="${1:-steel}"
N="${2:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out/parallel-$MODE-$N"
EXT="/home/hzia/repos/parle/apps/extension/.output/chrome-mv3"
rm -rf "$OUT"; mkdir -p "$OUT"

started_at=$(date +%s.%N)

if [ "$MODE" = "steel" ]; then
  echo "starting $N steel containers..."
  for i in $(seq 1 "$N"); do
    docker rm -f "steel-par-$i" >/dev/null 2>&1
    docker run -d --name "steel-par-$i" \
      -p "$((3100 + i)):3000" -p "$((9300 + i)):9223" \
      --shm-size=1g \
      -e CHROME_HEADLESS=false -e DISPLAY=:10 \
      -v "$EXT:/app/api/extensions/parle:ro" \
      --entrypoint /bin/sh \
      ghcr.io/steel-dev/steel-browser-api:latest \
      -c 'rm -f /tmp/.X10-lock /tmp/.X11-unix/X10; Xvfb :10 -screen 0 1280x900x24 -nolisten tcp & exec /app/api/entrypoint.sh' \
      >/dev/null
  done

  echo "waiting for health..."
  for i in $(seq 1 "$N"); do
    for _ in $(seq 1 90); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$((3100 + i))/v1/health")
      [ "$code" = "200" ] && break
      sleep 1
    done
  done
  ready_at=$(date +%s.%N)
  echo "all healthy after $(echo "$ready_at - $started_at" | bc)s"

  sweep_at=$(date +%s.%N)
  for i in $(seq 1 "$N"); do
    STEEL_API="http://localhost:$((3100 + i))" \
    STEEL_CDP="http://localhost:$((9300 + i))" \
    SWEEP_LABEL="steel-$i-of-$N" \
    SWEEP_OUT="$OUT/run-$i.json" \
      node "$HERE/sweep.mjs" steel > "$OUT/run-$i.log" 2>&1 &
  done
  wait
  done_at=$(date +%s.%N)

  docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' > "$OUT/docker-stats.txt" 2>&1
  for i in $(seq 1 "$N"); do docker rm -f "steel-par-$i" >/dev/null 2>&1; done
else
  sweep_at=$(date +%s.%N)
  ready_at=$sweep_at
  for i in $(seq 1 "$N"); do
    SWEEP_LABEL="local-$i-of-$N" \
    SWEEP_PROFILE="$HERE/.sweep-profile-par-$i" \
    SWEEP_DEBUG_PORT="$((9500 + i))" \
    SWEEP_OUT="$OUT/run-$i.json" \
      xvfb-run -a --server-args='-screen 0 1280x900x24' \
      node "$HERE/sweep.mjs" local > "$OUT/run-$i.log" 2>&1 &
  done
  wait
  done_at=$(date +%s.%N)
fi

echo
echo "=== $MODE x$N ==="
echo "bring-up wall:  $(echo "$ready_at - $started_at" | bc)s"
echo "sweeps wall:    $(echo "$done_at - $sweep_at" | bc)s"
echo "total wall:     $(echo "$done_at - $started_at" | bc)s"
node -e '
const fs = require("fs"), dir = process.argv[1]
const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(dir + "/" + f)))
if (runs.length === 0) { console.log("no runs completed"); process.exit(0) }
for (const r of runs) {
  console.log(`  ${r.label.padEnd(16)} asked ${String(r.askedAbout).padStart(2)}/${r.pages}  startup ${String(r.startupMs).padStart(6)}ms  sweep ${String(r.sweepMs).padStart(6)}ms  median/page ${String(r.medianPageMs).padStart(5)}ms  slowest ${String(r.slowestPageMs).padStart(6)}ms`)
}
const asked = runs.reduce((a, r) => a + r.askedAbout, 0)
const total = runs.reduce((a, r) => a + r.pages, 0)
const med = runs.map((r) => r.medianPageMs).sort((a, b) => a - b)
console.log(`  --- ${runs.length} run(s), ${asked}/${total} pages asked about, median-of-medians ${med[Math.floor(med.length / 2)]}ms`)
' "$OUT" | tee -a "$OUT/summary.txt"

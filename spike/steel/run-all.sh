#!/usr/bin/env bash
# Re-run the whole Steel spike from scratch. Everything it produces lands in
# out/, and out/ in git already holds the run this was written from, so a rerun
# can be diffed against it.
#
# WHAT YOU NEED FIRST
#   pnpm --filter @parle/extension build          # produces .output/chrome-mv3
#   pnpm --filter @parle/extension exec wxt build -b safari   # .output/safari-mv3
#   docker, and ~1GB of RAM per concurrent Steel container
#
# THE ONE PIECE OF SETUP THAT IS NOT OBVIOUS
#   The upstream image starts no X server, and headful Chromium is the only mode
#   that honours --load-extension. compose.yml wraps the entrypoint to start
#   Xvfb on :10 first, and clears /tmp/.X10-lock, which `docker restart` leaves
#   behind and which makes Chrome die with "Missing X server or $DISPLAY".
#
# WHY EVERY QUESTION RECREATES THE CONTAINER
#   Steel keeps one user-data dir per container and wipes nothing between
#   sessions, and its `userDataDir` session option does not work (see
#   q3e-isolation.mjs). `stale-worker.mjs` shows what that costs. Recreating the
#   container is the only reset available, so each step below does it.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

up() {
  docker compose -f compose.yml up -d --force-recreate >/dev/null 2>&1
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/v1/health)" = "200" ] && return 0
    sleep 1
  done
  echo "steel never became healthy" >&2
  return 1
}

mkdir -p out

echo "== q1: is the MV3 background service worker reachable? =="
up && node q1-worker.mjs 2>&1 | tee out/q1-worker.txt

echo "== q2: does the unpacked MV3 build load, side panel and all? =="
up && node q2-extension.mjs 2>&1 | tee out/q2-extension.txt
node q2b-panel-adopt.mjs 2>&1 | tee out/q2b-panel-adopt.txt

echo "== q3: can we observe network traffic, the worker's included? =="
up && node q3d-decisive.mjs 2>&1 | tee out/q3d-decisive.txt
up && node q3e-isolation.mjs 2>&1 | tee out/q3e-isolation.txt
xvfb-run -a --server-args='-screen 0 1280x900x24' node control-local-traffic.mjs 2>&1 |
  tee out/control-local-traffic.txt

echo "== q4: can we read a closed shadow root? =="
up && node q4-shadow.mjs 2>&1 | tee out/q4-shadow.txt

echo "== the profile hazard harness.ts was built around =="
up && node stale-worker.mjs 2>&1 | tee out/stale-worker.txt

echo "== q6: can the harness hear the worker's FIRST turn, on both? =="
xvfb-run -a --server-args='-screen 0 1280x900x24' node q6-bootlog.mjs local 2>&1 |
  tee out/q6-bootlog-local.txt
up && node q6-bootlog.mjs steel 2>&1 | tee out/q6-bootlog-steel.txt

echo "== q5: 20 pages, both harnesses, and concurrency =="
up
SWEEP_OUT=out/sweep-steel-1.json node sweep.mjs steel 2>&1 | tee out/sweep-steel-1.txt
SWEEP_OUT=out/sweep-local-1.json xvfb-run -a --server-args='-screen 0 1280x900x24' \
  node sweep.mjs local 2>&1 | tee out/sweep-local-1.txt
for n in 1 4 8 12 16; do ./parallel.sh steel "$n" 2>&1 | tee "out/parallel-steel-$n.txt"; done
for n in 1 4 8 16 24; do ./parallel.sh local "$n" 2>&1 | tee "out/parallel-local-$n.txt"; done

echo "== the Reddit note: no stealth, no proxy, both harnesses =="
up
{ echo "### STEEL"; node reddit-probe.mjs steel
  echo; echo "### LOCAL"; xvfb-run -a --server-args='-screen 0 1280x900x24' node reddit-probe.mjs local
} 2>&1 | tee out/reddit-probe.txt

echo "== cleaning up =="
docker compose -f compose.yml down >/dev/null 2>&1
docker ps -a --filter 'name=steel-par-' -q | xargs -r docker rm -f >/dev/null 2>&1
rm -rf .sweep-profile-* .local-profile .reddit-profile .bootlog-profile
echo "done. raw output in out/"

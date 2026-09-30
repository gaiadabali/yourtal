#!/bin/bash
# Boots a release's api once on a scratch port and runs its worker's --check,
# so a release that cannot start fails before it goes live (13.8). Used by
# pre-reload.sh on Helios, before the swap, and by release.yml on the artifact.
#
#   boot-check.sh <release-root> [--strict]
#
# --strict (Helios) needs /api/health to answer 200 with the release's own
# REVISION. Without it (CI, no Cerbos) any HTTP answer proves the api booted.
# The variables come from the caller's environment.
set -Eeuo pipefail

release=$1
strict=${2:-}
node=${NODE:-node}
export NODE_ENV=${NODE_ENV:-production} # as pm2 runs it (ecosystem.config.cjs)
port=${BOOT_CHECK_PORT:-26309}
log() { printf '[boot-check] %s\n' "$*"; }

cd "$release"
expected=$(cat REVISION 2>/dev/null || echo dev)

log "worker --check"
"$node" worker/dist/main.js --check

log "api on 127.0.0.1:$port"
out=$(mktemp)
PORT=$port HOST=127.0.0.1 "$node" --enable-source-maps api/dist/main.js >"$out" 2>&1 &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$out" "$out.body"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 40 "$out"
    log "FAILED: the api exited during boot"
    exit 1
  fi
  code=$(curl -sS -o "$out.body" -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:$port/api/health" 2>/dev/null || true)
  if [ -n "$code" ] && [ "$code" != 000 ]; then
    if [ "$strict" != --strict ]; then
      log "ok: the api answered $code"
      exit 0
    fi
    if [ "$code" = 200 ] && grep -q "\"revision\":\"$expected\"" "$out.body"; then
      log "ok: healthy at $expected"
      exit 0
    fi
  fi
  sleep 1
done

tail -n 40 "$out"
log "FAILED: /api/health never answered ${strict:+200 at $expected }within 60 s (last: ${code:-none})"
exit 1

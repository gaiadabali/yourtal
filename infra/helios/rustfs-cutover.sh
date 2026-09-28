#!/bin/bash
# 7.9.c: one-time storage cut-over to RustFS on Helios (F58, F60 — the
# founder's direct call: cut over directly, the old object store is
# discontinued, not kept as a fallback).
#
#   sudo bash rustfs-cutover.sh /path/to/new/docker-compose.helios.yml
#
# Run as root, once. Reviewed and run by the coordinator only — infra/**'s
# own ownership, and this changes what staging's api/worker actually write
# to. Takes the new compose file as an argument rather than assuming it is
# already in place: this script installs it itself (backing up the live
# one with a timestamp first), so there is one less manual step to get
# wrong before running this.
#
# ## What this does, in order
#
#   1. Backs up: app.env and a full `backup.sh` run (Postgres dump +
#      keyring). The object data itself is untouched until step 7 — the
#      old store stays up and unmodified through every step before it.
#   2. Backs up the live docker-compose.helios.yml with a timestamp, then
#      installs the new one (the argument) in its place at
#      /opt/yourtal/stack.
#   3. Starts a TEMPORARY, disposable RustFS container attached to
#      `yourtal_rustfs` — the EXACT named volume the new compose file's
#      own `rustfs` service declares (`name: yourtal_rustfs`, not the
#      implicit `<project>_rustfs` docker-compose would otherwise pick,
#      so this matches regardless of how compose is ever invoked) — on a
#      scratch port (26307), alongside the still-running old store, no
#      port clash.
#   4. Provisions that volume for real: creates the "yourtal-media"
#      bucket, its public-read policy (hls/posters/teasers/captions), its
#      CORS rule (the deployed SITE_URL, never a wildcard), and the app's
#      least-privilege RustFS user — the same curl+SigV4 recipe
#      bootstrap.sh's own provisioning uses (RustFS has no `mc`/CLI and no
#      AWS IAM API).
#   5. Mirrors every object from the old store to the temporary RustFS
#      container with `mc mirror` (the old store's own container still
#      has `mc`), TWICE in a row — the site is live throughout this
#      script, so a single mirror pass can miss a write made during its
#      own run; a second, near-instant pass right before the switch closes
#      most of that window. (Acceptable on staging; see the note at the
#      bottom of this header for what "most" means here.)
#   6. Verifies: object count AND total bytes must match between the old
#      store and the temporary RustFS container after the SECOND mirror
#      pass. A mismatch aborts here — the old store is still serving,
#      nothing has switched over yet.
#   7. Only now: stops (not yet removes) the old store, stops the
#      temporary container, and brings up the REAL, compose-managed
#      `rustfs` service on the old store's former port (26305), attached
#      to the same now-populated volume. Waits for its healthcheck.
#   8. Verifies AGAIN, against the REAL service this time (not the
#      temporary one) — the same count-and-bytes check as step 6. This is
#      the check that would have caught the exact bug this script's own
#      first draft had (a volume-name mismatch that would have started the
#      real service on an empty volume). A mismatch here aborts with the
#      old store stopped but NOT removed, so a human can start it back up
#      and investigate — no automated rollback beyond that; F60 dropped
#      the old store as a standing fallback, so this script does not
#      pretend it still is one past this point.
#   9. Switches app.env: `S3_ACCESS_KEY`/`S3_SECRET_KEY` to the new RustFS
#      app key (`S3_ENDPOINT` does NOT change — same host, same port,
#      26305, throughout). Adds `MEDIA_CORS_ORIGINS=<SITE_URL>` if app.env
#      has none (packages/media's own default only covers local dev;
#      without this, staging's CORS allowlist would default to
#      `localhost`, and a real browser's direct upload PUT would be
#      refused after cut-over).
#  10. Restarts api and worker under the SITE USER's own pm2
#      (`sudo -u uyourtal pm2 restart ...` — root's own pm2 is a different
#      daemon and would restart nothing real).
#  11. Smoke-tests: the api's own health; a real, existing public object
#      (a poster from the 7.2.e demo media, preferring one already stored
#      as a relative `/media/...` path so this actually exercises nginx,
#      falling back to translating an absolute URL row into the same
#      nginx-facing path if that is all that exists) loads through nginx;
#      and the full presigned-upload round trip through the real api
#      (login as a real demo business owner, create a throwaway draft
#      campaign, initiate -> PUT -> complete — `rustfs-smoke-test.mjs`,
#      alongside this script) — proving the whole chain, not just
#      connectivity. Any smoke-test failure is a hard stop; nothing further
#      happens.
#  12. Only after every check above passes: removes the old store's
#      container and its env file (`minio.env`) — F60, it is genuinely
#      discontinued, not kept around "just in case". Its data volume
#      (`yourtal_minio`) is left alone; the coordinator deletes that
#      separately, once 7.9.d's own Check has passed on staging.
#
# ## The mirror race window this does NOT close
#
# A write to the old store between this script's SECOND mirror pass
# (step 5/6) and the moment it is stopped (step 7) is not copied — the
# window is however long steps 6-7 take (seconds, not minutes, and no
# external network call sits in between). Acceptable on staging (F60): no
# real money moves through object storage, and a lost write here is a
# missing image, not lost state. A production cut-over with real user
# uploads landing continuously would need either a brief write-freeze or a
# proper dual-write period; this script does neither, because staging
# does not need either.
set -Eeuo pipefail

# Every one of these is the real Helios value by default. All are
# overridable by env var — not for production use (never override them on
# the real box), but so this exact script, unmodified, can be rehearsed
# against a stand-in project on a dev machine, per the coordinator's own
# ask (2026-09-28) rather than only reasoned about on paper.
STACK=${RUSTFS_CUTOVER_STACK:-/opt/yourtal/stack}
SECRETS=${RUSTFS_CUTOVER_SECRETS:-/opt/yourtal/secrets}
APP_ENV="$SECRETS/app.env"
BUCKET=${RUSTFS_CUTOVER_BUCKET:-yourtal-media}
RUSTFS_VOLUME=${RUSTFS_CUTOVER_VOLUME:-yourtal_rustfs}
MIGRATE_PORT=${RUSTFS_CUTOVER_MIGRATE_PORT:-26307}
FINAL_PORT=${RUSTFS_CUTOVER_FINAL_PORT:-26305}
SITE_URL=${RUSTFS_CUTOVER_SITE_URL:-https://yourtal.gaiada.com}
SITE_USER=${RUSTFS_CUTOVER_SITE_USER:-uyourtal}
OLD_STORE_CONTAINER=${RUSTFS_CUTOVER_OLD_STORE_CONTAINER:-yourtal-minio}
OLD_STORE_VOLUME=${RUSTFS_CUTOVER_OLD_STORE_VOLUME:-yourtal_minio}
POSTGRES_CONTAINER=${RUSTFS_CUTOVER_POSTGRES_CONTAINER:-yourtal-postgres}
POSTGRES_USER=${RUSTFS_CUTOVER_POSTGRES_USER:-yourtal}
POSTGRES_DB=${RUSTFS_CUTOVER_POSTGRES_DB:-yourtal}
API_BASE=${RUSTFS_CUTOVER_API_BASE:-http://127.0.0.1:26301}
PUBLIC_BASE=${RUSTFS_CUTOVER_PUBLIC_BASE:-https://yourtal.gaiada.com}
NODE_BIN=${RUSTFS_CUTOVER_NODE_BIN:-$(dirname "$STACK")/node/bin/node}
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

log() { printf '[rustfs-cutover] %s\n' "$*"; }
die() {
  log "FAILED: $*"
  exit 1
}

[ "$(id -u)" -eq 0 ] || [ -n "${RUSTFS_CUTOVER_SKIP_ROOT_CHECK:-}" ] || die "must run as root"
new_compose=${1:-}
[ -n "$new_compose" ] || die "usage: rustfs-cutover.sh /path/to/new/docker-compose.helios.yml"
[ -f "$new_compose" ] || die "$new_compose does not exist"
grep -q '^  rustfs:' "$new_compose" || die "$new_compose does not define an rustfs service"
grep -q "name: $RUSTFS_VOLUME" "$new_compose" || die "$new_compose's rustfs volume is not named '$RUSTFS_VOLUME' explicitly — this script and the compose file must agree on that name"

# --- 1: backups ---
stamp=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$APP_ENV" "$APP_ENV.bak-rustfs-cutover-$stamp"
log "1/12 app.env backed up to $APP_ENV.bak-rustfs-cutover-$stamp"
"$(dirname "$STACK")/bin/backup.sh" 2>&1 | sed 's/^/[backup.sh] /' ||
  die "backup.sh failed — fix that before touching anything live"

# --- 2: install the new compose file ---
cp -p "$STACK/docker-compose.helios.yml" "$STACK/docker-compose.helios.yml.bak-$stamp"
log "2/12 old docker-compose.helios.yml backed up to docker-compose.helios.yml.bak-$stamp"
cp "$new_compose" "$STACK/docker-compose.helios.yml"

if [ ! -f "$STACK/rustfs.env" ]; then
  rand() { head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n'; }
  printf 'RUSTFS_ROOT_USER=yourtal\nRUSTFS_ROOT_PASSWORD=%s\n' "$(rand)" >"$STACK/rustfs.env"
  chmod 600 "$STACK/rustfs.env"
fi
rustfs_pass=$(sed -n 's/^RUSTFS_ROOT_PASSWORD=//p' "$STACK/rustfs.env")

# --- 3: temporary RustFS on the real volume ---
log "3/12 starting a temporary RustFS on $RUSTFS_VOLUME, port $MIGRATE_PORT"
docker volume create "$RUSTFS_VOLUME" >/dev/null 2>&1 || true
docker rm -f yourtal-rustfs-migrate >/dev/null 2>&1 || true
old_store_network=$(docker inspect "$OLD_STORE_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
[ -n "$old_store_network" ] || die "could not find the old store's docker network"
rustfs_image=$(sed -n 's/^\s*image:\s*//p' "$STACK/docker-compose.helios.yml" | grep rustfs | head -1)
[ -n "$rustfs_image" ] || die "could not read the rustfs image from the installed compose file"
docker run -d --name yourtal-rustfs-migrate --network "$old_store_network" \
  -p "127.0.0.1:$MIGRATE_PORT:9000" \
  -v "$RUSTFS_VOLUME:/data" \
  -e RUSTFS_ROOT_USER=yourtal \
  -e RUSTFS_ROOT_PASSWORD="$rustfs_pass" \
  "$rustfs_image" ||
  die "could not start yourtal-rustfs-migrate"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$MIGRATE_PORT/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$MIGRATE_PORT/health" >/dev/null 2>&1 || die "yourtal-rustfs-migrate never became healthy"

# --- 4: provisioning ---
log "4/12 provisioning: bucket, public-read policy, CORS, app key"
rustfs_sigv4() { curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "yourtal:$rustfs_pass" "$@"; }
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/$BUCKET" >/dev/null 2>&1 || true
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/$BUCKET?policy" \
  -H "content-type: application/json" \
  -d "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"PublicReadStudioMedia\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":[\"*\"]},\"Action\":[\"s3:GetObject\"],\"Resource\":[\"arn:aws:s3:::$BUCKET/hls/*\",\"arn:aws:s3:::$BUCKET/posters/*\",\"arn:aws:s3:::$BUCKET/teasers/*\",\"arn:aws:s3:::$BUCKET/captions/*\"]}]}" \
  >/dev/null || die "PutBucketPolicy failed"
# Verify what was just set, as root -- the app's own least-privilege key
# gets a clean AccessDenied on GetBucketPolicy too (found live,
# 2026-09-28), so this is the one place that can actually confirm it.
policy_now=$(rustfs_sigv4 "http://127.0.0.1:$MIGRATE_PORT/$BUCKET?policy") || die "GetBucketPolicy (verification) failed"
for prefix in hls posters teasers captions; do
  case "$policy_now" in
  *"arn:aws:s3:::$BUCKET/$prefix/*"*) ;;
  *) die "bucket policy does not grant public read on $prefix/* after setting it" ;;
  esac
done
log "bucket policy verified: public read on hls/, posters/, teasers/, captions/"
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/$BUCKET?cors" \
  -H "content-type: application/xml" \
  -d "<?xml version=\"1.0\" encoding=\"UTF-8\"?><CORSConfiguration><CORSRule><AllowedOrigin>$SITE_URL</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>" \
  >/dev/null || die "PutBucketCors failed"
s3_secret=$(head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n')
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/rustfs/admin/v3/add-canned-policy?name=yourtal-media-rw" \
  -H "content-type: application/json" \
  -d "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\",\"s3:GetBucketLocation\"],\"Resource\":[\"arn:aws:s3:::$BUCKET\"]},{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\"],\"Resource\":[\"arn:aws:s3:::$BUCKET/*\"]}]}" \
  >/dev/null || die "add-canned-policy failed"
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/rustfs/admin/v3/add-user?accessKey=yourtal-app" \
  -H "content-type: application/json" \
  -d "{\"secretKey\":\"$s3_secret\",\"status\":\"enabled\"}" \
  >/dev/null || die "add-user failed"
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/rustfs/admin/v3/set-user-or-group-policy?policyName=yourtal-media-rw&userOrGroup=yourtal-app&isGroup=false" \
  >/dev/null || die "set-user-or-group-policy failed"

# --- 5/6: mirror, twice, verifying the second pass ---
old_pass=$(sed -n 's/^MINIO_ROOT_PASSWORD=//p' "$STACK/minio.env")
docker exec "$OLD_STORE_CONTAINER" mc alias set src http://127.0.0.1:9000 yourtal "$old_pass" >/dev/null
docker exec "$OLD_STORE_CONTAINER" mc alias set dst "http://yourtal-rustfs-migrate:9000" yourtal "$rustfs_pass" >/dev/null

mirror_and_stat() {
  docker exec "$OLD_STORE_CONTAINER" mc mirror --overwrite "src/$BUCKET" "dst/$BUCKET" || die "mc mirror failed"
  src_stat=$(docker exec "$OLD_STORE_CONTAINER" mc du "src/$BUCKET" --json)
  dst_stat=$(docker exec "$OLD_STORE_CONTAINER" mc du "dst/$BUCKET" --json)
  src_count=$(echo "$src_stat" | grep -o '"objects":[0-9]*' | head -1 | cut -d: -f2)
  dst_count=$(echo "$dst_stat" | grep -o '"objects":[0-9]*' | head -1 | cut -d: -f2)
  src_size=$(echo "$src_stat" | grep -o '"size":[0-9]*' | head -1 | cut -d: -f2)
  dst_size=$(echo "$dst_stat" | grep -o '"size":[0-9]*' | head -1 | cut -d: -f2)
}

log "5/12 first mirror pass"
mirror_and_stat
log "pass 1 — source: $src_count objects/$src_size bytes, dest: $dst_count objects/$dst_size bytes"

log "6/12 second mirror pass (closes most of the write-during-migration window) and verifying"
mirror_and_stat
log "pass 2 — source: $src_count objects/$src_size bytes, dest: $dst_count objects/$dst_size bytes"
[ "$src_count" = "$dst_count" ] || die "object count mismatch after the second pass ($src_count vs $dst_count) — old store untouched, nothing switched over"
[ "$src_size" = "$dst_size" ] || die "byte-total mismatch after the second pass ($src_size vs $dst_size) — old store untouched, nothing switched over"
expected_count=$src_count
expected_size=$src_size

# --- 7: switch ---
log "7/12 stopping the temporary container and the old store, starting the real rustfs service on $FINAL_PORT"
docker stop yourtal-rustfs-migrate >/dev/null
docker rm yourtal-rustfs-migrate >/dev/null
docker stop "$OLD_STORE_CONTAINER" >/dev/null || die "could not stop the old store"
(cd "$STACK" && docker compose -f docker-compose.helios.yml up -d rustfs) || die "could not start the real rustfs service"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$FINAL_PORT/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$FINAL_PORT/health" >/dev/null 2>&1 || die "rustfs never became healthy on $FINAL_PORT"

# --- 8: verify the REAL service, not the temporary one ---
log "8/12 verifying the real rustfs service holds what was mirrored"
# Count objects the same way the app itself will: a real ListObjectsV2
# sweep against the root credentials, not `mc du` again. This
# matters more than mc's own report — it is the same code path a real
# request takes, not a CLI's own bookkeeping.
real_count=0
real_size=0
continuation=""
while :; do
  # -G --data-urlencode, not a hand-built query string: a continuation
  # token is opaque base64 and may contain characters (`+`, `/`) a raw
  # query string would mangle.
  if [ -n "$continuation" ]; then
    page=$(curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "yourtal:$rustfs_pass" \
      -G "http://127.0.0.1:$FINAL_PORT/$BUCKET" \
      --data-urlencode "list-type=2" --data-urlencode "max-keys=1000" \
      --data-urlencode "continuation-token=$continuation") || die "ListObjectsV2 against the real service failed"
  else
    page=$(curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "yourtal:$rustfs_pass" \
      -G "http://127.0.0.1:$FINAL_PORT/$BUCKET" \
      --data-urlencode "list-type=2" --data-urlencode "max-keys=1000") || die "ListObjectsV2 against the real service failed"
  fi
  page_count=$(echo "$page" | grep -o '<Key>' | wc -l)
  page_size=$(echo "$page" | grep -o '<Size>[0-9]*</Size>' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')
  real_count=$((real_count + page_count))
  real_size=$((real_size + page_size))
  is_truncated=$(echo "$page" | grep -o '<IsTruncated>true</IsTruncated>' || true)
  [ -n "$is_truncated" ] || break
  continuation=$(echo "$page" | grep -o '<NextContinuationToken>[^<]*' | sed 's/.*>//')
  [ -n "$continuation" ] || break
done
log "real service: $real_count objects/$real_size bytes (expected $expected_count/$expected_size)"
[ "$real_count" = "$expected_count" ] || die "the REAL rustfs service's object count ($real_count) does not match what was mirrored ($expected_count) — old store is stopped but NOT removed; start it back up (docker start $OLD_STORE_CONTAINER) and investigate before retrying"
[ "$real_size" = "$expected_size" ] || die "the REAL rustfs service's byte total ($real_size) does not match what was mirrored ($expected_size) — old store is stopped but NOT removed; start it back up (docker start $OLD_STORE_CONTAINER) and investigate before retrying"

# --- 9: app.env ---
log "9/12 switching app.env's S3_ACCESS_KEY/S3_SECRET_KEY (S3_ENDPOINT stays $FINAL_PORT, unchanged)"
sed -i "s/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=yourtal-app/" "$APP_ENV"
sed -i "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$s3_secret/" "$APP_ENV"
grep -q '^MEDIA_CORS_ORIGINS=' "$APP_ENV" || echo "MEDIA_CORS_ORIGINS=$SITE_URL" >>"$APP_ENV"

# --- 10: restart under the site user's own pm2 ---
log "10/12 restarting api and worker (as $SITE_USER)"
sudo -u "$SITE_USER" pm2 restart yourtal-api yourtal-worker

# --- 11: smoke tests ---
log "11/12 smoke tests"
# A pm2 restart is not instant — a fixed 2s wait was too short on a real
# run (found live, 2026-09-28): poll instead, up to ~60s.
api_healthy=""
for _ in $(seq 1 30); do
  curl -fsS "$API_BASE/api/health" >/dev/null 2>&1 && { api_healthy=1; break; }
  sleep 2
done
[ -n "$api_healthy" ] || die "api health check failed after cut-over (waited ~60s)"

raw_path=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT poster_url FROM campaign.campaigns WHERE poster_url IS NOT NULL ORDER BY (poster_url LIKE '/media/%') DESC LIMIT 1;" | tr -d '[:space:]')
[ -n "$raw_path" ] || die "no poster_url found in campaign.campaigns to smoke-test with — 7.2.e's demo media should exist; this is a hard failure, not a warning"
# Normalize both a relative "/media/..." path and a full
# "http://host:port/yourtal-media/..." URL (staging.ts's own single demo
# listing still stores the latter) to the nginx-facing path.
nginx_path=${raw_path#*/yourtal-media/}
if [ "$nginx_path" != "$raw_path" ]; then
  nginx_path="/media/$nginx_path"
else
  nginx_path=$raw_path
fi
curl -fsS -o /dev/null "$PUBLIC_BASE${nginx_path}" ||
  die "a known public object ($nginx_path) did not load through nginx after cut-over"
log "public object $nginx_path loaded OK through nginx"

demo_password=$(sed -n 's/^STAGING_DEMO_PASSWORD=//p' "$APP_ENV")
[ -n "$demo_password" ] || die "STAGING_DEMO_PASSWORD not found in app.env — cannot run the presigned-upload smoke test"
smoke_output=$(API_BASE="$API_BASE" DEMO_PASSWORD="$demo_password" \
  "$NODE_BIN" "$SCRIPT_DIR/rustfs-smoke-test.mjs") ||
  die "the presigned-upload round trip failed — see output above"
result_line=$(echo "$smoke_output" | grep '^RESULT:')
[ -n "$result_line" ] || die "the presigned-upload smoke test produced no RESULT line: $smoke_output"
log "presigned-upload round trip OK: ${result_line#RESULT:}"
smoke_campaign_id=$(echo "$result_line" | grep -o '"campaignId":"[^"]*"' | cut -d'"' -f4)
smoke_asset_id=$(echo "$result_line" | grep -o '"assetId":"[^"]*"' | cut -d'"' -f4)
if [ -n "$smoke_campaign_id" ] && [ -n "$smoke_asset_id" ]; then
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "DELETE FROM studio.media_assets WHERE id = '$smoke_asset_id'; DELETE FROM campaign.campaigns WHERE id = '$smoke_campaign_id';" \
    >/dev/null || log "WARNING: could not clean up the smoke test's own draft campaign/asset ($smoke_campaign_id/$smoke_asset_id) — harmless, delete by hand"
fi

# --- 12: retire the old store ---
log "12/12 removing the old store's container and env file (F60 — genuinely discontinued)"
docker rm -f "$OLD_STORE_CONTAINER" >/dev/null
rm -f "$STACK/minio.env"

log "cut-over OK. $OLD_STORE_VOLUME (the volume) is left in place for the coordinator to remove after 7.9.d's Check passes on staging."

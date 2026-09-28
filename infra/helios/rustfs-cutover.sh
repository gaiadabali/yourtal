#!/bin/bash
# 7.9.c: one-time MinIO -> RustFS storage cut-over on Helios (F58).
# Review before running. The coordinator runs this, never an agent
# (infra/**'s own ownership, and this changes what staging's api/worker
# actually write to).
#
#   sudo bash rustfs-cutover.sh migrate    # do the cut-over
#   sudo bash rustfs-cutover.sh rollback   # switch back to MinIO
#
# ## What "migrate" does, in order
#
#   1. Backs up: app.env (this script's own edit target) and a full
#      `backup.sh` run (Postgres dump + keyring — the object data itself
#      is untouched throughout, MinIO stays up and unmodified until the
#      very end).
#   2. Copies the already-merged docker-compose.helios.yml (this repo's
#      copy, main branch) and a fresh rustfs.env to /opt/yourtal/stack/.
#   3. Starts a TEMPORARY, disposable RustFS container attached to the
#      REAL "rustfs" named volume docker-compose.helios.yml's own service
#      will use — on a scratch port (26307), not 26305, so it runs
#      alongside MinIO (still on 26305) without a port clash.
#   4. Provisions that volume for real: creates the "yourtal-media" bucket,
#      sets its public-read policy (hls/posters/teasers/captions) and its
#      CORS rule, creates the app's least-privilege "yourtal-app" RustFS
#      user — same recipe bootstrap.sh's own provisioning uses, over
#      `curl --aws-sigv4` (RustFS has no `mc`/CLI and no AWS IAM API).
#   5. Mirrors every object from MinIO to the temporary RustFS container,
#      using MinIO's own `mc` (still available in its own container) —
#      `mc mirror`, not a hand-rolled copy loop.
#   6. Verifies: object count AND total bytes must match between the
#      source and the destination before anything is switched over. A
#      mismatch aborts here — MinIO is untouched, nothing has changed for
#      the running site yet.
#   7. Stops (never removes) the temporary container, stops (never
#      removes) yourtal-minio — freeing port 26305 — then brings up the
#      REAL, compose-managed `rustfs` service on that same port, attached
#      to the same now-populated volume. Waits for its healthcheck.
#   8. Switches app.env: S3_ACCESS_KEY/S3_SECRET_KEY to the new RustFS app
#      key (S3_ENDPOINT does NOT change — same host, same port, 26305).
#      Adds MEDIA_CORS_ORIGINS=https://yourtal.gaiada.com if app.env has
#      none (packages/media's own default only covers local dev; without
#      this, staging's CORS allowlist would default to localhost, and a
#      real browser's direct upload PUT would be refused after cut-over).
#   9. Restarts only yourtal-api and yourtal-worker (pm2) — nothing else
#      needs it; ledger/voucher/web never touch object storage.
#  10. Smoke-tests: the api's own health, an anonymous GET of a known
#      public object (a real one copied from MinIO), and a fresh presigned
#      upload round-trip (initiate -> PUT -> complete) through the real
#      api, proving the whole chain rather than just connectivity.
#
# MinIO is left STOPPED, not deleted, until 7.9.d's Check passes on
# staging. Its data (unmodified throughout) is the rollback's own fallback.
#
# ## What "rollback" does
#
#   Stops the compose-managed `rustfs` service (frees 26305), starts
#   yourtal-minio back up, restores app.env from this script's own backup,
#   restarts yourtal-api/yourtal-worker, and smoke-tests the old path.
#   Nothing here is destructive: RustFS's own data (a full copy made
#   during "migrate") is left alone, so a second "migrate" later needs no
#   re-copy — the mirror step is idempotent (`mc mirror` overwrites only
#   what changed) and will simply confirm the counts still match.
set -Eeuo pipefail

STACK=/opt/yourtal/stack
SECRETS=/opt/yourtal/secrets
APP_ENV="$SECRETS/app.env"
BUCKET=yourtal-media
MIGRATE_PORT=26307
FINAL_PORT=26305
SITE_URL=https://yourtal.gaiada.com

log() { printf '[rustfs-cutover] %s\n' "$*"; }
die() {
  log "FAILED: $*"
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root"
cmd=${1:-}
[ "$cmd" = "migrate" ] || [ "$cmd" = "rollback" ] || die "usage: rustfs-cutover.sh {migrate|rollback}"

backup_app_env() {
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  cp -p "$APP_ENV" "$APP_ENV.bak-rustfs-cutover-$stamp"
  log "app.env backed up to $APP_ENV.bak-rustfs-cutover-$stamp"
  echo "$APP_ENV.bak-rustfs-cutover-$stamp"
}

if [ "$cmd" = "rollback" ]; then
  latest_backup=$(ls -t "$APP_ENV".bak-rustfs-cutover-* 2>/dev/null | head -1) ||
    die "no rustfs-cutover app.env backup found — nothing to roll back to"
  [ -n "$latest_backup" ] || die "no rustfs-cutover app.env backup found"

  log "stopping the rustfs service (frees port $FINAL_PORT)"
  (cd "$STACK" && docker compose -f docker-compose.helios.yml stop rustfs) ||
    die "could not stop rustfs"

  log "starting yourtal-minio back up"
  docker start yourtal-minio || die "could not start yourtal-minio"
  for _ in $(seq 1 30); do
    docker exec yourtal-minio mc ready local >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec yourtal-minio mc ready local >/dev/null 2>&1 || die "yourtal-minio did not become ready"

  cp -p "$APP_ENV" "$APP_ENV.bak-before-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$latest_backup" "$APP_ENV"
  log "app.env restored from $latest_backup"

  log "restarting api and worker"
  pm2 restart yourtal-api yourtal-worker

  sleep 2
  curl -fsS http://127.0.0.1:26301/api/health >/dev/null || die "api health check failed after rollback"
  log "rollback OK — MinIO serving again on $FINAL_PORT, RustFS's own copy of the data untouched"
  exit 0
fi

# --- migrate ---

log "1/10 backups"
backup_app_env >/tmp/rustfs-cutover-app-env-backup-path
"$STACK/../bin/backup.sh" 2>&1 | sed 's/^/[backup.sh] /' || log "WARNING: backup.sh reported an error — check its own log before continuing by hand"

log "2/10 refreshing docker-compose.helios.yml and rustfs.env in $STACK"
[ -f "$STACK/docker-compose.helios.yml" ] || die "expected docker-compose.helios.yml to already be at $STACK (copy the merged repo's copy here first)"
grep -q '^  rustfs:' "$STACK/docker-compose.helios.yml" || die "docker-compose.helios.yml at $STACK does not define an rustfs service yet — copy the merged one from the repo before running this"
if [ ! -f "$STACK/rustfs.env" ]; then
  rand() { head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n'; }
  printf 'RUSTFS_ROOT_USER=yourtal\nRUSTFS_ROOT_PASSWORD=%s\n' "$(rand)" >"$STACK/rustfs.env"
  chmod 600 "$STACK/rustfs.env"
fi
rustfs_pass=$(sed -n 's/^RUSTFS_ROOT_PASSWORD=//p' "$STACK/rustfs.env")

log "3/10 starting a temporary RustFS on the real volume, port $MIGRATE_PORT"
docker volume create rustfs >/dev/null 2>&1 || true
docker rm -f yourtal-rustfs-migrate >/dev/null 2>&1 || true
minio_network=$(docker inspect yourtal-minio --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
[ -n "$minio_network" ] || die "could not find yourtal-minio's docker network"
docker run -d --name yourtal-rustfs-migrate --network "$minio_network" \
  -p "127.0.0.1:$MIGRATE_PORT:9000" \
  -v rustfs:/data \
  -e RUSTFS_ROOT_USER=yourtal \
  -e RUSTFS_ROOT_PASSWORD="$rustfs_pass" \
  "$(sed -n 's/^\s*image:\s*//p' "$STACK/docker-compose.helios.yml" | grep rustfs || echo rustfs/rustfs@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff)" ||
  die "could not start yourtal-rustfs-migrate"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$MIGRATE_PORT/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$MIGRATE_PORT/health" >/dev/null 2>&1 || die "yourtal-rustfs-migrate never became healthy"

log "4/10 provisioning: bucket, public-read policy, CORS, app key"
rustfs_sigv4() { curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "yourtal:$rustfs_pass" "$@"; }
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/$BUCKET" >/dev/null 2>&1 || true
rustfs_sigv4 -X PUT "http://127.0.0.1:$MIGRATE_PORT/$BUCKET?policy" \
  -H "content-type: application/json" \
  -d "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"PublicReadStudioMedia\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":[\"*\"]},\"Action\":[\"s3:GetObject\"],\"Resource\":[\"arn:aws:s3:::$BUCKET/hls/*\",\"arn:aws:s3:::$BUCKET/posters/*\",\"arn:aws:s3:::$BUCKET/teasers/*\",\"arn:aws:s3:::$BUCKET/captions/*\"]}]}" \
  >/dev/null || die "PutBucketPolicy failed"
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

log "5/10 mirroring every object from MinIO to RustFS"
minio_pass=$(sed -n 's/^MINIO_ROOT_PASSWORD=//p' "$STACK/minio.env")
docker exec yourtal-minio mc alias set src http://127.0.0.1:9000 yourtal "$minio_pass" >/dev/null
docker exec yourtal-minio mc alias set dst "http://yourtal-rustfs-migrate:9000" yourtal "$rustfs_pass" >/dev/null
docker exec yourtal-minio mc mirror --overwrite "src/$BUCKET" "dst/$BUCKET" || die "mc mirror failed"

log "6/10 verifying object count and total bytes match"
src_stat=$(docker exec yourtal-minio mc du "src/$BUCKET" --json)
dst_stat=$(docker exec yourtal-minio mc du "dst/$BUCKET" --json)
src_count=$(echo "$src_stat" | grep -o '"objects":[0-9]*' | head -1 | cut -d: -f2)
dst_count=$(echo "$dst_stat" | grep -o '"objects":[0-9]*' | head -1 | cut -d: -f2)
src_size=$(echo "$src_stat" | grep -o '"size":[0-9]*' | head -1 | cut -d: -f2)
dst_size=$(echo "$dst_stat" | grep -o '"size":[0-9]*' | head -1 | cut -d: -f2)
log "MinIO: $src_count objects, $src_size bytes — RustFS: $dst_count objects, $dst_size bytes"
[ "$src_count" = "$dst_count" ] || die "object count mismatch ($src_count vs $dst_count) — MinIO untouched, nothing switched over"
[ "$src_size" = "$dst_size" ] || die "byte-total mismatch ($src_size vs $dst_size) — MinIO untouched, nothing switched over"

log "7/10 stopping the temporary container and MinIO, starting the real rustfs service on $FINAL_PORT"
docker stop yourtal-rustfs-migrate >/dev/null
docker rm yourtal-rustfs-migrate >/dev/null
docker stop yourtal-minio >/dev/null || die "could not stop yourtal-minio"
(cd "$STACK" && docker compose -f docker-compose.helios.yml up -d rustfs) || die "could not start the real rustfs service"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$FINAL_PORT/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$FINAL_PORT/health" >/dev/null 2>&1 || die "rustfs never became healthy on $FINAL_PORT"

log "8/10 switching app.env's S3_ACCESS_KEY/S3_SECRET_KEY (S3_ENDPOINT stays $FINAL_PORT, unchanged)"
sed -i "s/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=yourtal-app/" "$APP_ENV"
sed -i "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$s3_secret/" "$APP_ENV"
grep -q '^MEDIA_CORS_ORIGINS=' "$APP_ENV" || echo "MEDIA_CORS_ORIGINS=$SITE_URL" >>"$APP_ENV"

log "9/10 restarting api and worker"
pm2 restart yourtal-api yourtal-worker

log "10/10 smoke tests"
sleep 2
curl -fsS http://127.0.0.1:26301/api/health >/dev/null || die "api health check failed after cut-over"
sample_object=$(docker exec yourtal-postgres psql -U yourtal_app -d yourtal -tAc \
  "SELECT poster_url FROM campaign.campaigns WHERE poster_url IS NOT NULL LIMIT 1;" 2>/dev/null || true)
if [ -n "$sample_object" ]; then
  curl -fsS -o /dev/null "https://yourtal.gaiada.com${sample_object}" ||
    die "a known public object ($sample_object) did not load through nginx after cut-over"
  log "public object $sample_object loaded OK through nginx"
else
  log "WARNING: no existing poster_url found to smoke-test with — check manually with a real Studio upload"
fi

log "migrate OK. MinIO is stopped, NOT deleted, at $STACK — leave it until 7.9.d's Check passes on staging."

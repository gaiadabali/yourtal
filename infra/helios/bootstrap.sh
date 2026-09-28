#!/bin/bash
# One-time (and safe to re-run) root setup of YourTal on Helios (2.1.a, 2.1.d).
# Everything per-release is done by the deploy; this only lays the ground.
#
#   sudo bash bootstrap.sh <dir holding docker-compose.helios.yml, infra/>
#
# It touches only /opt/yourtal, the uyourtal pm2 list and yourtal-stack.service.
set -Eeuo pipefail

SRC=${1:?usage: bootstrap.sh <repo-files-dir>}
NODE_VERSION=24.18.0
ATLAS_IMAGE="arigaio/atlas:1.3.3@sha256:07f3f92fa46e684ed789d5ef344a25494a4fa6844ef1ea1fa4e138522c2c37ac"
SITE_USER=uyourtal
Y=/opt/yourtal

log() { printf '[bootstrap] %s\n' "$*"; }
rand() { head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n'; }

install -d -m 755 "$Y/bin" "$Y/stack" "$Y/stack/init"
install -d -m 750 -o "$SITE_USER" -g "$SITE_USER" "$Y/shared" "$Y/shared/policies" "$Y/backups"
install -d -m 700 -o "$SITE_USER" -g "$SITE_USER" "$Y/secrets" "$Y/secrets/keyring"

# --- Node, YourTal's own copy; the system Node belongs to the other sites ---
if [ "$("$Y/node/bin/node" -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  log "installing node $NODE_VERSION"
  tmp=$(mktemp -d)
  base=https://nodejs.org/dist/v$NODE_VERSION
  curl -fsSL "$base/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-v$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sed 's/node-v.*$/node.tar.xz/' | sha256sum -c -)
  rm -rf "$Y/node" && mkdir -p "$Y/node"
  tar -xJf "$tmp/node.tar.xz" -C "$Y/node" --strip-components=1
  rm -rf "$tmp"
fi

# --- atlas: the exact binary the dev wrapper runs, lifted from its pinned image ---
if [ ! -x "$Y/bin/atlas" ]; then
  log "installing atlas"
  cid=$(docker create "$ATLAS_IMAGE")
  docker cp "$cid:/atlas" "$Y/bin/atlas"
  docker rm "$cid" >/dev/null
  chmod 755 "$Y/bin/atlas"
fi
"$Y/bin/atlas" version | head -1

# Waits for unattended upgrades; no job needs ffmpeg yet, so a miss only warns.
command -v ffmpeg >/dev/null ||
  apt-get -o DPkg::Lock::Timeout=300 install -y -qq ffmpeg >/dev/null ||
  log "WARNING: ffmpeg not installed; re-run later"

# --- secrets, generated once on this host; never in the repo or the artifact ---
stack_env=$Y/stack/secrets.env
[ -f "$stack_env" ] || { printf 'POSTGRES_USER=yourtal\nPOSTGRES_PASSWORD=%s\n' "$(rand)" >"$stack_env"; chmod 600 "$stack_env"; }
pg_pass=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$stack_env")
# F58: RustFS's own root credentials.
rustfs_env=$Y/stack/rustfs.env
[ -f "$rustfs_env" ] || { printf 'RUSTFS_ROOT_USER=yourtal\nRUSTFS_ROOT_PASSWORD=%s\n' "$(rand)" >"$rustfs_env"; chmod 600 "$rustfs_env"; }

app_env=$Y/secrets/app.env
if ! grep -q '^LEDGER_SERVICE_SECRET=' "$app_env" 2>/dev/null; then
  [ -f "$app_env" ] && cp -p "$app_env" "$app_env.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  log "writing app.env"
  # Loopback only, so no TLS; atlas (lib/pq) would otherwise insist on it.
  db=127.0.0.1:26432/yourtal?sslmode=disable
  cat >"$app_env" <<EOF
# Generated on Helios by infra/helios/bootstrap.sh. Mode 0600. Never commit.
# Values must stay free of spaces and quotes: bash and node both read this file.
APP_ENV=staging
DATABASE_OWNER_URL=postgres://yourtal:$pg_pass@$db
DATABASE_URL=postgres://yourtal_app:$(rand)@$db
LEDGER_DATABASE_URL=postgres://yourtal_ledger:$(rand)@$db
VOUCHER_DATABASE_URL=postgres://yourtal_voucher:$(rand)@$db
ANALYST_DATABASE_URL=postgres://yourtal_analyst:$(rand)@$db
REDIS_URL=redis://127.0.0.1:26379/0
PDP_BASE_URL=http://127.0.0.1:26304
API_INTERNAL_URL=http://127.0.0.1:26301
LEDGER_MODE=live
LEDGER_BASE_URL=http://127.0.0.1:26302
VOUCHER_BASE_URL=http://127.0.0.1:26303
LEDGER_ADDR=127.0.0.1:26302
VOUCHER_ADDR=127.0.0.1:26303
VOUCHER_KEY_DIR=$Y/secrets/keyring
LEDGER_SERVICE_SECRET=$(rand)
VOUCHER_SERVICE_SECRET=$(rand)
REWARD_ATTESTATION_SECRET=$(rand)
CHECKPOINT_TOKEN_SECRET=$(rand)
HLS_SIGNING_SECRET=$(rand)
# One password for every demo login (2.3.e); read it here, never published (F5).
STAGING_DEMO_PASSWORD=$(rand | cut -c1-20)
EOF
  chown "$SITE_USER:$SITE_USER" "$app_env"
  chmod 600 "$app_env"
fi

# --- voucher keyring, generated once and backed up with the database (2.3.c) ---
for k in voucher_code merchant_hmac voucher_qr; do
  f=$Y/secrets/keyring/$k.v1.key
  [ -f "$f" ] || { rand >"$f"; chmod 400 "$f"; chown "$SITE_USER:$SITE_USER" "$f"; log "generated $k"; }
done

# --- datastores ---
install -m 644 "$SRC/docker-compose.helios.yml" "$Y/stack/docker-compose.helios.yml"
install -m 644 "$SRC/infra/cerbos/config.yaml" "$Y/stack/cerbos.yaml"
install -m 644 "$SRC/infra/postgres/init/"*.sql "$Y/stack/init/"
[ -n "$(ls -A "$Y/shared/policies")" ] || cp -a "$SRC/policies/." "$Y/shared/policies/"
chown -R "$SITE_USER:$SITE_USER" "$Y/shared/policies"
install -m 644 "$SRC/infra/helios/yourtal-stack.service" /etc/systemd/system/yourtal-stack.service
systemctl daemon-reload
systemctl enable --now yourtal-stack.service
systemctl restart yourtal-stack.service

# --- nightly backup (2.3.c): dump + keyring + app.env, root, on a timer ---
install -m 755 "$SRC/infra/helios/backup.sh" "$Y/bin/backup.sh"
install -m 755 "$SRC/infra/helios/restore-rehearsal.sh" "$Y/bin/restore-rehearsal.sh"
install -m 644 "$SRC/infra/helios/yourtal-backup.service" /etc/systemd/system/yourtal-backup.service
install -m 644 "$SRC/infra/helios/yourtal-backup.timer" /etc/systemd/system/yourtal-backup.timer
systemctl daemon-reload
systemctl enable --now yourtal-backup.timer

# --- media bucket and the app's own RustFS user (2.3.i, F58) ---
# Anonymous read is safe only because RustFS is loopback-only: nginx decides
# what is public, and gates /media/hls/ on a signature. The app never gets
# the root key; its user can touch this one bucket and nothing else.
#
# RustFS ships no `mc`/CLI (only its own `rustfs` server binary) and does
# not implement the AWS IAM REST API — its admin surface is its own
# `/rustfs/admin/v3/` API, on the same S3 port, authenticated with plain
# SigV4 (service `s3`, same credential scope as everything else). No
# official client needed: plain `curl --aws-sigv4` works, confirmed against
# a real container. Root sets the public-read policy ONCE here; the app's
# own key can never touch bucket policy again (`ensureStudioMediaBucket()`
# in studio-media.ts only checks it and warns, per this same task).
rustfs_pass=$(sed -n 's/^RUSTFS_ROOT_PASSWORD=//p' "$rustfs_env")
rustfs_endpoint=http://127.0.0.1:9000
rustfs_sigv4() {
  curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "yourtal:$rustfs_pass" "$@"
}
# Bucket create is plain S3 (PUT the bucket URL); idempotent (already-owned
# by us answers 409/200 depending on version, either way harmless here).
rustfs_sigv4 -X PUT "$rustfs_endpoint/yourtal-media" >/dev/null 2>&1 || true
rustfs_sigv4 -X PUT "$rustfs_endpoint/yourtal-media?policy" \
  -H "content-type: application/json" \
  -d '{"Version":"2012-10-17","Statement":[
 {"Sid":"PublicReadStudioMedia","Effect":"Allow","Principal":{"AWS":["*"]},
  "Action":["s3:GetObject"],
  "Resource":["arn:aws:s3:::yourtal-media/hls/*","arn:aws:s3:::yourtal-media/posters/*",
              "arn:aws:s3:::yourtal-media/teasers/*","arn:aws:s3:::yourtal-media/captions/*"]}]}' \
  >/dev/null
# Verify what was just set, as root (the only credential that CAN read
# bucket policy at all — the app's own least-privilege key gets a clean
# AccessDenied on GetBucketPolicy too, by design; found live, 2026-09-28,
# `ensureStudioMediaBucket()`'s own check now quietly no-ops on that
# instead of warning every boot). This is the verification that moved here.
policy_now=$(rustfs_sigv4 "$rustfs_endpoint/yourtal-media?policy")
for prefix in hls posters teasers captions; do
  case "$policy_now" in
  *"arn:aws:s3:::yourtal-media/$prefix/*"*) ;;
  *)
    log "WARNING: bucket policy does not grant public read on $prefix/* after setting it — check RustFS's response above"
    ;;
  esac
done
log "bucket policy verified: public read on hls/, posters/, teasers/, captions/"
if ! grep -q '^S3_ACCESS_KEY=' "$app_env"; then
  s3_secret=$(rand)
  rustfs_sigv4 -X PUT "$rustfs_endpoint/rustfs/admin/v3/add-canned-policy?name=yourtal-media-rw" \
    -H "content-type: application/json" \
    -d '{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::yourtal-media"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::yourtal-media/*"]}]}' \
    >/dev/null
  rustfs_sigv4 -X PUT "$rustfs_endpoint/rustfs/admin/v3/add-user?accessKey=yourtal-app" \
    -H "content-type: application/json" \
    -d "{\"secretKey\":\"$s3_secret\",\"status\":\"enabled\"}" \
    >/dev/null
  rustfs_sigv4 -X PUT "$rustfs_endpoint/rustfs/admin/v3/set-user-or-group-policy?policyName=yourtal-media-rw&userOrGroup=yourtal-app&isGroup=false" \
    >/dev/null
  printf 'S3_ENDPOINT=http://127.0.0.1:26305\nS3_BUCKET=yourtal-media\nS3_ACCESS_KEY=yourtal-app\nS3_SECRET_KEY=%s\n' "$s3_secret" >>"$app_env"
  log "created RustFS user yourtal-app for yourtal-media"
fi

log "done. Next: the first release, then 'pm2 start' per infra/HELIOS.md"

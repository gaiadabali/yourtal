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
minio_env=$Y/stack/minio.env
[ -f "$minio_env" ] || { printf 'MINIO_ROOT_USER=yourtal\nMINIO_ROOT_PASSWORD=%s\n' "$(rand)" >"$minio_env"; chmod 600 "$minio_env"; }

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

log "done. Next: the first release, then 'pm2 start' per infra/HELIOS.md"

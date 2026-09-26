#!/bin/bash
# Nightly backup (2.3.c), run as root by yourtal-backup.timer.
#
# The dump and the keyring are backed up TOGETHER, on purpose: a voucher code
# is unreadable without both — the dump alone is ciphertext, and the keyring
# alone unlocks nothing without the rows it was sealed against
# (services/voucher/internal/keyring's package doc). Restoring one generation
# of dump with a different generation of keyring is exactly the failure this
# script exists to prevent, so it copies whatever is on disk RIGHT NOW for
# both in the same run.
#
# app.env comes along too: restoring the dump into a database whose role
# passwords have since rotated (every deploy calls set-role-passwords.mjs)
# is otherwise a working restore that nothing can connect to.
set -Eeuo pipefail

BACKUP_ROOT=/opt/yourtal/backups
KEEP_DAYS=7
DATE=$(date -u +%F)
DIR="$BACKUP_ROOT/$DATE"

log() { printf '[backup] %s\n' "$*"; }
die() {
  log "FAILED: $*"
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root (docker exec into yourtal-postgres needs it)"

install -d -m 700 "$DIR"

log "pg_dump -> $DIR/yourtal.dump"
docker exec yourtal-postgres pg_dump -U yourtal -Fc yourtal >"$DIR/yourtal.dump.tmp" ||
  die "pg_dump exited non-zero"
mv "$DIR/yourtal.dump.tmp" "$DIR/yourtal.dump"
[ -s "$DIR/yourtal.dump" ] || die "yourtal.dump is empty"

log "keyring -> $DIR/keyring.tar.gz"
tar -czf "$DIR/keyring.tar.gz.tmp" -C /opt/yourtal/secrets keyring ||
  die "tar of the keyring failed"
mv "$DIR/keyring.tar.gz.tmp" "$DIR/keyring.tar.gz"

log "app.env -> $DIR/app.env"
cp -p /opt/yourtal/secrets/app.env "$DIR/app.env.tmp" || die "copying app.env failed"
mv "$DIR/app.env.tmp" "$DIR/app.env"

chmod 600 "$DIR"/yourtal.dump "$DIR"/keyring.tar.gz "$DIR"/app.env
chmod 700 "$DIR"

log "pruning backups older than $KEEP_DAYS days"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} +

log "ok: $DIR"

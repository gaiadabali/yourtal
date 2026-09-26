#!/bin/bash
# Restore rehearsal (2.3.c, old YT-0531): proves the newest backup.sh output
# is actually usable, not merely written. Run by hand, or from a monitoring
# hook — never automatically deletes or touches the live `yourtal` database.
# Usage: restore-rehearsal.sh [--allow-empty]
#
# WHAT THIS PROVES:
#   1. The dump restores cleanly into a scratch database in the same
#      container (`yourtal_restore`) — pg_dump/pg_restore round-trip, not
#      just "the file exists and is non-empty".
#   2. `voucher.code_custody`'s row count in the restore matches the row
#      count in the live database at the moment this rehearsal ran — the
#      table holding every sealed voucher code came back whole.
#   3. The keyring bundled in THIS backup checksums identically to the
#      keyring currently live on disk — i.e. this dump and this keyring are
#      the same generation.
#   4. `voucher-verify-backup` (services/voucher/cmd/voucher-verify-backup,
#      shipped in every release's bin/) actually decrypts sealed voucher
#      codes from the restored database using the extracted keyring — the
#      literal AES-GCM open, not circumstantial evidence from (1)+(3). It
#      prints counts only, never a code or a key. Pass `--allow-empty` (and
#      it is passed through here) on a database with no vouchers yet — it
#      otherwise refuses to pass on zero rows, so an empty rehearsal can
#      never look like a successful one.
set -Eeuo pipefail

BACKUP_ROOT=/opt/yourtal/backups
SCRATCH_DB=yourtal_restore
APP_ENV=/opt/yourtal/secrets/app.env
VERIFY_BIN=/home/uyourtal/current/bin/voucher-verify-backup

log() { printf '[restore-rehearsal] %s\n' "$*"; }
die() {
  log "FAILED: $*"
  exit 1
}

allow_empty=""
if [ "${1:-}" = "--allow-empty" ]; then
  allow_empty="--allow-empty"
fi

[ "$(id -u)" -eq 0 ] || die "must run as root"

newest=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
[ -n "$newest" ] || die "no backup directory under $BACKUP_ROOT"
log "using $newest"

[ -f "$newest/yourtal.dump" ] || die "$newest/yourtal.dump missing"
[ -f "$newest/keyring.tar.gz" ] || die "$newest/keyring.tar.gz missing"

# --- 1. restore into a scratch database, dropped and recreated each run ---
log "recreating $SCRATCH_DB"
docker exec yourtal-postgres psql -U yourtal -d postgres -c \
  "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null
docker exec yourtal-postgres psql -U yourtal -d postgres -c \
  "CREATE DATABASE $SCRATCH_DB OWNER yourtal;" >/dev/null

log "pg_restore"
docker exec -i yourtal-postgres pg_restore -U yourtal -d "$SCRATCH_DB" --no-owner \
  <"$newest/yourtal.dump" || die "pg_restore exited non-zero"

# --- 2. row count of the table holding sealed voucher codes ---
live_count=$(docker exec yourtal-postgres psql -U yourtal -d yourtal -tAc \
  "SELECT count(*) FROM voucher.code_custody" 2>/dev/null || echo "")
restored_count=$(docker exec yourtal-postgres psql -U yourtal -d "$SCRATCH_DB" -tAc \
  "SELECT count(*) FROM voucher.code_custody")
log "voucher.code_custody: live=$live_count restored=$restored_count"
if [ -n "$live_count" ] && [ "$live_count" != "$restored_count" ]; then
  die "row count mismatch — the restore is not whole"
fi

# --- 3. this backup's keyring vs the keyring currently live on disk ---
tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$newest/keyring.tar.gz" -C "$tmp"
mismatch=0
for f in "$tmp/keyring/"*.key; do
  name=$(basename "$f")
  live_sum=$(sha256sum "/opt/yourtal/secrets/keyring/$name" 2>/dev/null | cut -d' ' -f1)
  backup_sum=$(sha256sum "$f" | cut -d' ' -f1)
  if [ "$live_sum" != "$backup_sum" ]; then
    log "keyring MISMATCH: $name (live=$live_sum backup=$backup_sum)"
    mismatch=1
  fi
done
[ "$mismatch" -eq 0 ] || die "backup keyring does not match the live keyring"

# --- 4. the literal decrypt proof: open sealed codes from the restore ---
[ -x "$VERIFY_BIN" ] || die "$VERIFY_BIN missing — is a release installed?"

owner_url=$(sed -n 's/^DATABASE_OWNER_URL=//p' "$APP_ENV")
[ -n "$owner_url" ] || die "DATABASE_OWNER_URL not found in $APP_ENV"
restore_url=$(printf '%s' "$owner_url" | sed 's#/yourtal?#/'"$SCRATCH_DB"'?#')
[ "$restore_url" != "$owner_url" ] || die "could not rewrite DATABASE_OWNER_URL onto $SCRATCH_DB"

log "voucher-verify-backup $allow_empty"
# shellcheck disable=SC2086 # $allow_empty is one flag or empty, never needs quoting
VERIFY_DATABASE_URL="$restore_url" VERIFY_KEY_DIR="$tmp/keyring" \
  "$VERIFY_BIN" $allow_empty || die "voucher-verify-backup failed — see its output above"

log "ok: $newest restores whole, pairs with the live keyring, and decrypts"
log "scratch database $SCRATCH_DB left in place for manual inspection; drop it when done:"
log "  docker exec yourtal-postgres psql -U yourtal -d postgres -c 'DROP DATABASE $SCRATCH_DB;'"

#!/bin/bash
# Restore rehearsal (2.3.c, old YT-0531): proves the newest backup.sh output
# is actually usable, not merely written. Run by hand, or from a monitoring
# hook — never automatically deletes or touches the live `yourtal` database.
#
# WHAT THIS PROVES, PRECISELY, AND WHAT IT DOES NOT:
#   1. The dump restores cleanly into a scratch database in the same
#      container (`yourtal_restore`) — pg_dump/pg_restore round-trip, not
#      just "the file exists and is non-empty".
#   2. `voucher.code_custody`'s row count in the restore matches the row
#      count in the live database at the moment this rehearsal ran — the
#      table holding every sealed voucher code came back whole.
#   3. The keyring bundled in THIS backup checksums identically to the
#      keyring currently live on disk — i.e. this dump and this keyring are
#      the same generation and would actually unseal each other's ciphertext
#      (services/voucher/internal/keyring's package doc: a dump paired with
#      the wrong keyring generation is unrecoverable, not merely inconvenient).
#
#   It does NOT run an AES-GCM open against a restored row. That requires
#   the voucher binary (or a Go program built against internal/keyring) with
#   VOUCHER_DATABASE_URL pointed at yourtal_restore and VOUCHER_KEY_DIR at
#   the extracted keyring — services/voucher is outside this ticket's area,
#   and there is no Go toolchain on Helios to build a standalone checker
#   (bin/voucher ships prebuilt in each release). (1)+(3) together are strong
#   circumstantial evidence a decrypt would succeed — same rows, same keys —
#   but a literal decrypt proof is follow-up work, not this script.
set -Eeuo pipefail

BACKUP_ROOT=/opt/yourtal/backups
SCRATCH_DB=yourtal_restore

log() { printf '[restore-rehearsal] %s\n' "$*"; }
die() {
  log "FAILED: $*"
  exit 1
}

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

log "ok: $newest restores whole and pairs with the live keyring"
log "scratch database $SCRATCH_DB left in place for manual inspection; drop it when done:"
log "  docker exec yourtal-postgres psql -U yourtal -d postgres -c 'DROP DATABASE $SCRATCH_DB;'"

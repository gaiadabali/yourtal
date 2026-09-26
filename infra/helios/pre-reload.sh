#!/bin/bash
# Runs before gaiada-deploy swaps `current` and reloads pm2 (F27): as the site
# user, from the new release's root. Any failure fails the deploy, so the old
# release keeps serving and a half-migrated database is never paired with code
# that expects the other half.
set -Eeuo pipefail

release=$(cd "$(dirname "$0")/.." && pwd)
env_file=/opt/yourtal/secrets/app.env
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

log() { printf '[pre-reload] %s\n' "$*"; }

# 1. Migrations, with the owner credential. --allow-dirty for the same reason
#    as packages/db/scripts/atlas.mjs: the init script creates schemas and roles
#    outside the migration history.
log "atlas migrate apply"
/opt/yourtal/bin/atlas migrate apply \
  --dir "file://$release/migrations" \
  --url "$DATABASE_OWNER_URL" \
  --allow-dirty

# 2. Role passwords. The migrations create the roles with local-only passwords
#    that are public in this repo (F6), so every deploy resets them from app.env.
log "role passwords"
/opt/yourtal/node/bin/node "$release/deploy/set-role-passwords.mjs"

# 3. The minimal demo world (2.3.e). A no-op once any profile exists; the tier-0
#    viewer's pending grant goes through the live ledger, which is still the
#    previous release's and running.
log "staging seed"
/opt/yourtal/node/bin/node "$release/api/dist/seed-staging.js"

# 4. Cerbos policies. The container watches this directory and hot-reloads.
log "cerbos policies"
rsync -a --delete "$release/policies/" /opt/yourtal/shared/policies/

log "ok"

# Helios staging layout

Helios (`server-c`) is shared with ~30 client sites. Reach it with
`ssh helios-w` (`gaiada-setups/access/`). YourTal touches only `/opt/yourtal`,
`/home/uyourtal`, the `yourtal.gaiada.com` vhost and `yourtal*` units, and
everything it runs sits in `yourtal.slice` (2 cores, 4 GB).

## What runs where

| Part                                 | Runs as          | How                                                                          | Updated by            |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------------------- | --------------------- |
| Postgres 18, Valkey, Cerbos, MinIO   | root (docker)    | `docker-compose.helios.yml` in `/opt/yourtal/stack`, `yourtal-stack.service` | `bootstrap.sh` (rare) |
| web, api, worker                     | `uyourtal` (pm2) | `infra/helios/ecosystem.config.cjs`, Node 24 from `/opt/yourtal/node`        | every release         |
| ledger, voucher                      | `uyourtal` (pm2) | static Go binaries in the release's `bin/`                                   | every release         |
| migrations, role passwords, policies | `uyourtal`       | the release's `deploy/pre-reload.sh`                                         | every release         |

The Go services run from the release, not from compose, so a ledger or voucher
change ships with the merge that made it and needs no root step.

## A release

`release.yml` builds one tarball (the agent swaps one `current` per site user,
so everything rides together):

```
apps/web/…  node_modules/   Next standalone (server.js)
api/        worker/         dist/ + production node_modules (pnpm deploy)
bin/ledger  bin/voucher     CGO-free linux/amd64
migrations/ policies/       deploy/  REVISION
```

Signed HLS: nginx has no `secure_link`, so each `/media/hls/` request is checked by
the api (`auth_request` to `/api/internal/hls-auth`, `shared/media-auth`).

`gaiada-poll` installs it through `gaiada-deploy`, which (patched 2026-09-26,
`gaiada-setups/patches/pre-reload-hook.md`) runs `deploy/pre-reload.sh`
**before** the swap: `atlas migrate apply`, `ALTER ROLE … PASSWORD` from
`app.env`, then an rsync of `policies/` into `/opt/yourtal/shared/policies`,
which Cerbos watches. A failure there fails the deploy and the old release keeps
serving. Then it swaps `current`, reloads the five pm2 processes named in
`.gaiadeploy.yml` and health-checks the web port, rolling back on failure.

## Backups (2.3.c)

`yourtal-backup.timer` runs `infra/helios/backup.sh` nightly as root: a
`pg_dump -Fc` of `yourtal`, a tar of the voucher keyring, and a copy of
`app.env`, all under `/opt/yourtal/backups/<UTC date>/` (mode 0700/0600),
pruned after 7 days. The dump and keyring are always taken together — a
dump is unreadable without the keyring generation it was sealed under, and
vice versa. Bootstrapped by `bootstrap.sh`.

`infra/helios/restore-rehearsal.sh` restores the newest backup into a
scratch database (`yourtal_restore`, same container), checks the
`voucher.code_custody` row count and the keyring's checksums against the
live ones, then runs `bin/voucher-verify-backup` (built alongside `ledger`
and `voucher` by `release.yml`, `services/voucher/cmd/voucher-verify-backup`)
against the restore to actually decrypt a sample of sealed voucher codes —
counts only, never a code or a key. Pass `--allow-empty` while staging has
no vouchers yet; the default is strict (zero rows fails). Run it by hand
after any bootstrap or restore-affecting change:
`sudo /opt/yourtal/bin/restore-rehearsal.sh --allow-empty`.

## Drift detection (2.2.c)

`GET /api/health` returns `revision`: the release SHA, read once at API boot
from `REVISION` at the artifact root (pm2's `cwd`; `health.service.ts`).
`.github/workflows/staging-drift.yml` runs daily, compares it to `main`'s
latest release-relevant commit, and fails loudly (with a 30-minute grace
window) if the poller has stopped picking up releases.

## Secrets

- `/opt/yourtal/secrets/app.env` (0600, `uyourtal`): every runtime variable,
  read by Node through `--env-file` and by the Go services through
  `deploy/run-with-env.sh`. Values stay free of spaces and quotes.
- `/opt/yourtal/secrets/keyring/` (0400 files): the voucher master keys.
  Generated once; losing them makes every stored voucher code unreadable, so
  they are backed up with the database (2.3.c).
- `/opt/yourtal/stack/{secrets,minio}.env` (0600, root): container credentials.

The migrations create roles with passwords that are public in this repo; every
deploy replaces them with the ones in `app.env`.

## One-time setup

```bash
# from a checkout of main, copy the files bootstrap needs, then run it as root
tar -czf - docker-compose.helios.yml infra policies | ssh helios-w 'rm -rf /tmp/yt && mkdir /tmp/yt && tar -xzf - -C /tmp/yt && bash /tmp/yt/infra/helios/bootstrap.sh /tmp/yt'
```

It installs Node 24 and `atlas` (lifted from the same pinned image the dev
wrapper uses) under `/opt/yourtal`, `ffmpeg`, generates the secrets and the
keyring, and starts the datastores. After the first release is on disk:

```bash
sudo -u uyourtal -H pm2 delete yourtal-web
sudo -u uyourtal -H pm2 start /home/uyourtal/current/deploy/ecosystem.config.cjs
sudo -u uyourtal -H pm2 save
```

Repeat the delete + start for a process whose ecosystem entry changed: `pm2
reload` keeps the old definition.

## Host prerequisites

- **ffmpeg on `PATH`** for the worker's media jobs (installed by bootstrap).
- **Node 24** (`.nvmrc`) at `/opt/yourtal/node`. The system Node (22) belongs
  to the other sites and is left alone. No pnpm on the box: the release carries
  its `node_modules`.

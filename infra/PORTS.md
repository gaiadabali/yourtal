# Port registry

**This is the one file.** YT-0529's third criterion: _"Every port we take is
recorded in one file; nothing binds `0.0.0.0` that does not have to."_ If
YourTal takes a port anywhere — local compose, Helios, CI — it is written
down here, and anything that binds a non-loopback address states why on the
same line.

No addresses or hostnames appear in this file. See the banner in
`docs/tasks/phase-0-helios.md` for why; the real values live in the private
`gaiada-setups/access/`.

## The rule

**Loopback unless there is a reason, and the reason is written here.**

A service bound to `127.0.0.1` is reachable only through something that has
already decided to let the caller in — nginx, an SSH tunnel, the Docker
network. A service bound to `0.0.0.0` on a box with a public interface is
reachable by anyone the firewall has not specifically excluded, which
inverts the default: instead of listing who may reach it, you are listing
who may not. On a shared box that also means every other tenant on it.

`ufw` is not the answer to this. It is a second control that happens to be
correct today, and a service that only fails closed because of a rule in a
different subsystem fails open the moment that rule is edited by someone who
does not know this service exists.

## The 26xxx scheme

YourTal's local ports live in `26xxx`, chosen so they miss the four other
Postgres instances on the development machine and everything already running
on Helios. **Host-side ports are unique across the whole scheme**;
container-side ports are each service's own native port and repeat freely.

### Local development — `docker-compose.yml`

Every entry below is bound `127.0.0.1` explicitly in the compose file. There
are **no bare `host:container` port lines** — a bare mapping binds all
interfaces, which on a laptop on a café network is the whole problem.

| Host  | Container | Service         |
| ----- | --------- | --------------- |
| 26379 | 6379      | redis (Valkey)  |
| 26432 | 5432      | postgres        |
| 26592 | 3592      | cerbos          |
| 26900 | 9000      | minio (S3 API)  |
| 26901 | 9001      | minio (console) |
| 26910 | 3010      | ledger          |
| 26911 | 3011      | voucher         |

`apps/api` defaults to `PORT=3001` and `apps/web` to `3000` locally; neither
is in the `26xxx` scheme because neither is containerised.

### Slot worktrees — `../yourtal-1|2|3`

Parallel sessions each run in a slot worktree with its own database
(`yourtal_s1|s2|s3`), Valkey DB index (`/1|2|3`) and MinIO bucket
(`yourtal-media-1|2|3`), all on the shared compose stack above. Only the
main checkout runs compose. The ports are set in each worktree's `.env`.

| Slot                                | web   | api   | ledger | voucher | Playwright | offline e2e | Cerbos                     |
| ----------------------------------- | ----- | ----- | ------ | ------- | ---------- | ----------- | -------------------------- |
| 1                                   | 26310 | 26311 | 26312  | 26313   | 26314      | 26316       | 26315                      |
| 2                                   | 26320 | 26321 | 26322  | 26323   | 26324      | 26326       | 26325                      |
| 3                                   | 26330 | 26331 | 26332  | 26333   | 26334      | 26336       | 26335                      |
| 3b (`yourtal-p1-b` helper worktree) | 26336 | 26337 | 26338  | 26339   | 26340      | 26342       | 26335 (shared with slot 3) |
| 3c (`yourtal-p1-c` helper worktree) | 26343 | 26344 | 26345  | 26346   | 26347      | 26349       | 26335 (shared with slot 3) |
| 1b (`yourtal-p4-b` helper worktree) | 26350 | 26351 | 26352  | 26353   | 26354      | 26356       | 26315 (shared with slot 1) |
| 4 (`yourtal-4`, Phase 2)            | 26360 | 26361 | 26362  | 26363   | 26364      | 26366       | 26365                      |

- web and api read `WEB_PORT` and `PORT`; Playwright reads `PLAYWRIGHT_PORT`
  (the offline config adds 2).
- Cerbos runs as the container `yourtal-cerbos-<slot>` via `pnpm dev:cerbos`,
  serving that worktree's `./policies`. Slot 3b has no policy work of its own
  (Phase 1's agent B only touches `packages/jurisdiction`), so it shares
  slot 3's Cerbos container on 26335 instead of running its own.
- The ledger and voucher ports are reserved; until per-slot services exist
  every slot (including 3b) uses the shared containers on 26910 and 26911.
- Slot 3b's web port (26336) is the same number as slot 3's offline-e2e port.
  They do not collide in practice — offline e2e only binds that port for the
  duration of one Playwright run — but do not run slot 3's offline e2e suite
  and slot 3b's `next dev` at the exact same moment.
- Slot 3c (agent C, F23: per-region settings, 1.2.f) is its own isolated
  worktree, database (`yourtal_s3c`), Valkey index (`/5`) and MinIO bucket
  (`yourtal-media-3c`), alongside slots 3 and 3b. It shares slot 3's Cerbos
  container the same way 3b does, since its only policy work is one resource
  file (`platform_setting.yaml`) shipped through the main checkout.
- The media worker runs on the host, not in compose, and needs `ffmpeg` on
  PATH (the dev machine has ffmpeg 8.1.2 from winget). It takes no port.

### Helios

Surveyed live 2026-09-21 ~23:5x. **Both YourTal listeners bind `127.0.0.1`.
Nothing of ours binds `0.0.0.0`.**

| Port  | Bound     | Process        | Notes                                                                  |
| ----- | --------- | -------------- | ---------------------------------------------------------------------- |
| 26300 | 127.0.0.1 | `next-server`  | `apps/web`, run by PM2 under the `uyourtal` account. Fronted by nginx. |
| 26432 | 127.0.0.1 | `docker-proxy` | Postgres container, same host port as local — the scheme transferred.  |
| 26301 | 127.0.0.1 | `node`         | `apps/api` (pm2, `uyourtal`). nginx sends `/api` here. Planned in 2.1. |
| 26302 | 127.0.0.1 | `ledger`       | Go ledger (pm2, `uyourtal`). Called only by api and worker.            |
| 26303 | 127.0.0.1 | `voucher`      | Go voucher service (pm2, `uyourtal`). Called only by api and worker.   |
| 26304 | 127.0.0.1 | `docker-proxy` | Cerbos container.                                                      |
| 26305 | 127.0.0.1 | `docker-proxy` | MinIO S3 API. nginx serves the public media prefixes from it.          |
| 26306 | 127.0.0.1 | `docker-proxy` | MinIO console. Reach it over an SSH tunnel only.                       |
| 26379 | 127.0.0.1 | `docker-proxy` | Valkey container.                                                      |

Both processes sit inside `yourtal.slice`, confirmed from
`/proc/<pid>/cgroup` rather than from the unit file: the Next server reports
`0::/yourtal.slice/pm2-uyourtal.service`, and the Postgres container's scope
is a direct child of the slice. So YT-0530's CPU and memory caps are in
force for the workload that is actually running.

## Two Postgres instances, and why that is the isolation story

`5432` and `26432` are **different Postgres servers**, and the distinction
is load-bearing for YT-0529's second criterion.

| Port  | Bound     | Instance                                                       |
| ----- | --------- | -------------------------------------------------------------- |
| 5432  | 127.0.0.1 | The **host** Postgres. Not ours. Holds client production data. |
| 26432 | 127.0.0.1 | YourTal's Postgres, containerised, inside `yourtal.slice`.     |

Both listening simultaneously is directly observable with `ss -ltn` and was
observed on 2026-09-21. `gaiada-setups`'s deploy registry states the intent
behind it: YourTal's Postgres is deliberately **not** the host instance,
which carries seven client production databases.

So the documented isolation here is **instance separation, not role
separation inside a shared server** — a stronger position, and a different
one from what a reader would assume from `docs/13`'s `yourtal_app` /
`yourtal_ledger` split, which operates _within_ YourTal's own instance.

**What is observed and what is claimed are not the same thing.** Two
separate listeners is observed. That YourTal cannot reach the host
instance is a _claim_ from a config registry, and a registry asserting
isolation is not evidence of isolation. Criterion 2 closes by attempting
the connection and being refused, which needs a privileged session — see
the ticket. Recorded here so the next reader does not mistake the
observable half for the whole.

The blast radius, if it were ever wrong, is those seven databases.

## What is NOT ours, and why it is recorded here anyway

Two processes on Helios bind `0.0.0.0`. **Neither is YourTal's**, both
belong to client sites that predate us on that box, and both were verified
by reading the owning UID rather than inferred from the port number.

They are recorded here without naming the accounts, the sites or the ports.
That is deliberate. `docs/tasks/phase-0-helios.md`'s banner records that this
repository was public for a few hours on 2026-09-20 and that the first
redaction pass "replaced only address literals and missed the names" —
**a redaction list built from one kind of identifier misses every other
kind.** "This named client's backend listens on all interfaces" is targeting
information of exactly the kind that scrub existed to remove, and writing it
into a file whose whole purpose is to be read would reintroduce it in a more
convenient format than before. The details are in `gaiada-setups/access/`.

What belongs here is the operational fact: **the fourth criterion of
YT-0529 is a rule we are holding ourselves to on a box that already breaks
it, and the breakage is not ours to fix.** Anyone surveying this box will
find those two binds and should not spend an afternoon re-establishing whose
they are.

## Two claims in YT-0529 that have expired

Recorded here rather than silently corrected, because the ticket's own text
warns that facts of this shape expire and it is worth knowing it happened.

1. **"No `26xxx` port is in use anywhere on the box."** False as of
   2026-09-21: `26300` and `26432` are both listening. The claim expired
   because **YourTal itself deployed** — the ports are ours. The ticket
   asserted a free range as evidence the scheme would transfer; the scheme
   did transfer, which is what consumed the range.
2. **"Port 3000 is already taken by a `node` process, so `.env.example`'s
   `PORT=3001` does not clash."** Still true, and worth keeping for the
   reason the ticket gives — but note that the process holding `3000` binds
   `*`, not loopback, so it is one of the pre-existing non-YourTal
   violations rather than a neighbour politely staying out of the way.

## Adding a port

1. Take the next free number in `26xxx`. Never reuse one.
2. Bind `127.0.0.1` explicitly. In compose that means
   `"127.0.0.1:<host>:<container>"`, never `"<host>:<container>"`.
3. Add the row here in the same change that opens the port.
4. If it must bind a non-loopback address, say why on its row. "Convenience"
   and "it is behind the firewall" are not reasons.

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

### Helios

Surveyed live 2026-09-21 ~23:5x. **Both YourTal listeners bind `127.0.0.1`.
Nothing of ours binds `0.0.0.0`.**

| Port  | Bound     | Process        | Notes                                                                  |
| ----- | --------- | -------------- | ---------------------------------------------------------------------- |
| 26300 | 127.0.0.1 | `next-server`  | `apps/web`, run by PM2 under the `uyourtal` account. Fronted by nginx. |
| 26432 | 127.0.0.1 | `docker-proxy` | Postgres container, same host port as local — the scheme transferred.  |

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

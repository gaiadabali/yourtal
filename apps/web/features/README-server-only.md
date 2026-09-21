# `server-only`: the enforcement three modules said did not exist

## What this is

`server-only` is a near-empty package whose entire job is to fail the build
if the module importing it ends up in a client graph. It is now installed
(`apps/web/package.json`), and the modules that must never reach a browser
import it on their first line.

## Why it was added

Three modules had already declared themselves server-only, documented that
**nothing enforced it**, and relied on review:

- `features/merchant/provisioning/device-session-cookie.ts:33` — _"The repo
  has no `server-only` package installed to enforce this at build time
  (same gap `get-region.ts` notes); this comment is the only guard until one
  is added."_
- `features/campaign/campaign-data.ts:14` — _"It is not marked with the
  `server-only` package because that package is not in this workspace's
  installed dependencies … the boundary is enforced by review instead."_
- `features/region/get-region.ts:25` — the same gap, cited by the first.

Ten modules in `apps/web` mention `server-only` in a comment. None could
import it, because it was not installed.

**The gap then fired somewhere nobody had commented on.** Under YT-0589,
`yourtal-b6` found the mock backing rate `B` inlined as a literal into a
client chunk — `600*` in `.next/static/chunks/1k_hkqrm9jmjt.js`, confirmed
in a clean `rm -rf .next && next build`. The chain is
`campaign-editor-reward.tsx` (`"use client"`) →
`campaign-reward-risk.ts` → `@yourtal/contracts/money/mock-backing-rate`.

Note **how** it fired. Nobody imported a server module into a client file.
A module that was server-by-default acquired a `"use client"` two hops
above it. "Server by default" is a property that a future `"use client"`
somewhere else silently revokes, which no amount of review at the module
itself would catch.

## Which gate catches what — this distinction matters

Both sabotage proofs below fail the build, but **not via the same control**,
and reading one as evidence for the other would overstate what is protected:

| Sabotaged module | Fails via | Pre-existing? |
| --- | --- | --- |
| `get-region.ts` | `next/headers` | **Yes** — it calls `cookies()`, so Next already guarded it |
| `campaign-data.ts` | **`server-only`** | No — it touches no Next server API, and nothing caught this before |

So `server-only` earns its place on modules that are secret-bearing or
policy-bearing but touch no server API. Those are exactly the ones Next
cannot see, and exactly the ones review was carrying.

## Proved by breaking it, not by seeing it pass

A guard first seen green has not been shown to work. Both markers were
verified by temporarily importing the module into a `"use client"` file and
confirming the build turned red, then reverting in the same step:

```
import * as cd from "@/features/campaign/campaign-data";   // into a "use client" file

Error: Turbopack build failed with 2 errors:
Error: You're importing a module that depends on "server-only".
> 1 | import "server-only";
```

## What is deliberately NOT marked, and why

**`packages/contracts/src/money/mock-backing-rate.ts` is not marked**, so the
mock rate still reaches the client today. That is a considered hold:

1. Marking it would break `campaign-editor-reward.tsx`'s live feedback — the
   business types a reward-points value and sees the reward-to-data-cost
   ratio update as they type. The ratio is
   `(rewardPoints × B) / (estimatedDataMb × dataCostPerMb)`, and both inputs
   are client state, so a live exact ratio requires the constant on the
   client. Removing it is a product decision about what the console shows
   (a number, a band, or a value that updates on blur), not a refactor.
2. The value shipping today is the **mock** rate. The real `B` is an
   economics decision that was unowned until 2026-09-21 (YT-0050).

**The risk this file exists to stop is the next step, not the current one.**
`mock-backing-rate.ts`'s own comment says _"a number that must change in
four places at once is a number that will eventually change in three"_. The
version of that risk here is the opposite and worse: when the real `B` is
settled, the obvious move is to update this one constant — every consumer
already imports it, so **nothing fails**, and the real rate reaches
browsers silently.

`docs/24-legal-positions.md` ID-1 rests on no fixed cash rate being
published, and `B` lives in the ledger schema precisely so `yourtal_app`
cannot read it (YT-0130). A hardcoded copy in a client bundle defeats that
at a layer the `GRANT` cannot see.

**So: a real backing rate must never live in this module.** It belongs in a
new module that imports `server-only` on its first line, leaving the mock
where it is. That way the dangerous moment is a build failure instead of a
decision someone has to remember to make.

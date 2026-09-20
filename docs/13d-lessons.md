# Lessons, part 4 — what the first CI run taught

`docs/13c-lessons.md` reached its 300-line ceiling on the day this was written. It closes with ten gates that reported success while covering less than their names claimed, and with the review question that found them:

> **Not "is this green", nor even "is this asserting the right thing", but: what does this check do with the case it was not shown?**

On **2026-09-20** the repository got a git remote for the first time. Six GitHub Actions workflows that had been written, reviewed, committed, cited as mitigations in the risk register, and **never once executed** ran at last. Every one of them failed. Not one failure was a CI-environment quirk; each had been true in the repository for as long as the workflow existed.

This file is that day, because it is the largest single batch of the same pattern yet found, and because the mechanism was new: not a check that covered too little, but **a check that had never run at all**.

---

## 1. An unrun guarantee is worse than no guarantee

Risk 37 read, in the register, as closed: _"Fixed by `integration.yml` with real service containers and a build failure on any SKIP."_ That sentence describes a workflow which had never started. The register recorded the _writing_ of the mitigation as the _having_ of it.

No mitigation would have left the risk visibly open. A written one closed it — and closed it in the artefact the team uses to decide what to worry about next.

**Rule: a mitigation is a thing that has run.** Until it has, record it as proposed, and say where the evidence will come from.

## 2. Silence is indistinguishable from success

All six workflows trigger on `branches: [main]`. The branch was `master`.

Had the remote been added without noticing, every push would have produced exactly what a passing CI produces from a distance: no red. The failure mode of a misconfigured trigger is **nothing happening**, which looks identical to nothing being wrong.

This is the same shape as a skipped test reporting green, and as `t.Skipf` without Postgres — the family `docs/13c` documents. It is worth stating separately because the mechanism sits _outside the code entirely_, in a YAML field nobody reads twice.

**Rule: prove CI runs by making it fail first.** A pipeline whose first observed state is green has not been shown to run. Push a deliberate break, watch the red, fix it, watch the green.

## 3. A compensating control that shares a root cause is not a control

The best of the three failures.

`integration.yml` ran Cerbos as a `services:` container, mounting `policies/` and `infra/cerbos/config.yaml` from `${{ github.workspace }}`. GitHub creates service containers **before** the job's first step — before `actions/checkout` — so that directory is empty at mount time.

The author knew. The comment said so, and argued it was covered: `storage.disk.watchForChanges: true` would make Cerbos pick the policies up once checkout ran.

**That setting lives in `config.yaml`, which failed to mount for the identical reason.** The path did not exist, so Docker created a _directory_ at `/config/config.yaml`; Cerbos logged `Loading configuration from __default__` and `Found 0 executable policies`; the healthcheck then ran `--config=/config/config.yaml` against a directory and failed. **The mitigation was disabled by the fault it was mitigating.**

**Rule: when a control compensates for a fault, ask what the control depends on. If the answer includes anything the fault also touches, it is not a control.** This generalises risk 41's suspicion of simulators to every compensating mechanism.

A second lesson sits inside the first: **health is not readiness.** A PDP that starts with zero policies is _healthy_ and answers DENY to everything — it looks like a working authorization server while refusing every request. The wait step now asserts that policies loaded, not that the container is up.

## 4. Local green can be an artefact of a dirty working directory

`apps/web` linted clean here and produced **48 errors** on CI, all `no-unnecessary-type-assertion` on `as Route`.

The rule is type-aware. Next's `typedRoutes` generates `Route` into `.next/types`. This machine had `.next` lying around from earlier builds, so `Route` was the strict union and every cast was necessary. A clean checkout has never built, `Route` degrades to `string`, and all 48 casts read as no-ops.

`turbo.json` declared `lint: {}` — no build dependency — while `typecheck` declared `dependsOn: ["^build"]`. So a type-aware linter ran against types that existed or not depending on whose machine it was.

Confirmed by moving `.next/types` aside and reproducing **exactly 48**, the same count CI gave. Fixed with `next typegen` wired as a turbo dependency of `@yourtal/web`'s lint and typecheck. The casts were right; the environment was wrong.

**Rule: if a check consults generated artefacts, it must declare them as inputs.** Otherwise its result is a property of the machine, not of the code.

A footgun found while doing it: turbo's `package#task` syntax takes the **package name**, not the directory. `apps/web#typegen` matches nothing, applies no dependency, and emits **no error and no warning**.

## 5. Two commands over two file sets predict nothing about each other

CI ran `eslint apps packages`. Each package's own script was `eslint src`. Different file sets — so local green said nothing about CI, and CI's 72 errors were unreproducible locally: it was parsing the MPEG-TS media fixtures as TypeScript, which `eslint src` never reached.

Both were wrong in opposite directions. The narrow one missed files; the broad one linted video. CI now runs `turbo run lint`, the same command as local.

**Rule: the gate developers run and the gate that blocks a merge are the same command — or they are two gates, and only one of them is tested.**

## 6. The declaration and the bytes can disagree in silence

`.gitattributes` declared `* text=auto eol=lf`. Twenty-seven files sat on disk with CRLF. `git status` was clean throughout, and `git add --renormalize .` staged **zero files** — git compares content _after_ normalisation, so the index was already right and it saw nothing to do.

It surfaced as something else entirely: Atlas refused the migration directory with `20260920000011_idr_sen.sql was edited`. It had not been edited. `atlas.sum` was generated here from CRLF bytes; CI checks out LF. **Eleven** entries changed on re-hash, not one, because `atlas.sum` is a hash chain and a break at position 12 invalidates every entry after it.

**Rule: a declaration nobody checks is a comment.** `scripts/check-line-endings.mjs` now fails when on-disk endings disagree with the declared attribute — and it asks **git** for that attribute rather than keeping a second list that could drift from the first.

## 7. A cached pass is not a pass

Two instances on one day. `pnpm verify` answered green in **45ms**: `Cached: 11 cached, 11 total >>> FULL TURBO`. And `go test ./...` printed `ok (cached)` for a package whose invariant test **fails** when actually run.

Both are correct behaviour. Neither answers the question a gate is asked. A cache says "inputs unchanged since some earlier run" — and that earlier run may have happened without Postgres, on a different branch, or before the thing you are about to trust it for.

**Rule: when a green result is about to authorise something — a promotion to `done`, a merge, a deploy — force the run.** `-count=1` is mandatory for Go in this repo for exactly this reason, and the flags are documented in the service manifests so whoever tidies next does not remove them as noise.

---

## The pattern, restated

`docs/13c` asked what a check does with the case it was not shown. Today adds the question that comes _before_ it:

> **Has this check ever run — on this code, in this environment, without a cache answering for it?**

Almost everything found on 2026-09-20 was invisible to every form of reading: the file, the assertion, the config, the risk register. Each became visible the moment something executed for real.

The cheapest way to learn whether a guarantee holds is unchanged from `13c`: break what it is meant to catch, and confirm the break reached the code. The addition is that you must first confirm **there is code for it to reach**.

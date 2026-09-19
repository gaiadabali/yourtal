# Task format

The task files in this folder are **the single source of truth for project status**. `TASKS.md` at the repo root is _generated_ from them and must never be edited by hand.

```
node scripts/tasks.mjs           # validate + regenerate the dashboard
node scripts/tasks.mjs --check   # validate + fail if stale  (CI gate)
```

## One task

```markdown
### YT-0042 · Ledger: double-entry transfer API
`todo` · P0 · value · 5d · dep: YT-0031, YT-0033

- [ ] `transfer()` writes ≥2 entries summing to zero, in one transaction
- [ ] `idempotency_key` is UNIQUE; a replay returns the original transfer
- [ ] invariant checker job fails loudly on any imbalance
```

| Field        | Rule                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| **ID**       | `YT-####`, globally unique, **never reused or renumbered**. Take the next free number. |
| **Title**    | `Area: what it does`. One line.                                                        |
| **Status**   | `todo` · `doing` · `review` · `blocked` · `done` · `cut`                               |
| **Phase**    | `P-1` · `P0` · `P1` · `P2` · `P3`                                                      |
| **Epic**     | lowercase slug — see below                                                             |
| **Estimate** | `3d` or `6h`. Ideal engineering time, one person.                                      |
| **dep:**     | comma-separated task IDs, or `—`. Validated; cycles are rejected.                      |
| **AC**       | at least one `- [ ]` line. Testable, not aspirational.                                 |

## Epics

`pilot` · `legal` · `infra` · `platform` · `value` · `economy` · `adplatform` · `media` · `watch` · `store` · `commerce` · `merchant` · `risk` · `web` · `data` · `seo`

## Rules

1. **A task is `done` only when every AC box is ticked.** The validator enforces it.
2. **`blocked` means blocked by something outside the task graph** (a decision, a vendor, a licence). Waiting on another task is not blocked — that is `dep:`, and the dashboard works it out.
3. **No task larger than 5 days.** If it is bigger, split it. Large tasks hide risk.
4. **Every task names its acceptance criteria before work starts.** No AC, no start.
5. **Never renumber.** `cut` tasks stay in the file with `cut` status so history stays readable.
6. Regenerate the dashboard in the same commit as any task change. CI fails otherwise.

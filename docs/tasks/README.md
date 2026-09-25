# Archived: the v1 task board (2026-09-19 → 2026-09-22)

**Superseded on 2026-09-25 by [`TASKS.md`](../../TASKS.md).** Nothing here is current. Do not update it, and do not run the generator.

This folder is kept, not deleted, for two reasons. Code comments across `apps/web` cite ticket text in these files (for example "`docs/tasks/phase-u-ui.md` YT-0422"). And some tickets carry reasoning the new plan links back to with "(was YT-xxxx)".

| File | What it was |
| --- | --- |
| `phase-*.md` | The 306 tickets, by old phase |
| `_schema.md` | The ticket format and status rules |
| `_board-v1-dashboard.md` | The generated `TASKS.md` as it stood at `b225116` |
| `_generator-v1.mjs` | `scripts/tasks.mjs`, which generated that dashboard and was gated in CI |
| `_pre-commit-v1.sh` | The `.githooks/pre-commit` that regenerated the dashboard on every commit |
| `_cross-session-register.md` | A snapshot of what earlier sessions were blocked on (2026-09-22). Its founder questions are carried into `TASKS.md` → *Decisions for the founder* |
| `_yt-0451-session-protocol.md` | The protocol for the pilot sessions (old YT-0451) |

**Why it was replaced:** the audit found that "done" on this board mostly meant "the library passes its own tests". About 83 tickets were marked done while no screen read real data. See [`docs/audit/2026-09-25/infra-process.md`](../audit/2026-09-25/infra-process.md) §B.

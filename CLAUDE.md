# YourTal — working rules

**The plan is [`TASKS.md`](TASKS.md).** Read it before doing anything: **one session runs one phase**, and _Running order_ says which phases can run now. It also says what your phase's area owns and what is next. The evidence behind each task is in [`docs/audit/2026-09-25/`](docs/audit/2026-09-25/). Design docs `docs/00`–`docs/25` are reference; where they disagree with `TASKS.md`, `TASKS.md` wins.

## The rule: update TASKS.md as you go

The founder follows progress through `TASKS.md` and should never have to ask. So:

1. **Starting a task:** append `— 🔄 slot <n>` to its line, and update your slot's row in **Now**.
2. **Finishing a subtask:** tick it `[x]` **immediately**, then run `node C:/Users/Hansel/Documents/Hansel/Projects/yourtal/scripts/progress.mjs`. One tick per finished subtask, as it happens. Never batch ticks at the end of a task or a session.
3. **Finishing a task:** only when every subtask is ticked and its **Check** has passed on merged `main`. Mark it `✅ YYYY-MM-DD <sha>`, add a line to the top of **Log**, update **Now**, and commit `TASKS.md`.
4. **Blocked:** append `— ⛔ <reason>` and take your next unblocked task.
5. **New work:** add it as a subtask or task with the next free ID. Never delete one; mark it `— ✂️ cut: <reason>`.

Always edit the **main checkout's** `TASKS.md` at `C:/Users/Hansel/Documents/Hansel/Projects/yourtal/TASKS.md`, never the copy in your worktree. Edit only your own phase's lines. Work in task order within your phase, and respect each task's `needs:`.

## When you need the founder

Ask with `AskUserQuestion`, never in open prose. Give 2–4 options, **with the recommended one first and labelled "(Recommended)"**, and one line on what each option means. Record the answer in `TASKS.md` → _Decisions for the founder_. Until they answer, proceed with the recommended option, and say that you did.

## How to work

- **One phase per session, in a slot worktree** (`../yourtal-1`, `-2`, `-3`) on a `phase/<n>` branch. The main checkout stays on `main`, with no code edits; it is for `TASKS.md`, fast-forward merges and pushes. The exact commands are in `TASKS.md` → _Session protocol_.
- **Stay inside your phase's area** (`TASKS.md` → _Areas and ownership_). If you need something another area owns, add a `(requested by X)` subtask to its task and build against the contract or the fake meanwhile. When your phase is done, or everything left in it is ⛔, free your slot in **Now** and stop.
- **Done means it works end to end:** an HTTP round trip plus the database row it should write, or screenshots at 390 px and 1280 px, light and dark, with axe clean. A library passing its own tests is not done.
- **Money is exact.** Integer minor units only, and a currency on every amount (AUD exponent 2, IDR exponent 0). The server computes every price. B (the backing rate) never reaches a client. Every point not paid for by a business is backed by reserve cash at the moment of issue (K6).
- **AU and ID are separate economies.** Every user, business, campaign, point, rate, voucher and setting belongs to exactly one region, and nothing crosses. Enforce this in the database, the ledger and Cerbos, not only in the UI.
- **No user-to-user interaction anywhere:** no comments, direct messages, public profiles, public likes or view counts, leaderboards or user uploads. Copy says "earn points" and "rewards", never "get paid", "money" or "income".
- **English (en-AU) is the default.** Every user-facing string lives in the next-intl catalogues, in both `en-AU` and `id-ID`. Never write copy that cites ticket IDs, docs or "prototype".
- **Everything external is a simulated driver** (payments, email, SMS, KYB, moderation). Helios holds demo data only (red line 11).
- **Commit at clean boundaries as you go.** A quota cut-off mid-task loses uncommitted work.
- **Keep it short.** Comments say why in a line or two. No essays, no new process docs, no lessons files. The 300-line guideline applies to new source files.
- **Never** force-push `main`, rewrite pushed history, hand-edit `pnpm-lock.yaml`, or edit an existing migration.

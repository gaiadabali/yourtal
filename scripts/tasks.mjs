#!/usr/bin/env node
// Single source of truth for project status.
// Parses docs/tasks/*.md, validates, and regenerates the dashboard in TASKS.md.
//   node scripts/tasks.mjs          → validate + rewrite dashboard
//   node scripts/tasks.mjs --check  → validate + fail if dashboard is stale (CI)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASKS_DIR = join(ROOT, "docs", "tasks");
const DASHBOARD = join(ROOT, "TASKS.md");
const CHECK = process.argv.includes("--check");

const STATUSES = ["todo", "doing", "review", "blocked", "done", "cut"];
const PHASES = ["PU", "P-1", "P0", "P1", "P2", "P3"];
const PHASE_LABEL = {
  PU: "Phase U · UI first  ◀ NEXT",
  "P-1": "Phase −1 · Pilot",
  P0: "Phase 0 · Foundations",
  P1: "Phase 1 · Indonesia MVP",
  P2: "Phase 2 · Depth",
  P3: "Phase 3 · Marketplace & AU",
};

const HEAD = /^### (YT-\d{4}) · (.+)$/;
const META =
  /^`(\w+)`\s*·\s*(P-?\d|PU)\s*·\s*([a-z][a-z0-9-]*)\s*·\s*(\d+[dh])\s*(?:·\s*dep:\s*(.+?))?\s*$/;

const errors = [];
const tasks = [];

function parseFile(file) {
  const lines = readFileSync(join(TASKS_DIR, file), "utf8").split(/\r?\n/);
  let cur = null;
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    const head = HEAD.exec(line);
    if (head) {
      cur = { id: head[1], title: head[2], file, line: i + 1, ac: 0, done: 0 };
      tasks.push(cur);
      return;
    }
    if (!cur) return;
    if (line.startsWith("`")) {
      const m = META.exec(line.trim());
      if (!m) {
        errors.push(`${at}  malformed meta line for ${cur.id}: ${line}`);
        return;
      }
      const [, status, phase, epic, est, dep] = m;
      if (!STATUSES.includes(status)) errors.push(`${at}  bad status "${status}"`);
      if (!PHASES.includes(phase)) errors.push(`${at}  bad phase "${phase}"`);
      Object.assign(cur, {
        status,
        phase,
        epic,
        est,
        deps: dep && dep.trim() !== "—" ? dep.split(",").map((d) => d.trim()) : [],
      });
      return;
    }
    if (/^\s*- \[[ x]\]/.test(line)) {
      cur.ac++;
      if (/^\s*- \[x\]/.test(line)) cur.done++;
      // Rule 8. An unticked criterion whose text OPENS with a strikethrough is
      // one its author has declared dead while leaving it blocking, so the
      // ticket can never reach its own bar. "- 🚫" is the form for retired
      // work (see _schema.md "Bullet forms"), and it is a note, not a box.
      //
      // Anchored at the start of the criterion text deliberately, rather than
      // testing whether the line contains a strikethrough anywhere. The loose
      // form was the one proposed, and it would have been a false positive on
      // YT-0130, whose criterion strikes a quoted fragment of its own former
      // wording mid-line while remaining a live, unmet bar. Three matches
      // loose, two anchored, and the two anchored ones are the real defects.
      if (/^\s*- \[ \]\s*~~/.test(line)) {
        errors.push(
          `${at}  ${cur.id} has a struck-through criterion that is still blocking — ` +
            `use "- 🚫" for work a decision has retired, per _schema.md`,
        );
      }
    }
  });
}

readdirSync(TASKS_DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort()
  .forEach(parseFile);

// ---- validation -------------------------------------------------------------
const byId = new Map();
for (const t of tasks) {
  if (byId.has(t.id)) errors.push(`duplicate id ${t.id} (${t.file} and ${byId.get(t.id).file})`);
  byId.set(t.id, t);
  if (!t.status) errors.push(`${t.file}:${t.line}  ${t.id} has no meta line`);
  if (!t.ac) errors.push(`${t.file}:${t.line}  ${t.id} has no acceptance criteria`);
}
for (const t of tasks) {
  for (const d of t.deps ?? []) {
    if (!byId.has(d)) errors.push(`${t.id} depends on unknown task ${d}`);
  }
  // `review` means the work is finished and only independent verification is
  // outstanding, so every criterion must already be ticked — the same bar as
  // `done`, minus the verifier.
  //
  // Without this rule `review` became a parking bay. On 2026-09-20 it held 84
  // tasks, **43 of them with unticked criteria**, under a dashboard heading
  // that reads "work complete" — five of those sat at 0 of n. A status that
  // constrains nothing cannot be read as a claim about anything, and this one
  // was being read as the project's progress.
  if ((t.status === "done" || t.status === "review") && t.ac !== t.done) {
    errors.push(
      `${t.id} is ${t.status} but ${t.ac - t.done} acceptance ${t.ac - t.done === 1 ? "criterion is" : "criteria are"} unticked` +
        (t.status === "review" ? " — move it to `doing`, or tick what is genuinely met" : ""),
    );
  }
}
// dependency cycles
const seen = new Map();
function walk(id, stack) {
  if (stack.includes(id)) return errors.push(`dependency cycle: ${[...stack, id].join(" → ")}`);
  if (seen.get(id)) return;
  seen.set(id, true);
  for (const d of byId.get(id)?.deps ?? []) walk(d, [...stack, id]);
}
for (const t of tasks) walk(t.id, []);

// ---- dashboard --------------------------------------------------------------
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const open = (t) => !["done", "cut"].includes(t.status);
const blockedBy = (t) => (t.deps ?? []).filter((d) => byId.get(d) && open(byId.get(d)));

// Downstream reach: every OPEN task that would stop waiting, directly or
// transitively, if this one settled.
//
// Transitive rather than direct, because direct dependents undercount exactly
// the thing this board keeps rediscovering by hand. YT-0012 has two direct
// dependents and sits under the whole 92-day `store` pricing chain via
// YT-0049 → YT-0048; a "2" next to it reads as a leaf and it is the gate.
// That finding was written into YT-0131 as a "⚠️ structural finding" by a
// session that had to trace the chain manually to see it. A number the
// generator can compute should not cost a session an afternoon.
const dependents = new Map();
for (const t of tasks) {
  for (const d of t.deps ?? []) {
    if (!dependents.has(d)) dependents.set(d, []);
    dependents.get(d).push(t.id);
  }
}
function downstreamOf(id) {
  const seen = new Set();
  const stack = [...(dependents.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...(dependents.get(c) ?? []));
  }
  return seen;
}
const reach = (id) => [...downstreamOf(id)].filter((c) => byId.get(c) && open(byId.get(c))).length;

function table(rows, headers) {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

const lines = [];
lines.push(`_Generated by \`scripts/tasks.mjs\` — do not edit by hand._`, "");

const total = tasks.filter((t) => t.status !== "cut");
const doneAll = total.filter((t) => t.status === "done");
// The headline used to read "0 / 273 tasks done (0%)" — true, and badly
// misleading. `done` means INDEPENDENTLY VERIFIED, and nothing had been swept
// yet, so the one number a reader takes at a glance said no progress had been
// made on a project with 41 finished features. The founder said so directly —
// "there should be more progress than what is reported there" — and was right.
//
// Reporting work state and verification state as SEPARATE figures fixes it
// without inflating anything: finished-but-unverified is real progress and
// also really unverified, and one number cannot carry both.
const reviewAll = tasks.filter((t) => t.status === "review");
const doingAll = tasks.filter((t) => t.status === "doing");
const blockedAll = tasks.filter((t) => t.status === "blocked");
const todoAll = tasks.filter((t) => t.status === "todo");
// Two predicates, because "ready" was one word doing two jobs and the board
// published the looser one under the stronger name.
//
// `readyNow` is the honest headline: every dependency is `done` or `cut`, so
// nothing is in anyone's way. `readyWhenLanded` additionally counts deps that
// are merely `doing` or `review` — real information, since work that has
// started usually finishes, but NOT a claim that someone can pick the task up
// today.
//
// The gap was not marginal. On 2026-09-21 the `Ready` column read **72** while
// only **27** were genuinely unblocked: **45 tasks, 62% of the column, had a
// blocker that was merely started.** `yourtal-b6` lost an afternoon to one of
// them — YT-0133, offered as ready with deps YT-0130 (`doing`) and YT-0042
// (`review`), where two of its four saga steps turn out to be a 501 and a
// service with no route at all.
//
// The dashboard also contained BOTH definitions at once and disagreed with
// itself: this column counted `doing` deps as satisfied while the "Ready to
// start (no open dependencies)" list below used `blockedBy`, which does not.
// Same word, two numbers, one page.
const CUT_OR_DONE = new Set(["done", "cut"]);
const IN_FLIGHT = new Set(["done", "cut", "review", "doing"]);
const estDays = (e) => {
  const n = Number.parseFloat(e);
  return Number.isNaN(n) ? 0 : /h$/.test(e) ? n / 8 : n;
};
const readyNow = (t) =>
  t.status === "todo" && (t.deps ?? []).every((d) => CUT_OR_DONE.has(byId.get(d)?.status));
const readyWhenLanded = (t) =>
  t.status === "todo" &&
  !readyNow(t) &&
  (t.deps ?? []).every((d) => IN_FLIGHT.has(byId.get(d)?.status));

// Remaining effort is the only column that answers "how far from finish".
// Task counts cannot: thirty 1-hour tasks and thirty 5-day tasks read
// identically at 0% settled, and the second is forty times the work.
//
// Counted over todo + doing + blocked, so a half-finished task still bills
// its whole estimate. Deliberately pessimistic: the alternative is guessing
// what fraction of a `doing` task is behind us, and this board has just been
// through a round of exactly that kind of guess being wrong in the optimistic
// direction. An estimate that cannot be checked should read high, not low.
const remaining = (ts) =>
  ts
    .filter((t) => t.status === "todo" || t.status === "doing" || t.status === "blocked")
    .reduce((sum, t) => sum + estDays(t.est), 0);

const finished = doneAll.length + reviewAll.length;
// Two denominators, because they answer different questions and disagree here.
// Percent-of-TASKS is what a board reports; percent-of-EFFORT is what a date
// rests on. They diverge because the settled work is not a random sample of
// the board — the small, well-understood tasks went first, so task-count
// progress runs ahead of effort progress and will keep doing so.
const totalDays = total.reduce((sum, t) => sum + estDays(t.est), 0);
const leftDays = remaining(total);
lines.push(
  `**${total.length} tasks** — **${finished} finished (${pct(finished, total.length)}%)** · ` +
    `${doingAll.length} in progress · ${todoAll.length} not started · ${blockedAll.length} blocked`,
  "",
  `**${Math.round(leftDays)} engineer-days left of ${Math.round(totalDays)}** — ` +
    `**${pct(totalDays - leftDays, totalDays)}% of the estimated effort is settled**, against ` +
    `${pct(finished, total.length)}% of the task count.` +
    " Effort counts every `todo`, `doing` and `blocked` task at its FULL estimate, so a" +
    " half-finished task bills in full. These are ideal engineer-days for one person —" +
    " divide by real throughput, not by headcount.",
  "",
  `Of the ${finished} finished: **${doneAll.length} independently verified**, ` +
    `${reviewAll.length} awaiting a verifier. A task is only DONE when a session ` +
    "other than the one that did the work has checked it. **The two reviews sampled " +
    "so far were both wrong**, so that queue is work rather than a formality.",
  "",
);

// The per-phase and per-epic narrative used to be hand-written prose sitting
// ABOVE the AUTO markers, where `--check` never looked. That is how a row
// reading "Australia's public surface returns 404" survived a full day after
// it stopped being true and cost three sessions time — and the heading was
// itself the false claim, so fixing the cell would have left the assertion
// standing as the title.
//
// The rule this encodes: **prose that states a fact about the board is output,
// and output belongs inside the markers.** Anything a generator cannot derive
// is intent, not status, and intent belongs in `docs/tasks/`, next to the work.
//
// Deliberately NOT harvested from the `# Phase …` / `## …` headings in the task
// files. Phases cross-cut files (`phase-0-platform.md` alone carries P0, P1 and
// PU) and the `##` groupings are not epics at all — `## Voucher` holds YT-0140,
// whose epic is `value`. Harvesting would have published a heading's prose
// against the wrong slice and looked authoritative doing it.
function narrate(ts, label) {
  if (!ts.length) return `- ${label} — _no tasks._`;
  const d = ts.filter((t) => t.status === "done").length;
  const r = ts.filter((t) => t.status === "review").length;
  const g = ts.filter((t) => t.status === "doing").length;
  const b = ts.filter((t) => t.status === "blocked").length;
  const ready = ts.filter(readyNow).length;
  const soon = ts.filter(readyWhenLanded).length;
  const left = Math.round(remaining(ts));
  const parts = [
    `**${d + r} of ${ts.length} settled** (${d} verified · ${r} awaiting a verifier)`,
    `${g} in progress`,
    `**${left}d** left`,
    ready ? `**${ready} ready to start**` : "**nothing ready to start now**",
  ];
  // Stated separately rather than added in. A task whose blocker is merely
  // started is a forecast, and folding a forecast into the headline is what
  // made the old number wrong.
  if (soon) parts.push(`${soon} more once in-flight dependencies land`);
  if (b) parts.push(`${b} blocked outside the graph`);
  let s = `- ${label} — ${parts.join(" · ")}.`;
  // The widest gate answers "what one thing most needs finishing", which
  // neither a percentage nor a remaining-day count can. Ties break on id so
  // the dashboard is stable between runs that changed nothing.
  const gate = ts
    .filter(open)
    .map((t) => ({ t, n: reach(t.id) }))
    .sort((a, z) => z.n - a.n || a.t.id.localeCompare(z.t.id))[0];
  if (gate && gate.n > 0) {
    s +=
      ` Widest gate: **${gate.t.id}** \`${gate.t.epic}\` \`${gate.t.status}\`` +
      ` — **${gate.n}** open ${gate.n === 1 ? "task" : "tasks"} downstream.`;
  }
  return s;
}

lines.push("### By phase", "");
lines.push(
  table(
    PHASES.filter((p) => tasks.some((t) => t.phase === p)).map((p) => {
      const ts = tasks.filter((t) => t.phase === p && t.status !== "cut");
      const d = ts.filter((t) => t.status === "done").length;
      const r = ts.filter((t) => t.status === "review").length;
      const g = ts.filter((t) => t.status === "doing").length;
      // Settled = done + review. Enforced above: a task may only be `review`
      // with every criterion ticked, so this genuinely is work complete with
      // only the gate outstanding. Before that rule existed it was not.
      const bar = "█"
        .repeat(Math.round(pct(d, ts.length) / 10))
        .padEnd(Math.round(pct(d + r, ts.length) / 10), "▓")
        .padEnd(10, "░");
      return [
        PHASE_LABEL[p],
        `${d}/${ts.length}`,
        String(r),
        String(g),
        `${Math.round(remaining(ts))}d`,
        `\`${bar}\` ${pct(d + r, ts.length)}%`,
      ];
    }),
    ["Phase", "Done", "Review", "Doing", "Left", "Settled"],
  ),
  "",
  ...PHASES.filter((p) => tasks.some((t) => t.phase === p)).map((p) =>
    narrate(
      tasks.filter((t) => t.phase === p && t.status !== "cut"),
      `**${PHASE_LABEL[p]}**`,
    ),
  ),
  "",
);

// Epics answer a different question from phases: "where can I put someone
// today". A Done-only column could not answer it — with nothing yet through
// the review gate it read 0% for every epic, which is true and useless.
// `Ready` is the load-bearing column: todo tasks whose dependencies are all
// settled. `Left` is the work still to do, so a small Ready over a large Left
// reads as a bottleneck rather than as progress.

lines.push("### By epic", "");
const epics = [...new Set(tasks.map((t) => t.epic))].filter(Boolean).sort();
lines.push(
  table(
    epics.map((e) => {
      const ts = tasks.filter((t) => t.epic === e && t.status !== "cut");
      const d = ts.filter((t) => t.status === "done").length;
      const r = ts.filter((t) => t.status === "review").length;
      const g = ts.filter((t) => t.status === "doing").length;
      const ready = ts.filter(readyNow).length;
      const soon = ts.filter(readyWhenLanded).length;
      const left = remaining(ts);
      const bar = "█"
        .repeat(Math.round(pct(d, ts.length) / 10))
        .padEnd(Math.round(pct(d + r, ts.length) / 10), "▓")
        .padEnd(10, "░");
      return [
        `\`${e}\``,
        `${d}/${ts.length}`,
        String(r),
        String(g),
        (ready ? `**${ready}**` : "—") + (soon ? ` +${soon}` : ""),
        `${Math.round(left)}d`,
        `\`${bar}\` ${pct(d + r, ts.length)}%`,
      ];
    }),
    ["Epic", "Done", "Review", "Doing", "Ready", "Left", "Settled"],
  ),
  "",
  "**`Ready`** counts tasks whose every dependency is `done` or `cut` — work" +
    " someone can pick up today. **`+n`** is how many more become available once" +
    " dependencies already in flight land: a forecast, not an offer. They used to" +
    " be summed under the first heading, which overstated it by **45 tasks**.",
  "",
  ...epics.map((e) =>
    narrate(
      tasks.filter((t) => t.epic === e && t.status !== "cut"),
      `\`${e}\``,
    ),
  ),
  "",
);

const inReview = tasks.filter((t) => t.status === "review");
lines.push("### In review (work complete, gate not yet passed)", "");
lines.push(
  inReview.length
    ? inReview
        .map((t) => `- **${t.id}** \`${t.epic}\` ${t.title} — ${t.done}/${t.ac} AC ticked`)
        .join("\n")
    : "_Nothing in review._",
  "",
);

const doing = tasks.filter((t) => t.status === "doing");
lines.push("### In progress", "");
lines.push(
  doing.length
    ? doing.map((t) => `- **${t.id}** ${t.title} — ${t.done}/${t.ac} AC`).join("\n")
    : "_Nothing in progress._",
  "",
);

const blocked = tasks.filter((t) => t.status === "blocked");
lines.push("### Blocked", "");
lines.push(
  blocked.length ? blocked.map((t) => `- **${t.id}** ${t.title}`).join("\n") : "_Nothing blocked._",
  "",
);

const ready = tasks
  .filter((t) => t.status === "todo" && blockedBy(t).length === 0)
  .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.id.localeCompare(b.id));
lines.push("### Ready to start (no open dependencies)", "");
lines.push(
  ready.length
    ? ready
        .slice(0, 25)
        .map((t) => `- **${t.id}** \`${t.epic}\` ${t.title} · ${t.est}`)
        .join("\n") + (ready.length > 25 ? `\n- _…and ${ready.length - 25} more_` : "")
    : "_Nothing ready._",
  "",
);

const waiting = tasks.filter((t) => t.status === "todo" && blockedBy(t).length);
lines.push("### Waiting on dependencies", "");
lines.push(
  waiting.length
    ? waiting
        .slice(0, 20)
        .map((t) => `- **${t.id}** ${t.title} → waiting on ${blockedBy(t).join(", ")}`)
        .join("\n")
    : "_Nothing waiting._",
  "",
);

// ---- write ------------------------------------------------------------------
if (errors.length) {
  console.error("Task validation failed:\n" + errors.map((e) => `  ✗ ${e}`).join("\n"));
  process.exit(1);
}

const START = "<!-- AUTO:DASHBOARD -->";
const END = "<!-- /AUTO:DASHBOARD -->";
// Normalise to LF on READ, so the generated file cannot inherit CRLF from
// whatever last touched it. `.gitattributes` declares TASKS.md as eol=lf,
// and a writer that PRESERVES the endings it finds quietly defeats that
// declaration: one CRLF write upstream and every regeneration keeps it.
//
// Not hypothetical — on 2026-09-20 two sessions hit check:eol failures on
// files in this cluster, and the propagator was that preserve-what-you-find
// pattern copied through a dozen ad-hoc edit scripts. Preserving is the
// wrong default when the correct ending is DECLARED rather than inferred.
const src = readFileSync(DASHBOARD, "utf8").split(/\r\n/).join("\n");
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a === -1 || b === -1) {
  console.error(`TASKS.md is missing the ${START} … ${END} markers.`);
  process.exit(1);
}
const next = `${src.slice(0, a + START.length)}\n\n${lines.join("\n").trimEnd()}\n\n${src.slice(b)}`;

if (CHECK) {
  if (next !== src) {
    console.error("TASKS.md dashboard is stale. Run: node scripts/tasks.mjs");
    process.exit(1);
  }
  console.log(`✓ ${tasks.length} tasks valid, dashboard current.`);
} else {
  writeFileSync(DASHBOARD, next);
  console.log(`✓ ${tasks.length} tasks valid, dashboard regenerated.`);
}

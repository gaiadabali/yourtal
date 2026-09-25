#!/usr/bin/env node
// Recounts the checkboxes in TASKS.md and rewrites the progress table between
// the <!-- progress:start --> and <!-- progress:end --> markers.
//
// The checkboxes are the source of truth; this table is a summary of them.
// Not a CI gate: a stale table is fixed by running this, never by a red build.
//
//   node scripts/progress.mjs            rewrite the table in place
//   node scripts/progress.mjs --print    print the table, change nothing
//
// Line shapes it understands (see "How to update this file" in TASKS.md):
//   ## Phase 4 — The bank is correct · Area A · ~9d
//   - [ ] **4.2 Burn saga** — 🔄 slot 2       task, in progress
//   - [x] **4.2 Burn saga** — ✅ 2026-09-30 1a2b3c4
//     - [ ] 4.2.a Reserve stock ...           subtask
//   A task line containing ⛔ counts as blocked; one containing ✂️ (cut) is
//   not counted at all, and neither are its subtasks.

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "TASKS.md");
const lock = join(root, "TASKS.md.lock");
const START = "<!-- progress:start -->";
const END = "<!-- progress:end -->";
const printOnly = process.argv.includes("--print");

// The live board is the MAIN checkout's TASKS.md. A track worktree has its own
// copy; rewriting that one hides progress and later blocks the ff-merge.
try {
  const git = (arg) =>
    resolve(root, execFileSync("git", ["rev-parse", arg], { cwd: root }).toString().trim());
  if (!printOnly && git("--git-dir") !== git("--git-common-dir")) {
    console.error("progress.mjs: this is a worktree copy. Run the main checkout's script:");
    console.error("  node C:/Users/Hansel/Documents/Hansel/Projects/yourtal/scripts/progress.mjs");
    process.exit(1);
  }
} catch {
  // not a git checkout (e.g. a tarball): nothing to guard
}

// Three sessions tick this file; hold a lock across read-modify-write.
let lockFd = null;
if (!printOnly) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      lockFd = openSync(lock, "wx");
      break;
    } catch {
      if (Date.now() > deadline) {
        console.error(
          `progress.mjs: ${lock} is held; if no session is running this script, delete it.`,
        );
        process.exit(1);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
const release = () => {
  if (lockFd !== null) {
    closeSync(lockFd);
    unlinkSync(lock);
    lockFd = null;
  }
};

const text = readFileSync(file, "utf8");
const lines = text.split("\n");

const phases = [];
let current = null;
let cut = false; // subtasks under a task marked ✂️ are not counted either
for (const line of lines) {
  const heading = line.match(
    /^## (Phase [0-9]+) — (.+?)(?: · (Areas? [A-C+ ]+|All areas))?(?: · (~[^·]+))?\s*$/,
  );
  if (heading) {
    current = {
      id: heading[1],
      title: heading[2].trim(),
      track: (heading[3] ?? "").replace(/^Areas? /, "").replace("All areas", "all"),
      tasks: 0,
      tasksDone: 0,
      doing: 0,
      blocked: 0,
      subs: 0,
      subsDone: 0,
    };
    phases.push(current);
    continue;
  }
  if (/^## /.test(line)) {
    current = null;
    continue;
  }
  if (!current) continue;
  const task = line.match(/^- \[( |x)\] \*\*\d+\.\d+/);
  if (task) {
    cut = line.includes("✂️");
    if (cut) continue;
    current.tasks += 1;
    if (task[1] === "x") current.tasksDone += 1;
    else if (line.includes("⛔")) current.blocked += 1;
    else if (line.includes("🔄")) current.doing += 1;
    continue;
  }
  const sub = line.match(/^\s+- \[( |x)\] \d+\.\d+\.[a-z]/);
  if (sub && !cut) {
    current.subs += 1;
    if (sub[1] === "x") current.subsDone += 1;
  }
}

const bar = (done, total) => {
  if (total === 0) return "`░░░░░░░░░░`   0%";
  const pct = Math.round((done / total) * 100);
  const filled = Math.round(pct / 10);
  return "`" + "█".repeat(filled) + "░".repeat(10 - filled) + "` " + String(pct).padStart(3) + "%";
};

const status = (p) => {
  if (p.tasks > 0 && p.tasksDone === p.tasks) return "✅ done";
  if (p.blocked > 0 && p.doing === 0) return "⛔ blocked";
  if (p.doing > 0 || p.subsDone > 0 || p.tasksDone > 0) return "🔄 in progress";
  return "· not started";
};

const total = phases.reduce(
  (acc, p) => ({
    tasks: acc.tasks + p.tasks,
    tasksDone: acc.tasksDone + p.tasksDone,
    subs: acc.subs + p.subs,
    subsDone: acc.subsDone + p.subsDone,
  }),
  { tasks: 0, tasksDone: 0, subs: 0, subsDone: 0 },
);

const rows = [
  "| Phase | Area | Status | Tasks | Subtasks | Progress |",
  "| --- | --- | --- | --- | --- | --- |",
  ...phases.map(
    (p) =>
      `| **${p.id}** ${p.title} | ${p.track || "—"} | ${status(p)} | ${p.tasksDone}/${p.tasks} | ${p.subsDone}/${p.subs} | ${bar(p.subsDone, p.subs)} |`,
  ),
  `| **All** | | | **${total.tasksDone}/${total.tasks}** | **${total.subsDone}/${total.subs}** | ${bar(total.subsDone, total.subs)} |`,
];
const table = rows.join("\n");

if (printOnly) {
  console.log(table);
  process.exit(0);
}

const s = text.indexOf(START);
const e = text.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  release();
  console.error(`TASKS.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
const next = text.slice(0, s + START.length) + "\n" + table + "\n" + text.slice(e);
try {
  if (next !== text) writeFileSync(file, next);
} finally {
  release();
}
console.log(
  `progress: ${total.subsDone}/${total.subs} subtasks, ${total.tasksDone}/${total.tasks} tasks`,
);

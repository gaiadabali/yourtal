#!/usr/bin/env node
// Keeps packages/mail-engine/src a byte-for-byte copy of SnapApp's mail engine
// (spambank/BUILD.md B4). SnapApp (public gaiadabali/snap-app) is the source of
// truth: change the engine there, merge, then run this.
//
//   node scripts/sync-mail-engine.mjs                  copy snap-app main -> src/
//   node scripts/sync-mail-engine.mjs --check          exit 1 if src/ differs from snap-app main
//   node scripts/sync-mail-engine.mjs --from <dir>     use a local snap-app checkout instead of cloning
//
// Text is compared and written with LF endings (.gitattributes pins eol=lf), the
// target is mirrored (files gone from the source are removed), nothing is rewritten.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(REPO, "packages", "mail-engine", "src");
const SNAP_REMOTE = "https://github.com/gaiadabali/snap-app.git";
const SNAP_PATH = join("packages", "mail-engine", "src");

function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

const lf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** A sparse, shallow clone of snap-app main: only the engine source. */
function cloneSnapApp() {
  const dir = mkdtempSync(join(tmpdir(), "snap-app-"));
  execFileSync(
    "git",
    ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", SNAP_REMOTE, dir],
    { stdio: "inherit" },
  );
  git(dir, "sparse-checkout", "set", "packages/mail-engine/src");
  return dir;
}

function main(argv) {
  const check = argv.includes("--check");
  const fromAt = argv.indexOf("--from");
  const local = fromAt >= 0 ? argv[fromAt + 1] : undefined;
  const root = local ? resolve(local) : cloneSnapApp();
  try {
    const source = join(root, SNAP_PATH);
    const files = listFiles(source);
    if (files.length === 0) {
      console.error(`no engine files under ${source}`);
      return 2;
    }
    let commit = "unknown";
    try {
      commit = git(root, "rev-parse", "HEAD");
    } catch {
      // not a git checkout
    }

    const have = listFiles(TARGET);
    if (check) {
      const problems = [];
      for (const f of files) {
        if (!have.includes(f)) problems.push(`missing: ${f}`);
        else if (lf(join(source, f)) !== lf(join(TARGET, f))) problems.push(`differs: ${f}`);
      }
      for (const f of have) if (!files.includes(f)) problems.push(`extra: ${f}`);
      if (problems.length > 0) {
        console.error(`packages/mail-engine/src is out of step with snap-app ${commit}:`);
        console.error(`  ${problems.join("\n  ")}`);
        return 1;
      }
      console.log(`packages/mail-engine/src matches snap-app ${commit} (${files.length} files)`);
      return 0;
    }

    for (const f of have) if (!files.includes(f)) rmSync(join(TARGET, f));
    for (const f of files) {
      const to = join(TARGET, f);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, lf(join(source, f)));
    }
    console.log(`Synced ${files.length} files from snap-app@${commit} to packages/mail-engine/src`);
    return 0;
  } finally {
    if (!local) rmSync(root, { recursive: true, force: true });
  }
}

process.exit(main(process.argv.slice(2)));

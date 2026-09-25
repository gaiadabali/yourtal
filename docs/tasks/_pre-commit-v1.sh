#!/usr/bin/env sh
# Keeps TASKS.md's generated dashboard in step with docs/tasks/*.md on EVERY commit.
#
# Why a hook and not a habit: the dashboard is generated, so a commit that
# changes a task file and not TASKS.md records a figure that was already wrong
# when it was written. This session had that drift repeatedly -- regeneration
# was remembered most of the time, which is the same as a gate that is green
# most of the time.
#
# Five gates were found this week that passed without covering what their name
# implied, so: this hook FAILS the commit if the generator errors. It does not
# silently continue.
set -e

# Only act when a task file or the dashboard is part of this commit.
if git diff --cached --name-only | grep -qE '^(docs/tasks/.*\.md|TASKS\.md)$'; then

  # The generator reads every file in docs/tasks/ FROM THE WORKING TREE,
  # tracked or not. So if any of them has changes that are not staged, the
  # dashboard written below describes a tree the commit will not contain --
  # and the CI check fails at that commit while passing locally, because
  # locally the tree and the dashboard agree with each other.
  #
  # Not hypothetical, and not rare. It happened twice on 2026-09-21, both
  # times to the session that owns this file:
  #
  #   1af4639  docs/tasks/phase-0-web.md was UNTRACKED -- nine tickets split
  #            out of another file. The tree held 294 ticket blocks and the
  #            dashboard said "294 tasks", so the counts agreed and only the
  #            generated detail diverged. A count cannot see a reorganisation.
  #
  #   daf407b  TASKS.md committed on its own while three task files sat dirty.
  #
  # The second happened AFTER the first was diagnosed, written up and
  # committed. That is the argument for a guard rather than a rule: the author
  # of the rule broke it within two hours while actively holding it in mind.
  UNSTAGED=$(git status --porcelain -- docs/tasks | grep -vE '^[MARD] ' | sed 's/^...//')
  if [ -n "$UNSTAGED" ]; then
    echo "pre-commit: refusing to regenerate TASKS.md." >&2
    echo "" >&2
    echo "These paths under docs/tasks/ have changes that are NOT staged:" >&2
    echo "$UNSTAGED" | sed 's/^/  /' >&2
    echo "" >&2
    echo "The dashboard is generated from all of them as they are ON DISK, so" >&2
    echo "committing it now records a board this commit does not contain." >&2
    echo "CI regenerates from the commit and fails, while the same command" >&2
    echo "passes in your tree." >&2
    echo "" >&2
    echo "Either stage them, or leave TASKS.md out of this commit. If they are" >&2
    echo "another session's work, ask before staging -- own blocks, not files." >&2
    exit 1
  fi

  node scripts/tasks.mjs
  git add TASKS.md
fi

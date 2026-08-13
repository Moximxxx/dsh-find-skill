#!/usr/bin/env bash
# release-to-main.sh — merge develop into main, excluding dev-only files.
#
# Branch contract:
#   develop — full working branch; tracks EVERYTHING, including .dsh/ and
#             AGENTS.md (changes to those files commit and push normally).
#   main    — clean release branch; its tree never contains .dsh/ or AGENTS.md.
#
# How it works: run the real merge, then strip the two dev-only paths from
# main's index before committing, so every main tree stays clean while the
# merge history remains intact. The strip never touches develop.
#
# Usage: run from a clean worktree (any branch). Conflicts abort the script
# so they can be resolved by hand.
set -euo pipefail

DEV_FILES=(.dsh AGENTS.md)
START_BRANCH=$(git branch --show-current)

if [ -n "$(git status --porcelain)" ]; then
  echo "error: worktree is not clean; commit or stash first" >&2
  exit 1
fi

git checkout main
git pull --ff-only origin main 2>/dev/null || true

if ! git merge --no-commit --no-ff develop; then
  echo "error: merge conflicts; resolve them on main, then commit manually" >&2
  echo "hint: after resolving, run: git rm -r --cached --quiet ${DEV_FILES[*]} && rm -rf -- ${DEV_FILES[*]} && git commit" >&2
  git checkout ${START_BRANCH}
  exit 1
fi

# Strip dev-only paths from main's tree (safe: they remain tracked on develop).
git rm -r --cached --quiet "${DEV_FILES[@]}" 2>/dev/null || true
rm -rf -- "${DEV_FILES[@]}"

if git diff --cached --quiet; then
  echo "main is already up to date with develop"
  git merge --abort 2>/dev/null || true
else
  git commit --no-edit -q
  echo "main updated from develop (dev-only files excluded)"
fi

git push origin main
git checkout ${START_BRANCH}
echo "done"

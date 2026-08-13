#!/usr/bin/env bash
# release-to-main.sh — merge develop into main, excluding dev-only files.
#
# Branch contract:
#   develop — full working branch; tracks EVERYTHING, including .dsh/ and
#             AGENTS.md (changes to those files commit and push normally).
#   main    — clean release branch; its tree never contains .dsh/ or AGENTS.md.
#
# How it works: run the real merge (-X theirs so content conflicts resolve to
# develop), then strip the two dev-only paths from main's index before
# committing, so every main tree stays clean while the merge history remains
# intact. The strip never touches develop. The only conflicts git can report
# here are modify/delete on the stripped paths (main deleted them once; develop
# keeps changing them); those are resolved by removal. Any other unmerged
# entry aborts the script for manual resolution.
#
# Usage: run from a clean worktree (any branch).
set -euo pipefail

DEV_FILES=(.dsh AGENTS.md)
START_BRANCH=$(git branch --show-current)

if [ -n "$(git status --porcelain)" ]; then
  echo "error: worktree is not clean; commit or stash first" >&2
  exit 1
fi

git checkout main
git pull --ff-only origin main 2>/dev/null || true

# -X theirs: main is defined as "develop's content, minus dev-only files", so
# content conflicts resolve to develop. Modify/delete conflicts on the stripped
# paths are expected and resolved below by removal.
git merge -X theirs --no-commit --no-ff develop || true

# Resolve modify/delete conflicts on the dev-only paths by deletion.
git rm -f --quiet --ignore-unmatch -r -- "${DEV_FILES[@]}" 2>/dev/null || true
rm -rf -- "${DEV_FILES[@]}"

# Fail loudly if unexpected conflicts remain (anything besides the two paths).
if git diff --name-only --diff-filter=U | grep -q .; then
  echo "error: unexpected conflicts remain on main:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "resolve them on main, then run: git commit" >&2
  git checkout "${START_BRANCH}" 2>/dev/null || true
  exit 1
fi

if git diff --cached --quiet; then
  echo "main is already up to date with develop"
  git merge --abort 2>/dev/null || true
else
  git commit --no-edit -q
  echo "main updated from develop (dev-only files excluded)"
fi

git push origin main
git checkout "${START_BRANCH}"
echo "done"

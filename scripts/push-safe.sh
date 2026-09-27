#!/usr/bin/env bash
# Pushes to GitHub ONLY if every check passes. Use this instead of `git push`:
#
#   scripts/push-safe.sh
#
# 1. The working tree must be clean (what is tested is exactly what is pushed).
# 2. Your branch must not be behind GitHub (pull first).
# 3. Data validator.
# 4. Build: the committed index.html / damage.html must match a fresh build.
# 5. Every browser test: service worker, accessibility, no-JavaScript, freshness, redirect site.
# 6. Push, then wait for GitHub's "Check data and deploy" and "Site tests" and report them.
#
# Stops at the first problem and pushes nothing. Needs Node 22+, Chrome, git; gh for step 6.
# Takes about 5–8 minutes. The .githooks/pre-push hook refuses pushes that don't come from here.

set -euo pipefail
cd "$(dirname "$0")/.."

LOG_DIR=$(mktemp -d)
trap 'rm -rf "$LOG_DIR"' EXIT
step() { printf '\n▶ %s\n' "$1"; }
fail() { printf '\n✗ %s\n  Nothing was pushed.\n' "$1" >&2; exit 1; }

# Runs a check quietly; on failure shows its output and stops.
check() {
  local name="$1"; shift
  local log="$LOG_DIR/$(echo "$name" | tr -c 'a-zA-Z0-9' '_').log"
  if "$@" > "$log" 2>&1; then
    printf '  ✓ %s: %s\n' "$name" "$(grep -E '✓ All|✅|Built index' "$log" | tail -1 | sed 's/^ *//')"
  else
    printf '  ✗ %s failed. Last lines:\n' "$name"
    grep -E '✗|❌|Error|      - ' "$log" | head -20 | sed 's/^/    /'
    tail -3 "$log" | sed 's/^/    /'
    fail "$name failed."
  fi
}

step "Working tree is clean"
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "There are uncommitted changes. Commit (or stash) them first, so that what is tested is what is pushed."
fi

branch=$(git rev-parse --abbrev-ref HEAD)
step "Up to date with GitHub ($branch)"
git fetch -q origin
behind=$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo 0)
[ "$behind" = "0" ] || fail "origin/$branch has $behind commit(s) you don't have. Run: git pull --rebase"
ahead=$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo 1)
if [ "$ahead" = "0" ]; then echo "  Nothing to push."; exit 0; fi
echo "  $ahead commit(s) to push:"; git log --oneline "origin/$branch..HEAD" | sed 's/^/    /'

step "Data and build"
check "validator" node scripts/validate.mjs
check "build" node scripts/embed-fallback.mjs
if ! git diff --quiet -- index.html damage.html; then
  git diff --stat -- index.html damage.html | sed 's/^/    /'
  fail "The build changed index.html/damage.html, so the committed pages were out of date. Review and commit them (git add index.html damage.html && git commit -m \"Rebuild pages\"), then run this again."
fi

step "Browser tests (a few minutes)"
check "service worker"        node scripts/test-sw.mjs
check "accessibility/layout"  node scripts/test-a11y.mjs
check "no JavaScript"         node scripts/test-nojs.mjs
check "freshness warnings"    node scripts/test-freshness.mjs
check "redirect site"         node scripts/test-redirect.mjs

step "All checks passed: pushing"
sha=$(git rev-parse HEAD)
PUSH_SAFE=1 git push origin "$branch"

if ! command -v gh > /dev/null; then echo "  (gh not installed: check the Actions tab yourself)"; exit 0; fi
step "Waiting for GitHub (deploy and Site tests)"
for _ in $(seq 1 90); do
  total=$(gh run list --commit "$sha" --json status --jq 'length' 2>/dev/null || echo 0)
  pending=$(gh run list --commit "$sha" --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo 1)
  if [ "$total" -ge 1 ] && [ "$pending" = "0" ]; then break; fi
  sleep 10
done
gh run list --commit "$sha" --json workflowName,conclusion --jq '.[] | "  \(if .conclusion == "success" then "✓" else "✗" end) \(.workflowName): \(.conclusion)"'
if gh run list --commit "$sha" --json conclusion --jq '.[].conclusion' | grep -qv '^success$'; then
  printf '\n✗ Pushed, but a GitHub workflow did not succeed. See the Actions tab.\n' >&2
  exit 1
fi
printf '\n✓ Pushed and green.\n'

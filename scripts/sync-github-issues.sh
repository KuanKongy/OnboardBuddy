#!/usr/bin/env bash
# Sync doc/BUGS_AND_FIXES.md to GitHub Issues.
#
# doc/BUGS_AND_FIXES.md is the single source of truth. This script parses its
# `## [P<n>][State] Bug <N>: <title>` blocks and files/closes the matching issues,
# so the tracker cannot drift from the document.
#
#   scripts/sync-github-issues.sh --dry-run          # print the gh commands, run nothing
#   scripts/sync-github-issues.sh                    # file + close the default range (53-74)
#   scripts/sync-github-issues.sh --from 65 --to 74  # only the M4 backlog
#
# Requires an authenticated gh for the repo's host:
#   gh auth login -h github.students.cs.ubc.ca
#
# Issue numbers on GitHub are assigned by GitHub and will NOT equal the Bug N in
# this document unless the issues are filed in order into an empty tracker. The
# body of every issue therefore starts with "Bug #N" so the two can be matched by
# search; the script also refuses to file a bug whose title already exists.
set -euo pipefail

DOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/doc/BUGS_AND_FIXES.md"
DRY_RUN=0
FROM=53
TO=74

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --from)    FROM="$2"; shift 2 ;;
    --to)      TO="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$DOC" ]] || { echo "cannot find $DOC" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '  '; printf '%q ' "$@"; printf '\n'
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" == 0 ]] && ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated for this repo's host." >&2
  echo "Run: gh auth login -h github.students.cs.ubc.ca" >&2
  exit 1
fi

# Ensure the labels we apply exist (idempotent; gh errors on duplicates are ignored).
for p in P0 P1 P2 P3 P4 P5; do
  run gh label create "$p" --description "Bug priority $p" --color EDEDED 2>/dev/null || true
done
run gh label create "milestone-4" --description "Found or fixed in Milestone 4" --color 1D76DB 2>/dev/null || true
run gh label create "security" --description "Security finding or fix" --color B60205 2>/dev/null || true

# Existing titles, so re-running the script does not duplicate issues.
EXISTING=""
if [[ "$DRY_RUN" == 0 ]]; then
  EXISTING="$(gh issue list --state all --limit 400 --json title --jq '.[].title')"
fi

filed=0
skipped=0

# Line numbers of every bug heading, so a block can be sliced out precisely.
# (Built with a read loop rather than `mapfile`, which macOS's bash 3.2 lacks.)
HEADS=()
while IFS= read -r line; do
  HEADS+=("$line")
done < <(grep -nE '^## \[P[0-5]\]\[[^]]+\] Bug [0-9]+:' "$DOC")

for i in "${!HEADS[@]}"; do
  entry="${HEADS[$i]}"
  start="${entry%%:*}"
  heading="${entry#*:}"

  num="$(sed -E 's/^## \[P[0-5]\]\[[^]]+\] Bug ([0-9]+):.*/\1/' <<<"$heading")"
  prio="$(sed -E 's/^## \[(P[0-5])\].*/\1/' <<<"$heading")"
  state="$(sed -E 's/^## \[P[0-5]\]\[([^]]+)\].*/\1/' <<<"$heading")"
  title="$(sed -E 's/^## \[P[0-5]\]\[[^]]+\] Bug [0-9]+: (.*)$/\1/' <<<"$heading")"

  (( num >= FROM && num <= TO )) || continue

  # Block ends at the next bug heading, or EOF for the last one.
  if (( i + 1 < ${#HEADS[@]} )); then
    next="${HEADS[$((i + 1))]}"
    end=$(( ${next%%:*} - 1 ))
  else
    end="$(wc -l < "$DOC")"
  fi

  body="$(sed -n "$((start + 1)),${end}p" "$DOC")"
  full_title="Bug ${num}: ${title}"

  if [[ -n "$EXISTING" ]] && grep -Fxq "$full_title" <<<"$EXISTING"; then
    echo "= skip (already filed): $full_title"
    skipped=$((skipped + 1))
    continue
  fi

  labels="$prio,milestone-4"
  case "$num" in
    63|64|65|66) labels="$labels,security" ;;
  esac

  echo "+ ${state}: $full_title  [$labels]"

  if [[ "$DRY_RUN" == 1 ]]; then
    run gh issue create --title "$full_title" --label "$labels" --body "<body from $DOC lines $((start + 1))-$end>"
  else
    url="$(gh issue create --title "$full_title" --label "$labels" --body "$body")"
    echo "  -> $url"
    if [[ "$state" == "Closed" || "$state" == "Won't-Fix" ]]; then
      reason="Fixed in Milestone 4 — see the \"Notes during fixing\" section of the issue body."
      [[ "$state" == "Won't-Fix" ]] && reason="Closed as Won't-Fix — see the Notes section of the issue body."
      gh issue close "$url" --comment "$reason"
      echo "  -> closed"
    fi
  fi
  filed=$((filed + 1))
done

echo
echo "filed/updated: $filed   already present: $skipped   range: #$FROM-#$TO"
[[ "$DRY_RUN" == 1 ]] && echo "(dry run — nothing was sent to GitHub)"

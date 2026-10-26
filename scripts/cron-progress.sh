#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/skootsky/coding-projects/dyad"
LOG_DIR="$PROJECT_DIR/.cron-logs"
LOCK_FILE="$PROJECT_DIR/.cron.lock"
PROMPT_FILE="$PROJECT_DIR/scripts/cron-prompt.txt"
MODEL="opencode/beam-free"

mkdir -p "$LOG_DIR"

# Prevent overlapping runs
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) another run in progress; skipping" >> "$LOG_DIR/skip.log"
  exit 0
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/run-$RUN_ID.log"

cd "$PROJECT_DIR"

echo "=== run $RUN_ID start ===" >> "$LOG_FILE"

# Run opencode non-interactively
PROMPT="$(cat "$PROMPT_FILE")"
if opencode run --standalone --auto --model "$MODEL" --format json "$PROMPT" >> "$LOG_FILE" 2>&1; then
  echo "opencode exit: 0" >> "$LOG_FILE"
else
  echo "opencode exit: $? (see log)" >> "$LOG_FILE"
fi

# Safety net: if agent left uncommitted changes but didn't commit, commit them
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain)" ]; then
  echo "uncommitted changes detected; committing safety net" >> "$LOG_FILE"
  git add -A
  if git commit -m "cron: auto-progress $RUN_ID" >> "$LOG_FILE" 2>&1; then
    echo "safety commit done" >> "$LOG_FILE"
  fi
fi

echo "=== run $RUN_ID end ===" >> "$LOG_FILE"

# Keep only last 50 logs
ls -1t "$LOG_DIR"/run-*.log 2>/dev/null | tail -n +51 | xargs -r rm -f

#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/skootsky/coding-projects/dyad"
LOG_DIR="$PROJECT_DIR/.cron-logs"
LOCK_FILE="$PROJECT_DIR/.cron.lock"
STOP_FILE="$PROJECT_DIR/.cron-stop"
PROMPT_FILE="$PROJECT_DIR/scripts/cron-prompt.txt"
MODEL="opencode/beam-free"
MAX_RUNS_BLOCKED=3
BLOCKED_COUNTER_FILE="$PROJECT_DIR/.cron-blocked-count"

mkdir -p "$LOG_DIR"

# ---- Kill switch ----
if [ -f "$STOP_FILE" ]; then
  echo "$(date -Is) STOP FILE EXISTS — exiting" >> "$LOG_DIR/skip.log"
  exit 0
fi

# ---- Blocked-run counter ----
BLOCKED_COUNT=0
if [ -f "$BLOCKED_COUNTER_FILE" ]; then
  BLOCKED_COUNT=$(cat "$BLOCKED_COUNTER_FILE")
fi
if [ "$BLOCKED_COUNT" -ge "$MAX_RUNS_BLOCKED" ]; then
  echo "$(date -Is) $BLOCKED_COUNT consecutive blocked runs — stopping (touch .cron-stop to reset)" >> "$LOG_DIR/skip.log"
  touch "$STOP_FILE"
  exit 0
fi

# ---- Prevent overlapping runs ----
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) another run in progress; skipping" >> "$LOG_DIR/skip.log"
  exit 0
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/run-$RUN_ID.log"

cd "$PROJECT_DIR"

# ---- Work on a dedicated branch, not master ----
BRANCH="cron/auto"
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout -q "$BRANCH"
else
  git checkout -q -b "$BRANCH" master
fi

echo "=== run $RUN_ID start ===" >> "$LOG_FILE"

PROMPT="$(cat "$PROMPT_FILE")"
OPENCODE_EXIT=0
if opencode run --standalone --auto --model "$MODEL" --format json "$PROMPT" >> "$LOG_FILE" 2>&1; then
  echo "opencode exit: 0" >> "$LOG_FILE"
else
  OPENCODE_EXIT=$?
  echo "opencode exit: $OPENCODE_EXIT (see log)" >> "$LOG_FILE"
fi

# ---- Safety net: commit if agent left uncommitted changes ----
SAFETY_NET_TRIGGERED=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain)" ]; then
  SAFETY_NET_TRIGGERED=true
  echo "WARNING: safety net triggered — agent did not commit its own work" >> "$LOG_FILE"
  echo "WARNING: safety net triggered at $(date -Is)" >> "$LOG_DIR/safety-net.log"
  git add -A
  git commit -m "cron: safety-net commit $RUN_ID (agent did not commit)" >> "$LOG_FILE" 2>&1 || true
fi

# ---- Test gate: run npm test ----
TESTS_PASSED=false
if bun run test >> "$LOG_FILE" 2>&1; then
  TESTS_PASSED=true
  echo "npm test: PASS" >> "$LOG_FILE"
else
  echo "npm test: FAIL (see log)" >> "$LOG_FILE"
fi

# ---- Decide: commit or block ----
if [ "$TESTS_PASSED" = "true" ]; then
  # Reset blocked counter
  echo 0 > "$BLOCKED_COUNTER_FILE"

  # If there are uncommitted changes (agent made progress but didn't commit), commit them
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain)" ]; then
    git add -A
    # Use a descriptive commit message from the agent's work
    COMMIT_MSG="cron: auto-progress $RUN_ID"
    # Try to extract a better message from REVIEW.md or git diff
    if git diff --cached --name-only | grep -q "GOALS.md"; then
      COMMIT_MSG="cron: progress toward goals ($RUN_ID)"
    fi
    git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1 || true
  fi
  echo "run $RUN_ID: COMMITTED" >> "$LOG_FILE"
else
  # Tests failed — do not commit. Increment blocked counter.
  BLOCKED_COUNT=$((BLOCKED_COUNT + 1))
  echo "$BLOCKED_COUNT" > "$BLOCKED_COUNTER_FILE"
  echo "run $RUN_ID: BLOCKED (tests failed, counter=$BLOCKED_COUNT)" >> "$LOG_FILE"
  # Revert working tree to last commit to keep branch clean
  git checkout -- . 2>/dev/null || true
  git clean -fd 2>/dev/null || true
fi

# ---- Merge back to master if tests passed and we're on cron branch ----
# (Disabled by default — user merges manually. Uncomment to auto-merge.)
# if [ "$TESTS_PASSED" = "true" ]; then
#   git checkout -q master
#   git merge --no-ff "$BRANCH" -m "merge: cron progress $RUN_ID" >> "$LOG_FILE" 2>&1 || true
# fi

echo "=== run $RUN_ID end ===" >> "$LOG_FILE"

# Keep only last 50 logs
ls -1t "$LOG_DIR"/run-*.log 2>/dev/null | tail -n +51 | xargs -r rm -f

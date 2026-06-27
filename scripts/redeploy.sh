#!/usr/bin/env bash
#
# redeploy.sh — pull the latest code and restart the app.
#
# Triggered from the web UI (POST /api/admin/redeploy) but can also be run
# by hand:  bash scripts/redeploy.sh
#
# In production the app runs inside a tmux session (so an operator can attach
# and watch the logs). This script therefore restarts the app *inside that same
# tmux window* using `tmux respawn-window`, keeping it visible after a deploy.
# If tmux (or the session) isn't found — e.g. during local dev — it falls back
# to a detached `setsid nohup npm start` that logs to app.log.
#
# The web server spawns this script *detached* (its own session) so it survives
# the very server it is about to stop.
#
# Steps:
#   1. git pull (fast-forward only — aborts on conflicts).
#   2. Restart the app:
#        - tmux present  -> respawn-window -k (stops old, starts fresh in tmux)
#        - tmux absent   -> SIGTERM start-all.js, then setsid nohup npm start
#
# Configure the target with TMUX_SESSION in .env (default: "bajigar"). You can
# point at a specific window with "session:window" (e.g. "bajigar:0").

set -uo pipefail

# Resolve the project root (parent of this script's directory).
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR" || exit 1

LOG_FILE="$APP_DIR/redeploy.log"
APP_LOG="$APP_DIR/app.log"

# Pick up TMUX_SESSION from .env when run by hand (the web server already has
# it via the process environment). Only read that single key, ignore the rest.
if [ -z "${TMUX_SESSION:-}" ] && [ -f "$APP_DIR/.env" ]; then
  env_session="$(grep -E '^[[:space:]]*TMUX_SESSION=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2-)"
  # Trim surrounding quotes/whitespace.
  env_session="${env_session%\"}"; env_session="${env_session#\"}"
  env_session="${env_session%\'}"; env_session="${env_session#\'}"
  TMUX_SESSION="$(echo "$env_session" | xargs 2>/dev/null || true)"
fi
TMUX_SESSION="${TMUX_SESSION:-bajigar}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"; }

log "===== Redeploy requested (tmux target: '$TMUX_SESSION') ====="

# Give the HTTP response time to flush before we tear the server down.
sleep 2

# 1. Pull the latest code. Fast-forward only so a dirty/diverged tree fails
#    loudly instead of leaving a half-merged checkout.
log "Running git pull --ff-only ..."
if git pull --ff-only >>"$LOG_FILE" 2>&1; then
  log "git pull succeeded."
else
  log "git pull FAILED — aborting redeploy, leaving the current server running."
  exit 1
fi

# 2. Restart the app.
if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  # respawn-window -k kills whatever is running in the window (start-all.js and
  # its bot + web children) and starts a fresh `npm start` in the same window,
  # so the app stays attached to tmux exactly as before.
  log "Restarting inside tmux session '$TMUX_SESSION' (respawn-window)..."
  if tmux respawn-window -k -t "$TMUX_SESSION" \
      "cd '$APP_DIR' && exec npm start" 2>>"$LOG_FILE"; then
    log "Redeploy complete. App restarted inside tmux."
    exit 0
  fi
  log "tmux respawn-window failed — falling back to a detached restart."
fi

# Fallback (no tmux): stop the launcher, then relaunch detached.
log "Stopping current app (start-all.js)..."
pkill -TERM -f "start-all.js" 2>/dev/null || true

# Wait up to ~15s for the old processes to exit so the port is freed.
for _ in $(seq 1 30); do
  if pgrep -f "start-all.js" >/dev/null 2>&1; then
    sleep 0.5
  else
    break
  fi
done

# Force-kill anything stubborn so the new instance can bind the port.
if pgrep -f "start-all.js" >/dev/null 2>&1; then
  log "Process still alive after grace period — sending SIGKILL."
  pkill -KILL -f "start-all.js" 2>/dev/null || true
  sleep 1
fi

log "Starting new instance (npm start, detached)..."
setsid nohup npm start >>"$APP_LOG" 2>&1 &
disown 2>/dev/null || true

log "Redeploy complete. New instance launched (logs in app.log)."
exit 0

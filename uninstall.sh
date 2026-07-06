#!/usr/bin/env bash
set -euo pipefail

LABEL="com.claude-session-logger"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Stopped and unloaded $LABEL."
echo "Your logged history is left in place at ~/.claude-session-log (delete manually if you want it gone)."
echo "The /recall skill is left in place at ~/.claude/skills/session-history (delete manually if you want it gone)."

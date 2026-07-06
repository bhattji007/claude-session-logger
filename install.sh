#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="$(command -v node || true)"
CLAUDE_BIN="$(command -v claude || true)"

if [ -z "$NODE_BIN" ]; then
  echo "error: node not found in PATH" >&2
  exit 1
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "error: claude CLI not found in PATH (install Claude Code and log in first)" >&2
  exit 1
fi
if [ "$(uname)" != "Darwin" ]; then
  echo "error: this installer targets macOS (launchd). Adapt daemon.js to systemd/cron for other platforms." >&2
  exit 1
fi

LOG_DIR="$HOME/.claude-session-log"
SKILL_DIR="$HOME/.claude/skills/session-history"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LABEL="com.claude-session-logger"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$LOG_DIR/.scratch" "$LOG_DIR/logs" "$SKILL_DIR" "$LAUNCH_AGENTS_DIR"
cp "$SCRIPT_DIR/daemon.js" "$LOG_DIR/daemon.js"
cp "$SCRIPT_DIR/skills/session-history/SKILL.md" "$SKILL_DIR/SKILL.md"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$LOG_DIR/daemon.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/logs/daemon.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/logs/daemon.err.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed and started: $LABEL"
echo "History will appear at: $LOG_DIR/history.jsonl (first entries ~5 min after a session goes idle)"
echo "Daemon logs: $LOG_DIR/logs/daemon.out.log / daemon.err.log"
echo "Skill installed: $SKILL_DIR/SKILL.md (use /recall in any Claude Code session)"

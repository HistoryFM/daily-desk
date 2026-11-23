#!/usr/bin/env bash
# Runs The Daily Desk as a macOS LaunchAgent: starts at login, restarts if it crashes,
# and (because the process survives sleep) catches up on missed jobs when the laptop wakes.
set -euo pipefail

LABEL="com.dailydesk.app"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$DIR/logs"
NODE="$(command -v node)"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    [ -f "$DIR/.env.local" ] || { echo "Missing .env.local — copy .env.example and add your keys first."; exit 1; }
    mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
    echo "Building…"
    (cd "$DIR" && npm run build)
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/node_modules/next/dist/bin/next</string>
    <string>start</string>
    <string>-p</string>
    <string>4747</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGDIR/desk.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/desk.err.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed. The Daily Desk is running at http://localhost:4747"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Uninstalled."
    ;;
  restart)
    (cd "$DIR" && npm run build)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Rebuilt and restarted."
    ;;
  logs)
    tail -n 100 -f "$LOGDIR/desk.log" "$LOGDIR/desk.err.log"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" | grep -E "state|pid|last exit" || echo "Not installed."
    ;;
  *)
    echo "usage: $0 install|uninstall|restart|logs|status"; exit 1;;
esac

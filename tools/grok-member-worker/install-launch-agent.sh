#!/bin/bash
# Installs the member image worker as a per-user LaunchAgent (survives reboot).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
LABEL=com.jubaopeng.grok-member-worker
HOME_DIR="$HOME/Library/Application Support/JubaopengGrokMember"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME_DIR" "$HOME/Library/LaunchAgents"
[ -f "$HOME_DIR/config.json" ] || { echo "缺少 $HOME_DIR/config.json"; exit 1; }
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>$LABEL</string>
 <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/worker.mjs</string><string>$HOME_DIR/config.json</string></array>
 <key>RunAtLoad</key><true/>
 <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
 <key>ThrottleInterval</key><integer>60</integer>
 <key>StandardOutPath</key><string>$HOME_DIR/worker.log</string>
 <key>StandardErrorPath</key><string>$HOME_DIR/worker.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "已安装 ${LABEL}，日志：$HOME_DIR/worker.log"

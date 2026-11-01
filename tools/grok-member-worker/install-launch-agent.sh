#!/bin/bash
# 为每个 Grok 账号安装一个用户级 LaunchAgent。
#
# 单账号（没有 accounts 数组）的标签仍是 com.jubaopeng.grok-member-worker，
#   日志在 ~/Library/Application Support/JubaopengGrokMember/worker.log。
# 多账号时每个账号一个代理：com.jubaopeng.grok-member-worker.1、.2 …
#   启动参数带 --account <账号标签>。日志在该账号自己的目录里。
# KeepAlive 只在进程异常退出时拉起。验证码、登录过期、额度用完、浏览器被占用
#   或网页结构变化会让该账号以退出码 0 停下，不会马上被拉起，也不影响其他账号。
# 处理完后只重启这一个账号：
#   launchctl kickstart -k "gui/$(id -u)/com.jubaopeng.grok-member-worker.1"
# 不要设置 JBP_IMAGE_EXECUTION=direct。这里不读取、不打印连接凭据。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
CONFIG="${1:-$HOME/Library/Application Support/JubaopengGrokMember/config.json}"
AGENTS="$HOME/Library/LaunchAgents"
[[ -f "$CONFIG" ]] || { echo "缺少 $CONFIG"; exit 1; }
mkdir -p "$AGENTS"
cd "$DIR"
mapfile -t PLANS < <("$NODE" --input-type=module -e '
import {readFileSync, mkdirSync, writeFileSync} from "node:fs";
import {launchAgentPlans, launchAgentPlist} from "./worker.mjs";
const settings = JSON.parse(readFileSync(process.argv[1], "utf8"));
const plans = launchAgentPlans({settings, node: process.argv[2], script: process.argv[3], configFile: process.argv[1]});
const agents = process.argv[4];
for (const plan of plans) {
  mkdirSync(plan.stateDir, {recursive: true});
  const plist = agents + "/" + plan.label + ".plist";
  writeFileSync(plist, launchAgentPlist(plan));
  console.log(plan.label + "\t" + plist);
}
' "$CONFIG" "$NODE" "$DIR/worker.mjs" "$AGENTS")
if [[ ${#PLANS[@]} -eq 0 ]]; then echo "配置里没有可安装的账号"; exit 1; fi
uid="$(id -u)"
for line in "${PLANS[@]}"; do
  IFS=$'\t' read -r label plist <<<"$line"
  launchctl bootout "gui/${uid}/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/${uid}" "$plist"
  echo "已安装 ${label}"
  echo "日志见该账号目录；暂停后执行：launchctl kickstart -k gui/${uid}/${label}"
done

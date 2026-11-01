#!/bin/bash
# 启动 Grok 会员出图。
#
# 单个账号：配置里只有 connection 和 profileDir 时，只启动一个进程，存档仍在
#   ~/Pictures/剧爆棚出图/会员出图/
# 多个账号：accounts 里每一项单独一个进程。各自使用自己的浏览器 profile、
#   连接凭据和存档目录 ~/Pictures/剧爆棚出图/会员出图/<账号标签>/。
# 某个账号因验证码、登录过期、额度用完、浏览器被占用或网页结构变化而暂停时，
#   只退出该进程（退出码 0），其他账号继续跑。处理完后重新运行本脚本。
# 不要设置 JBP_IMAGE_EXECUTION=direct。本脚本不打印连接凭据。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${1:-$HOME/Library/Application Support/JubaopengGrokMember/config.json}"
NODE="$(command -v node)"
if [[ ! -f "$CONFIG" ]]; then echo "缺少 $CONFIG"; exit 1; fi
cd "$DIR"
mapfile -t PLANS < <("$NODE" --input-type=module -e '
import {readFileSync} from "node:fs";
import {memberLaunchArgs} from "./worker.mjs";
const settings = JSON.parse(readFileSync(process.argv[1], "utf8"));
for (const plan of memberLaunchArgs(settings)) console.log(plan.label + "\t" + plan.args.join("\t"));
' "$CONFIG")
if [[ ${#PLANS[@]} -eq 0 ]]; then echo "配置里没有可启动的账号"; exit 1; fi
pids=()
for line in "${PLANS[@]}"; do
  IFS=$'\t' read -r label arg1 arg2 <<<"$line"
  if [[ -n "${arg1:-}" ]]; then
    "$NODE" "$DIR/worker.mjs" "$CONFIG" "$arg1" "$arg2" &
  else
    "$NODE" "$DIR/worker.mjs" "$CONFIG" &
  fi
  pids+=("$!")
  echo "已启动 ${label:-默认账号} pid $!"
done
trap 'kill "${pids[@]}" 2>/dev/null || true' INT TERM
status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done
exit "$status"

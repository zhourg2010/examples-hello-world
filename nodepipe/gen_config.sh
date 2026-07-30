#!/bin/bash
# Generate subs-check config.yaml from ~/nodepipe/env
# Usage: ./gen_config.sh [fast|speed|full]   (default: fast)
set -e
source ~/nodepipe/env
IFS=',' read -ra SUB_URLS_ARR <<< "$SUB_URL"
MODE="${1:-fast}"
MEDIA="false"; PLATFORMS=""; MINSPEED="0"; SPEEDURL=""; RENAME="false"
CALLBACK=""; CRON=""; KEEPDAYS="0"; DLMB="20"
case "$MODE" in
  fast) ;;
  speed)
    MINSPEED="128"; SPEEDURL="https://speed.cloudflare.com/__down?bytes=20000000"; DLMB="10" ;;
  full)
    MINSPEED="128"; SPEEDURL="https://speed.cloudflare.com/__down?bytes=20000000"; DLMB="10"
    MEDIA="true"; RENAME="true"; KEEPDAYS="28"
    PLATFORMS=$'platforms:\n  - iprisk\n  - claude'
    # 注意：不再设置 filter: "CL-"。之前把 CL- 当硬过滤，media-check 一旦抖动/漏测，
    # 会把所有节点一次性清零（真实发生过一次）。CL- 现在只在 select_and_push.py 里
    # 当排序优先级用（能解锁 Claude 的排前面，不是"必须解锁才保留"）。
    CALLBACK="callback-script: \"$HOME/nodepipe/select_and_push.sh\""
    # 调度改由 launchd 的 4 个定点任务(6:00/10:30/14:30/19:00)触发 force_retest.sh 强制执行,
    # 这里只留一个很稀疏的每日兜底(见下方 check-interval),避免 launchd 万一失效导致完全不测。
    CRON="" ;;
  *) echo "unknown mode: $MODE (use fast|speed|full)"; exit 1 ;;
esac
{
  echo "concurrent: 30"
  echo "media-concurrent: 8"
  echo "speed-concurrent: 5"
  echo "shuffle-test-order: true"
  echo "print-progress: true"
  if [ -n "$CRON" ]; then
    echo "$CRON"
  elif [ "$MODE" = "full" ]; then
    # 兜底:如果 launchd 的 4 个定点任务哪天没触发,这里保证至少每天跑一次(1440分钟)。
    echo "check-interval: 1440"
  fi
  echo "timeout: 5000"
  echo "alive-test-url: http://gstatic.com/generate_204"
  echo "min-speed: ${MINSPEED}"
  [ -n "$SPEEDURL" ] && echo "speed-test-url: ${SPEEDURL}"
  echo "download-timeout: 10"
  echo "download-mb: ${DLMB}"
  echo "keep-days: ${KEEPDAYS}"
  echo "node-type:"
  echo "  - vless"
  echo "  - anytls"
  echo "  - trojan"
  echo "media-check: ${MEDIA}"
  echo "media-check-timeout: 6"
  [ -n "$PLATFORMS" ] && echo "$PLATFORMS"
  # filter: 留空,不再硬过滤 CL-
  echo "rename-node: ${RENAME}"
  [ -n "$CALLBACK" ] && echo "$CALLBACK"
  echo "save-method: local"
  echo "output-dir: \"\""
  echo "listen-port: \":8199\""
  echo "enable-web-ui: true"
  echo "api-key: \"\""
  echo "sub-urls:"
  for u in "${SUB_URLS_ARR[@]}"; do
    echo "  - \"${u}\""
  done
  if [ "$MODE" = "full" ]; then
    # 三振出局机制里"最近还活过(未满3次未命中)"的节点,由 select_and_push.py
    # 写到 subs-check 自己的 output 目录并靠 8199 端口文件服务对外提供,
    # 这里当成一个普通订阅源加进来,下一轮就会被真正拉去重测,而不只是凭旧缓存假设它还活着。
    echo "  - \"http://127.0.0.1:8199/recent_history.txt\""
  fi
  echo "sub-urls-retry: 2"
  echo "proxy: \"\""
  echo "github-proxy: \"${GITHUB_PROXY:-}\""
  echo "dns:"
  echo "  enable: false"
} > ~/nodepipe/bin/config.yaml
echo "config.yaml generated (mode: ${MODE})"
grep -E "min-speed|download-mb|media-check:|keep-days|callback-script|cron-expression|check-interval|sub-urls:" ~/nodepipe/bin/config.yaml

#!/bin/bash
# Generate subs-check config.yaml from ~/nodepipe/env
# Usage: ./gen_config.sh [fast|speed|full]   (default: fast)
set -e
source ~/nodepipe/env
MODE="${1:-fast}"
MEDIA="false"; PLATFORMS=""; FILTER=""; MINSPEED="0"; SPEEDURL=""; RENAME="false"
CALLBACK=""; CRON=""; KEEPDAYS="0"; DLMB="20"
case "$MODE" in
  fast) ;;
  speed)
    MINSPEED="128"; SPEEDURL="https://speed.cloudflare.com/__down?bytes=20000000"; DLMB="10" ;;
  full)
    MINSPEED="128"; SPEEDURL="https://speed.cloudflare.com/__down?bytes=20000000"; DLMB="10"
    MEDIA="true"; RENAME="true"; KEEPDAYS="28"
    PLATFORMS=$'platforms:\n  - iprisk\n  - claude'
    FILTER=$'filter:\n  - "CL-"'
    CALLBACK="callback-script: \"$HOME/nodepipe/select_and_push.sh\""
    CRON='cron-expression: "0 6,19 * * *"' ;;
  *) echo "unknown mode: $MODE (use fast|speed|full)"; exit 1 ;;
esac
{
  echo "concurrent: 30"
  echo "media-concurrent: 8"
  echo "speed-concurrent: 5"
  echo "shuffle-test-order: true"
  echo "print-progress: true"
  [ -n "$CRON" ] && echo "$CRON"
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
  [ -n "$FILTER" ] && echo "$FILTER"
  echo "rename-node: ${RENAME}"
  [ -n "$CALLBACK" ] && echo "$CALLBACK"
  echo "save-method: local"
  echo "output-dir: \"\""
  echo "listen-port: \":8199\""
  echo "enable-web-ui: true"
  echo "api-key: \"\""
  echo "sub-urls:"
  echo "  - \"${SUB_URL}\""
  echo "sub-urls-retry: 2"
  echo "proxy: \"\""
  echo "dns:"
  echo "  enable: false"
} > ~/nodepipe/bin/config.yaml
echo "config.yaml generated (mode: ${MODE})"
grep -E "min-speed|download-mb|media-check:|keep-days|callback-script|cron-expression|sub-urls:" ~/nodepipe/bin/config.yaml

#!/bin/bash
# 强制立即测活+推送一次，不用等 cron/check-interval。
# 用于:手动调用,或者给 launchd 的定点任务(6:00/10:30/14:30/19:00)当 payload 用。
#
# 做法:先把常驻的 subs-check 守护进程(launchd job)停掉,避免端口/进程冲突,
# 用 `-f config.yaml` 前台跑一次完整检测(阻塞到跑完为止;config.yaml 里配置的
# callback-script 会在检测完成后自动触发 select_and_push.sh,所以这一步已经包含推送),
# 跑完再把守护进程重新拉起来,恢复正常的兜底 check-interval 调度。
set -e

PLIST="$HOME/Library/LaunchAgents/com.nodepipe.subscheck.plist"
LABEL="com.nodepipe.subscheck"
BIN_DIR="$HOME/nodepipe/bin"
LOG="$HOME/nodepipe/logs/force_retest.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"; }

log "=== force_retest start ==="

if launchctl list | grep -q "$LABEL"; then
  log "stopping daemon ($LABEL)..."
  launchctl unload "$PLIST" 2>>"$LOG" || log "WARN: unload failed or already stopped"
else
  log "daemon not currently loaded, skipping unload"
fi

# 保险起见再确认端口/进程没有残留(避免前台实例和刚停的守护进程抢 8199 端口)
sleep 1
pkill -f "$BIN_DIR/subs-check" 2>/dev/null || true
sleep 1

log "running one-shot check (foreground, blocks until done)..."
cd "$BIN_DIR"
if ./subs-check -f config.yaml >> "$LOG" 2>&1; then
  log "one-shot check finished OK (callback-script should have pushed already)"
else
  log "ERROR: one-shot check exited non-zero, check $LOG for details"
fi

log "probing US node archive (/us) and pushing top results..."
source ~/nodepipe/env
export PUSH_URL PUSH_KEY
if /opt/local/bin/python3.12 "$HOME/nodepipe/us_archive.py" >> "$HOME/nodepipe/logs/us_archive.log" 2>&1; then
  log "us_archive.py finished OK"
else
  log "WARN: us_archive.py exited non-zero, check logs/us_archive.log for details (main /push already succeeded regardless)"
fi

log "restarting daemon ($LABEL)..."
launchctl load "$PLIST" 2>>"$LOG" || log "WARN: reload failed, daemon may not be running until next boot"

log "=== force_retest done ==="

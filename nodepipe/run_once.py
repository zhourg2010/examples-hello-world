#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_once.py — 完整跑一轮:测活测速 → (回调)选美国节点 → 推送到 Deno。

取代原来的 force_retest.sh(bash + launchctl 专有)。macOS / Ubuntu / Windows 通用。

做的事:
  1. 起一个只读的本地小文件服务(默认 127.0.0.1:8299),把 state/retest/ 目录暴露出去。
     subs-check 的 config.yaml 里把 http://127.0.0.1:8299/recent_history.txt 当成一个
     订阅源,这样"三振出局机制里最近还活过的节点"下一轮会被真的拉去重测,而不是
     凭旧缓存假设它还活着。
     (以前这个职责是 subs-check 自带的 web-ui 干的,那要求它必须作为守护进程常驻;
      自己起一个十几行的文件服务之后,三个平台都不再需要常驻进程,调度就是纯粹的
      "定点跑一次",简单太多。)
  2. 前台跑一次 subs-check。它跑完会自动触发 config.yaml 里配置的 callback-script,
     也就是 select_and_push.py —— 所以推送这一步已经包含在这里面了。
  3. 关掉文件服务。

超时保护:subs-check 万一卡住(网络挂了、某个源一直不返回),不能让它永远占着。
RUN_TIMEOUT(默认 2400 秒 = 40 分钟)到了就杀掉。正常一轮远用不了这么久,而且就算
被杀,callback 通常早就跑完推送了,不影响这一批节点。

用法:
    python3 run_once.py
"""

import os
import sys
import subprocess
import threading
import functools
import http.server
import socketserver

from common import (
    BIN_DIR, HOME, RETEST_DIR,
    ensure_dirs, load_env, stamped, subs_check_binary,
)

LOG = "run_once"


def log(msg):
    stamped(LOG, msg)


RETEST_PORT = int(os.environ.get("RETEST_PORT", "8299"))
RUN_TIMEOUT = int(os.environ.get("RUN_TIMEOUT", "2400"))


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """只读静态文件服务。默认那个 handler 每个请求都往 stderr 打一行,
    subs-check 一轮会拉好几次,日志里全是噪音,所以把访问日志静音。"""

    def log_message(self, fmt, *args):  # noqa: A003
        pass


def start_retest_server():
    """把 state/retest/ 目录以只读方式挂在 127.0.0.1 上。

    只监听 127.0.0.1,不是 0.0.0.0 —— 这个目录里是节点 URI(含密码/UUID),
    绝对不能对局域网可见。
    """
    RETEST_DIR.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(_QuietHandler, directory=str(RETEST_DIR))
    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", RETEST_PORT), handler)
    except OSError as e:
        # 端口被占(上一次跑没退干净,或者别的程序占了)。这不是致命错误——
        # 大不了这一轮的"重测名单"喂不进去,测活测速和推送照常。
        log(f"WARN: 本地重测文件服务起不来(127.0.0.1:{RETEST_PORT}: {e})。"
            "这一轮三振出局的重测名单不会被喂回 subs-check,其余流程不受影响。")
        return None
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    log(f"本地重测文件服务已启动: http://127.0.0.1:{RETEST_PORT}/ → {RETEST_DIR}")
    return httpd


def main():
    ensure_dirs()
    load_env()

    log("=== run_once 开始 ===")

    binary = subs_check_binary()
    config = BIN_DIR / "config.yaml"
    if not binary.exists():
        log(f"ERROR: 找不到 subs-check 可执行文件: {binary}")
        log("       把 subs-check 放到这个路径下(Windows 上是 subs-check.exe)。")
        sys.exit(1)
    if not config.exists():
        log(f"ERROR: 找不到 {config}。先跑一次: python3 gen_config.py full")
        sys.exit(1)

    # 先把服务端的免费节点池拉到本地,再起文件服务 —— 顺序反了的话这一轮
    # subs-check 拉到的还是上一次的旧文件。
    # 拉失败不中断:免费池是**锦上添花**,自己机场那条主链路不该被它拖累。
    if os.environ.get("FREE_POOL", "1") != "0":
        try:
            import free_pool
            free_pool.main()
        except Exception as e:
            log(f"WARN: 拉免费节点池失败({e}),这一轮就不测免费节点了")

    httpd = start_retest_server()

    # 把 NODEPIPE_HOME 传给子进程,回调脚本里也会用到(虽然 gen_config.py 已经把它
    # 写死进回调脚本了,这里再传一次是双保险)。
    env = dict(os.environ)
    env["NODEPIPE_HOME"] = str(HOME)

    log("开始跑 subs-check(前台,阻塞到跑完;跑完会自动回调 select_and_push.py 推送)")
    rc = None
    try:
        proc = subprocess.Popen(
            [str(binary), "-f", "config.yaml"],
            cwd=str(BIN_DIR), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        # 边跑边把它的输出转进我们的日志,不要等跑完一次性读——一轮可能几十分钟,
        # 中途想看进度的话至少日志里是有东西的。
        def pump():
            try:
                for line in proc.stdout:
                    stamped(LOG, "[subs-check] " + line.rstrip())
            except Exception:
                pass
        pumper = threading.Thread(target=pump, daemon=True)
        pumper.start()

        try:
            rc = proc.wait(timeout=RUN_TIMEOUT)
        except subprocess.TimeoutExpired:
            log(f"WARN: subs-check 超过 {RUN_TIMEOUT} 秒还没结束,强制终止。"
                "(回调通常已经跑完推送了,这一批节点一般不受影响)")
            proc.kill()
            try:
                proc.wait(timeout=30)
            except Exception:
                pass
            rc = -1
        pumper.join(timeout=5)
    except Exception as e:
        log(f"ERROR: 跑 subs-check 出错: {e}")
        rc = -1
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
            log("本地重测文件服务已关闭。")

    if rc == 0:
        log("subs-check 正常结束(推送应该已经由回调完成,详见 logs/push.log)。")
    else:
        log(f"subs-check 退出码 {rc},请查 logs/run_once.log 和 logs/push.log。")

    log("=== run_once 结束 ===")
    sys.exit(0 if rc == 0 else 1)


if __name__ == "__main__":
    main()

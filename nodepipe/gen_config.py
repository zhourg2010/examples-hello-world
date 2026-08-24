#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_config.py — 生成 subs-check 的 config.yaml,以及它跑完之后要回调的那个包装脚本。

取代原来的 gen_config.sh(bash 专有,Windows 上跑不了)。

用法:
    python3 gen_config.py [fast|speed|full]     # 默认 full

三种模式:
    fast   只测活,不测速不测流媒体。最快,用来快速看订阅源还有没有货。
    speed  测活 + 测速。
    full   测活 + 测速 + iprisk/Claude 解锁检测 + 重命名(带国家码前缀)+ 回调推送。
           这是日常跑的模式 —— **必须是 full**,因为只有它会 rename-node,而
           select_and_push.py 的第一层美国粗筛依赖节点名上的国家码前缀。

跟老的 gen_config.sh 相比有两处行为变化,都是为了让三个平台上都不再需要常驻守护进程:

  1. **不再写 check-interval / cron-expression。** 什么时候跑改由操作系统的调度器决定
     (macOS launchd / Linux systemd timer / Windows 计划任务,见 scheduler/ 目录),
     subs-check 每次就是老老实实跑一轮然后退出。以前那套"常驻进程 + 自带定时 + launchd
     再踢一脚"是三重调度叠在一起,谁真正生效很难说清。

  2. **enable-web-ui 关掉。** 开着的话 subs-check 会起一个 HTTP 服务并一直不退出,
     一次性运行就变成了永不结束。以前那个 web-ui 还兼任了一个职责:把
     recent_history.txt(三振出局的重测名单)通过 8199 端口提供给它自己当订阅源。
     这个职责现在由 run_once.py 里那个十几行的本地只读文件服务接管了。
"""

import os
import sys
import stat

from common import (
    BIN_DIR, HOME, IS_WINDOWS, RETEST_DIR, ensure_dirs, load_env, log as _log,
    python_exe, PKG_DIR,
)

LOG = "gen_config"


def log(msg):
    _log(LOG, msg)


# 本地重测文件服务的端口。run_once.py 用同一个默认值,改的话两边一起改(或者设环境变量)。
RETEST_PORT = int(os.environ.get("RETEST_PORT", "8299"))


def callback_path():
    return BIN_DIR / ("callback.cmd" if IS_WINDOWS else "callback.sh")


def write_callback() -> str:
    """生成 subs-check 跑完后要调用的那个薄包装脚本。

    把解释器和脚本的绝对路径**在生成时就写死进去**,而不是让包装脚本去猜或者依赖
    环境变量——subs-check 调用回调时带的环境不一定完整(尤其是 launchd 和计划任务
    拉起来的进程,PATH 常常是很干净的一小撮),写绝对路径最不容易出岔子。
    """
    py = python_exe()
    script = PKG_DIR / "select_and_push.py"
    path = callback_path()

    if IS_WINDOWS:
        content = (
            "@echo off\r\n"
            "rem 由 gen_config.py 自动生成,不要手改(下次生成会被覆盖)。\r\n"
            f'set "NODEPIPE_HOME={HOME}"\r\n'
            f'"{py}" "{script}"\r\n'
        )
    else:
        content = (
            "#!/bin/sh\n"
            "# 由 gen_config.py 自动生成,不要手改(下次生成会被覆盖)。\n"
            f'NODEPIPE_HOME="{HOME}"\n'
            "export NODEPIPE_HOME\n"
            f'exec "{py}" "{script}"\n'
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    if not IS_WINDOWS:
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(path)


def build_config(mode: str, sub_urls: list, github_proxy: str) -> str:
    media = mode == "full"
    rename = mode == "full"
    min_speed = "128" if mode in ("speed", "full") else "0"
    speed_url = "https://speed.cloudflare.com/__down?bytes=20000000" if mode in ("speed", "full") else ""
    dl_mb = "10" if mode in ("speed", "full") else "20"
    keep_days = "28" if mode == "full" else "0"

    lines = [
        "# 由 gen_config.py 生成,不要手改(下次生成会被覆盖)。",
        f"# 模式: {mode}",
        "concurrent: 30",
        "media-concurrent: 8",
        "speed-concurrent: 5",
        "shuffle-test-order: true",
        "print-progress: true",
        # 刻意不写 check-interval / cron-expression:调度交给操作系统,
        # subs-check 每次跑完一轮就退出(见文件头说明)。
        "timeout: 5000",
        "alive-test-url: http://gstatic.com/generate_204",
        f"min-speed: {min_speed}",
    ]
    if speed_url:
        lines.append(f"speed-test-url: {speed_url}")
    lines += [
        "download-timeout: 10",
        f"download-mb: {dl_mb}",
        f"keep-days: {keep_days}",
        "node-type:",
        "  - vless",
        "  - anytls",
        "  - trojan",
        f"media-check: {'true' if media else 'false'}",
        "media-check-timeout: 6",
    ]
    if media:
        lines += ["platforms:", "  - iprisk", "  - claude"]
    # 刻意不设 filter。曾经把 filter: "CL-" 当硬性门槛,一次 media-check 抖动就把节点
    # 清零过一次。国家/解锁的筛选统一放在 select_and_push.py 里做,那边有完整的兜底。
    lines.append(f"rename-node: {'true' if rename else 'false'}")

    if mode == "full":
        lines.append(f'callback-script: "{write_callback()}"')

    lines += [
        "save-method: local",
        'output-dir: ""',
        # web-ui 关掉,否则 subs-check 会起 HTTP 服务并常驻不退出(见文件头说明)。
        "enable-web-ui: false",
        'api-key: ""',
        "sub-urls:",
    ]
    for u in sub_urls:
        lines.append(f'  - "{u}"')
    if mode == "full":
        # 三振出局机制里"最近还活过"的节点,由 run_once.py 起的本地文件服务提供,
        # 这里当成一个普通订阅源加进来,下一轮就会被真正拉去重测,而不只是凭旧缓存
        # 假设它还活着。
        lines.append(f'  - "http://127.0.0.1:{RETEST_PORT}/recent_history.txt"')
        # 免费节点池。free_pool.py 会在每轮开始前把服务端抓好的候选拉下来写成这个文件,
        # 这里同样当成一个普通订阅源加进来 —— 免费节点的活性/速度只能靠实测,
        # 走 subs-check 这条已经在跑的路是最省事的,不用另起一套测试逻辑。
        # 池子拉不下来(没配 PUSH_KEY、服务端还没抓过)时文件不存在,subs-check 拉不到就跳过,
        # 不影响这一轮的其它订阅源。
        if os.environ.get("FREE_POOL", "1") != "0":
            lines.append(f'  - "http://127.0.0.1:{RETEST_PORT}/free_pool.txt"')

    lines += [
        "sub-urls-retry: 2",
        'proxy: ""',
        f'github-proxy: "{github_proxy}"',
        "dns:",
        "  enable: false",
    ]
    return "\n".join(lines) + "\n"


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else "full").lower()
    if mode not in ("fast", "speed", "full"):
        print(f"未知模式: {mode}(可用: fast | speed | full)")
        sys.exit(1)

    ensure_dirs()
    load_env()

    sub_url = os.environ.get("SUB_URL", "").strip()
    if not sub_url:
        log("ERROR: SUB_URL 没设置(应该在 nodepipe/env 里,多个源用逗号分隔)。")
        sys.exit(1)
    sub_urls = [u.strip() for u in sub_url.split(",") if u.strip()]

    # 重测名单文件先建出来(哪怕是空的)。不然第一次跑的时候本地文件服务会对
    # subs-check 返回 404,它会把这条订阅源记成失败,日志里多一条没必要的报错。
    RETEST_DIR.mkdir(parents=True, exist_ok=True)
    retest_file = RETEST_DIR / "recent_history.txt"
    if not retest_file.exists():
        retest_file.write_text("", encoding="utf-8")

    cfg = build_config(mode, sub_urls, os.environ.get("GITHUB_PROXY", ""))
    out = BIN_DIR / "config.yaml"
    out.write_text(cfg, encoding="utf-8")

    log(f"config.yaml 已生成: {out}(模式 {mode},{len(sub_urls)} 个订阅源)")
    if mode == "full":
        log(f"回调脚本: {callback_path()}")
    for line in cfg.splitlines():
        if line.startswith(("min-speed", "media-check:", "keep-days", "callback-script",
                            "rename-node", "enable-web-ui", "sub-urls:")):
            log("  " + line)


if __name__ == "__main__":
    main()

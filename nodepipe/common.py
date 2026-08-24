#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""common.py — nodepipe 各脚本共用的跨平台基础设施。

以前所有脚本都写死了 macOS 的东西:解释器路径写死 /opt/local/bin/python3.12(MacPorts
专有)、目录写死 ~/nodepipe、调度只有 launchd、停守护进程只会 launchctl。
换到 Ubuntu 或 Windows 上一行都跑不了。

这个模块把"跟平台有关的部分"全部收在一处,别的脚本只管调:
  HOME / BIN_DIR / STATE_DIR / LOGS_DIR   目录(可用 NODEPIPE_HOME 环境变量整体搬家)
  load_env()                              读 env 文件里的密钥/参数
  log()                                   带时间戳、同时落盘和打屏的日志
  subs_check_binary()                     Windows 上自动找 subs-check.exe
  python_exe()                            当前正在跑的解释器,不再写死路径

约定:所有路径一律用 pathlib.Path,不要手工拼 "/"——Windows 上会炸。
"""

import os
import sys
import datetime
from pathlib import Path

IS_WINDOWS = sys.platform.startswith("win")
IS_MACOS = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")


def platform_name() -> str:
    if IS_WINDOWS:
        return "windows"
    if IS_MACOS:
        return "macos"
    if IS_LINUX:
        return "linux"
    return sys.platform


# 整个 nodepipe 的工作根目录。默认放在用户主目录下(三个平台 Path.home() 都对:
# macOS /Users/xxx、Linux /home/xxx、Windows C:\Users\xxx),想放别处就设 NODEPIPE_HOME。
HOME = Path(os.environ.get("NODEPIPE_HOME") or (Path.home() / "nodepipe")).expanduser()

BIN_DIR = HOME / "bin"                  # subs-check 本体 + 它生成的 config.yaml
OUTPUT_DIR = BIN_DIR / "output"         # subs-check 每轮的测速结果(all.yaml)
STATE_DIR = HOME / "state"              # 我们自己的持久化状态(历史/缓存/GeoIP库)
LOGS_DIR = HOME / "logs"                # 日志
RETEST_DIR = STATE_DIR / "retest"       # 三振出局机制要重测的节点清单,由本地文件服务对外提供

ENV_FILE = HOME / "env"

# 本项目代码所在目录(不一定等于 HOME——可以把仓库 clone 到别处,只把数据放 HOME)。
PKG_DIR = Path(__file__).resolve().parent


def python_exe() -> str:
    """当前正在跑的 Python 解释器的绝对路径。

    以前 shebang 和 shell 脚本里写死 /opt/local/bin/python3.12,换台机器就废。
    用 sys.executable 意味着"你用哪个 python 起的我,我就继续用哪个",三个平台通用。
    """
    return sys.executable or "python3"


def subs_check_binary() -> Path:
    """subs-check 可执行文件。Windows 上带 .exe 后缀。"""
    return BIN_DIR / ("subs-check.exe" if IS_WINDOWS else "subs-check")


def ensure_dirs() -> None:
    for d in (BIN_DIR, OUTPUT_DIR, STATE_DIR, LOGS_DIR, RETEST_DIR):
        d.mkdir(parents=True, exist_ok=True)


def load_env(path: Path = None) -> dict:
    """读 env 文件(KEY=VALUE / KEY="VALUE" / export KEY=VALUE 都认),写进 os.environ。

    已经存在于 os.environ 里的键不会被覆盖——这样"临时改一个参数跑一次"可以直接
    在命令行前面加环境变量,不用去改文件:
        MAX_NODES=30 python3 select_and_push.py

    文件不存在不报错(CI/容器里可能全靠真环境变量注入),只是什么都不做。
    """
    path = path or ENV_FILE
    loaded = {}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return loaded
    except Exception as e:
        log("common", f"WARN: 读取 {path} 失败: {e}")
        return loaded

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        # 去掉包裹的引号(env 文件里习惯写 KEY="value")
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        if not key:
            continue
        loaded[key] = val
        os.environ.setdefault(key, val)
    return loaded


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def log(logname: str, msg) -> None:
    """写一行日志到 logs/<logname>.log,同时打到 stdout。

    落盘失败(比如磁盘满、目录权限不对)不能让主流程跟着崩——推送本身比记日志重要,
    所以这里吞掉异常,但至少 stdout 那份还在(被调度器的输出重定向接住)。
    """
    line = str(msg)
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOGS_DIR / f"{logname}.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    try:
        print(line, flush=True)
    except Exception:
        pass


def stamped(logname: str, msg) -> None:
    """带 '2026-08-24 10:30:00 ' 时间戳前缀的日志,给流程类脚本(run_once)用。"""
    log(logname, f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}")

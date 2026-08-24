#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""install_scheduler.py — 在当前平台上装/卸载 nodepipe 的定时任务。

三个平台各有各的调度机制,但对使用者来说命令是同一条:

    python3 install_scheduler.py install     # 安装并启用
    python3 install_scheduler.py uninstall   # 停用并删除
    python3 install_scheduler.py status      # 看现在装没装、下次什么时候跑

背后分别对应:
    macOS    ~/Library/LaunchAgents/com.nodepipe.runonce.plist  (launchd)
    Linux    ~/.config/systemd/user/nodepipe.{service,timer}     (systemd user timer)
    Windows  计划任务 "nodepipe"                                  (schtasks)

模板在 scheduler/<平台>/ 下,里面的 __PYTHON__ / __RUN_ONCE__ / __HOME__ / __LOGS__
占位符由这个脚本在安装时替换成真实的绝对路径——所以模板本身可以进 git,不含任何
跟某台机器绑定的路径。
"""

import os
import sys
import subprocess
from pathlib import Path

from common import HOME, LOGS_DIR, PKG_DIR, ensure_dirs, platform_name, python_exe

TEMPLATES = PKG_DIR / "scheduler"
RUN_ONCE = PKG_DIR / "run_once.py"

MAC_LABEL = "com.nodepipe.runonce"
MAC_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{MAC_LABEL}.plist"

SYSTEMD_DIR = Path.home() / ".config" / "systemd" / "user"
WIN_TASK = "nodepipe"


def render(src: Path) -> str:
    return (src.read_text(encoding="utf-8")
            .replace("__PYTHON__", python_exe())
            .replace("__RUN_ONCE__", str(RUN_ONCE))
            .replace("__HOME__", str(HOME))
            .replace("__LOGS__", str(LOGS_DIR)))


def run(cmd, check=False, **kw):
    print("  $ " + " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, check=check, **kw)


# ---------------------------------------------------------------- macOS

def mac_install():
    MAC_PLIST.parent.mkdir(parents=True, exist_ok=True)
    MAC_PLIST.write_text(render(TEMPLATES / "macos" / "com.nodepipe.runonce.plist"), encoding="utf-8")
    print(f"已写入 {MAC_PLIST}")
    # 先 unload 一次,不然改了 plist 之后 load 会报 "service already loaded"。
    # 没装过的时候 unload 会失败,那是正常的,所以不 check。
    run(["launchctl", "unload", str(MAC_PLIST)], stderr=subprocess.DEVNULL)
    run(["launchctl", "load", str(MAC_PLIST)], check=True)
    print("launchd 任务已加载。注意:launchctl 操作用户级 agent 千万不要加 sudo。")


def mac_uninstall():
    run(["launchctl", "unload", str(MAC_PLIST)], stderr=subprocess.DEVNULL)
    if MAC_PLIST.exists():
        MAC_PLIST.unlink()
        print(f"已删除 {MAC_PLIST}")
    else:
        print("本来就没装。")


def mac_status():
    run(["launchctl", "list"], stdout=subprocess.PIPE)
    r = subprocess.run(["launchctl", "list"], capture_output=True, text=True)
    hit = [l for l in r.stdout.splitlines() if MAC_LABEL in l]
    print("\n".join(hit) if hit else "launchd 里没有 nodepipe 任务。")


# ---------------------------------------------------------------- Linux

def linux_install():
    SYSTEMD_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("nodepipe.service", "nodepipe.timer"):
        (SYSTEMD_DIR / name).write_text(render(TEMPLATES / "linux" / name), encoding="utf-8")
        print(f"已写入 {SYSTEMD_DIR / name}")
    run(["systemctl", "--user", "daemon-reload"], check=True)
    run(["systemctl", "--user", "enable", "--now", "nodepipe.timer"], check=True)

    # user unit 默认只在用户登录期间存活。常开的小主机需要 lingering,否则注销之后
    # 定时任务就不跑了。这一步需要 sudo,失败不算致命——只是提醒用户自己补一下。
    user = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    r = subprocess.run(["loginctl", "show-user", user, "-p", "Linger"],
                       capture_output=True, text=True)
    if "Linger=yes" not in r.stdout:
        print("\n提示:这台机器还没开 lingering,注销登录后定时任务不会跑。")
        print(f"      常开的小主机建议执行一次: sudo loginctl enable-linger {user}")


def linux_uninstall():
    run(["systemctl", "--user", "disable", "--now", "nodepipe.timer"], stderr=subprocess.DEVNULL)
    for name in ("nodepipe.service", "nodepipe.timer"):
        p = SYSTEMD_DIR / name
        if p.exists():
            p.unlink()
            print(f"已删除 {p}")
    run(["systemctl", "--user", "daemon-reload"], stderr=subprocess.DEVNULL)


def linux_status():
    run(["systemctl", "--user", "list-timers", "nodepipe.timer", "--all"])


# ---------------------------------------------------------------- Windows

def win_install():
    xml = render(TEMPLATES / "windows" / "nodepipe-task.xml")
    tmp = HOME / "nodepipe-task.generated.xml"
    # schtasks /XML 要求文件是 UTF-16(BOM),这是它的硬性要求,不是可选项。
    tmp.write_text(xml, encoding="utf-16")
    run(["schtasks", "/Create", "/TN", WIN_TASK, "/XML", str(tmp), "/F"], check=True)
    tmp.unlink(missing_ok=True)
    print(f'计划任务 "{WIN_TASK}" 已创建。')


def win_uninstall():
    run(["schtasks", "/Delete", "/TN", WIN_TASK, "/F"], stderr=subprocess.DEVNULL)


def win_status():
    run(["schtasks", "/Query", "/TN", WIN_TASK, "/V", "/FO", "LIST"], stderr=subprocess.DEVNULL)


# ---------------------------------------------------------------- 入口

HANDLERS = {
    "macos": (mac_install, mac_uninstall, mac_status),
    "linux": (linux_install, linux_uninstall, linux_status),
    "windows": (win_install, win_uninstall, win_status),
}


def main():
    action = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if action not in ("install", "uninstall", "status"):
        print("用法: python3 install_scheduler.py [install|uninstall|status]")
        sys.exit(1)

    plat = platform_name()
    if plat not in HANDLERS:
        print(f"不支持的平台: {plat}。请手工配置定时任务,每天 6:00/10:30/14:30/19:00 执行:")
        print(f"  {python_exe()} {RUN_ONCE}")
        sys.exit(1)

    ensure_dirs()
    install, uninstall, status = HANDLERS[plat]

    if action == "install":
        if not RUN_ONCE.exists():
            print(f"ERROR: 找不到 {RUN_ONCE}")
            sys.exit(1)
        print(f"在 {plat} 上安装 nodepipe 定时任务(每天 6:00 / 10:30 / 14:30 / 19:00)...")
        install()
        print("完成。手动立刻跑一轮可以用: " + f"{python_exe()} {RUN_ONCE}")
    elif action == "uninstall":
        uninstall()
        print("已卸载。")
    else:
        status()


if __name__ == "__main__":
    main()

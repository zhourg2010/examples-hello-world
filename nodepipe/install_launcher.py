#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""install_launcher.py — 生成"双击就推送"的桌面入口。

    python3 install_launcher.py           # 生成到桌面
    python3 install_launcher.py --here    # 生成到 <NODEPIPE_HOME>/launcher/

各平台生成的东西:
    macOS    推送节点.command       (双击即跑,Finder 认这个后缀)
    Linux    推送节点.desktop       (双击即跑,需要文件管理器允许运行)
    Windows  推送节点.bat           (双击即跑)

每个平台生成三个:快速(只测延迟)、Claude(延迟+解锁检测)、完整(再加测速)。
里面写的是绝对路径,所以移动 nodepipe 代码目录之后要重新跑一次这个脚本。
"""

import sys
import stat
from pathlib import Path

from common import HOME, IS_MACOS, IS_WINDOWS, PKG_DIR, ensure_dirs, platform_name, python_exe

PUSH_NOW = PKG_DIR / "push_now.py"

VARIANTS = [
    ("推送节点-快速", "--fast", "只测延迟,十几秒出结果"),
    ("推送节点-含Claude检测", "--claude", "延迟 + Claude 解锁检测"),
    ("推送节点-完整", "--full", "延迟 + 测速 + Claude,几分钟,期间出口节点会变"),
]


def target_dir(here: bool) -> Path:
    if here:
        return HOME / "launcher"
    # 桌面路径:三个平台都是 ~/Desktop(中文系统的 macOS/Windows 也是这个英文路径,
    # 只是 Finder / 资源管理器显示成"桌面")。没有就退回 launcher/ 目录。
    desktop = Path.home() / "Desktop"
    return desktop if desktop.is_dir() else (HOME / "launcher")


def write_macos(path: Path, flag: str, desc: str):
    # .command 是 macOS 上"双击就在终端里跑"的约定后缀。
    path.write_text(
        "#!/bin/sh\n"
        f"# {desc}\n"
        "# 由 install_launcher.py 生成,不要手改(重新生成会覆盖)。\n"
        f'NODEPIPE_HOME="{HOME}"; export NODEPIPE_HOME\n'
        "NODEPIPE_PAUSE=1; export NODEPIPE_PAUSE\n"
        f'exec "{python_exe()}" "{PUSH_NOW}" {flag}\n',
        encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def write_linux(path: Path, flag: str, desc: str):
    path.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        f"Name={path.stem}\n"
        f"Comment={desc}\n"
        # Terminal=true 让它开个终端窗口,否则跑起来什么都看不见
        "Terminal=true\n"
        f'Exec=env NODEPIPE_HOME="{HOME}" NODEPIPE_PAUSE=1 "{python_exe()}" "{PUSH_NOW}" {flag}\n',
        encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def write_windows(path: Path, flag: str, desc: str):
    path.write_text(
        "@echo off\r\n"
        f"rem {desc}\r\n"
        "rem 由 install_launcher.py 生成,不要手改(重新生成会覆盖)。\r\n"
        "chcp 65001 >nul\r\n"          # 切 UTF-8,不然中文日志在 cmd 里是乱码
        f'set "NODEPIPE_HOME={HOME}"\r\n'
        'set "NODEPIPE_PAUSE=1"\r\n'
        f'"{python_exe()}" "{PUSH_NOW}" {flag}\r\n',
        encoding="utf-8")


def main():
    here = "--here" in sys.argv
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        return 0

    if not PUSH_NOW.exists():
        print(f"ERROR: 找不到 {PUSH_NOW}")
        return 1

    ensure_dirs()
    out = target_dir(here)
    out.mkdir(parents=True, exist_ok=True)

    plat = platform_name()
    if IS_MACOS:
        ext, writer = ".command", write_macos
    elif IS_WINDOWS:
        ext, writer = ".bat", write_windows
    else:
        ext, writer = ".desktop", write_linux

    print(f"平台 {plat},生成到 {out}")
    for name, flag, desc in VARIANTS:
        p = out / (name + ext)
        writer(p, flag, desc)
        print(f"  {p.name:<28} {desc}")

    if IS_MACOS:
        print("\n第一次双击 .command 时 macOS 可能拦一下(未验证的开发者):")
        print("  右键 → 打开 → 再点一次「打开」,之后就直接能双击了。")
    elif not IS_WINDOWS:
        print("\n第一次双击 .desktop 时文件管理器可能要你先「允许启动」:")
        print("  右键 → 属性 → 勾上「允许作为程序执行」。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

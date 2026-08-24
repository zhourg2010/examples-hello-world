#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""push_now.py — 一键:把本地 Clash 里当下好用的美国节点推给 Deno。

这是"自定义客户端"那条路的入口。双击(或命令行跑)它就完事,不需要记环境变量:

    python3 push_now.py                # 用 env 里的设置
    python3 push_now.py --fast         # 只测延迟(最快,十几秒)
    python3 push_now.py --full         # 延迟 + 测速 + Claude 解锁检测(慢,几分钟)
    python3 push_now.py --claude       # 延迟 + Claude 解锁检测(不测速)

跟 subs-check 那条路的区别:这条**不需要 subs-check**,节点直接来自你 Clash Verge Rev
里已经加载的订阅,好不好用也由这里实测。想彻底不用 Mac 那套东西的话,用这个就够了。

三个平台的双击入口在 launcher/ 目录下(install_launcher.py 会生成)。
"""

import os
import sys
import subprocess

from common import ENV_FILE, HOME, PKG_DIR, load_env, python_exe

PRESETS = {
    # 只测延迟。十几秒出结果,不动内核的模式,适合"我刚在 Clash 里看着都挺好,推一批"。
    "--fast": {"CLASH_MIN_SPEED": "0", "CLASH_CHECK_CLAUDE": "0"},
    # 延迟 + Claude 解锁检测。不测速,所以每个节点只多一次 HTTP 请求,比 --full 快得多。
    "--claude": {"CLASH_MIN_SPEED": "0", "CLASH_CHECK_CLAUDE": "1"},
    # 全套。逐节点串行测速 + Claude,100 个节点大约 10 分钟,期间本机出口节点会跟着变。
    "--full": {"CLASH_MIN_SPEED": "0.5", "CLASH_CHECK_CLAUDE": "1"},
}


def main():
    args = [a for a in sys.argv[1:] if a.startswith("--")]
    unknown = [a for a in args if a not in PRESETS]
    if unknown or "--help" in args or "-h" in args:
        print(__doc__)
        if unknown:
            print(f"不认识的参数: {' '.join(unknown)}")
            return 1
        return 0

    load_env()

    if not os.environ.get("PUSH_URL") or not os.environ.get("PUSH_KEY"):
        print("还没配置推送地址。")
        print(f"  1. 把 {PKG_DIR / 'env.example'} 复制成 {ENV_FILE}")
        print("  2. 填好 PUSH_URL 和 PUSH_KEY(SUB_URL 这条路用不上,可以留空)")
        return 1

    env = dict(os.environ)
    env["SOURCE"] = "clash"
    env["NODEPIPE_HOME"] = str(HOME)
    preset = ""
    for a in args:
        env.update(PRESETS[a])
        preset = a
    if preset:
        print(f"模式: {preset}")

    rc = subprocess.call([python_exe(), str(PKG_DIR / "select_and_push.py")], env=env)

    print()
    if rc == 0:
        print("完成。详细日志: " + str(HOME / "logs" / "push.log"))
    elif rc == 130:
        print("已中断。没有推送,Deno 上一批节点保持不变。")
    else:
        print(f"没推成功(退出码 {rc})。看看上面的报错,详细日志: {HOME / 'logs' / 'push.log'}")

    # 双击运行时窗口会立刻关掉,看不到结果。留一下。
    if os.environ.get("NODEPIPE_PAUSE") == "1":
        try:
            input("\n按回车关闭…")
        except EOFError:
            pass
    return rc


if __name__ == "__main__":
    sys.exit(main())

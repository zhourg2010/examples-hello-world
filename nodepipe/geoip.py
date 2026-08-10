#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# geoip.py — 本地 GeoIP 国家判断,不依赖任何在线 API(用户明确要求:怕在线GeoIP服务不稳定)。
#
# 数据源:https://github.com/sapics/ip-location-db (server-country 库)
#   - PDDL 协议,免署名,不用注册/不用 API key
#   - 特意选 server-country 而不是 user-country:后者是"优先判断经VPN用户的真实地区"
#     (给反爬虫/合规场景用的),我们要的是反过来——服务器本身的物理位置,所以用 server-country。
#   - -num.csv 格式:起始IP,结束IP 都已经是整数,不用自己再转换
#
# 定期(默认每7天)重新下载一次刷新库;下载失败/无网络时,继续用本地已缓存的旧版本,
# 绝不因为这一步失败就让整个 us_archive 流程跟着挂掉——库是"锦上添花的验证增强",
# 不是关键路径上不能有闪失的依赖。

import os
import time
import bisect
import ipaddress
import urllib.request
import urllib.error

GEOIP_DB_URL = "https://github.com/sapics/ip-location-db/releases/download/latest/server-country-ipv4-num.csv"

GEOIP_DB_FILE = os.path.expanduser("~/nodepipe/state/geoip/country-ipv4-num.csv")
GEOIP_DB_MAX_AGE_DAYS = int(os.environ.get("GEOIP_DB_MAX_AGE_DAYS", "7"))


def _log(msg):
    logfile = os.path.expanduser("~/nodepipe/logs/geoip.log")
    try:
        os.makedirs(os.path.dirname(logfile), exist_ok=True)
        with open(logfile, "a", encoding="utf-8") as f:
            f.write(str(msg) + "\n")
    except Exception:
        pass
    print(msg)


def ensure_geoip_db() -> bool:
    """库不存在,或者存在但超过 GEOIP_DB_MAX_AGE_DAYS 没更新了,就重新下载。
    下载失败:如果本地已经有(哪怕是旧的)库,继续用旧的,只记警告,不报错中断。
    真的一次都没下载成功过(第一次跑就失败),返回 False,调用方自己决定怎么降级。"""
    exists = os.path.exists(GEOIP_DB_FILE)
    if exists:
        age_days = (time.time() - os.path.getmtime(GEOIP_DB_FILE)) / 86400
        if age_days < GEOIP_DB_MAX_AGE_DAYS:
            return True  # 还新鲜,不用重新下载

    tmp_path = GEOIP_DB_FILE + ".tmp"
    try:
        os.makedirs(os.path.dirname(GEOIP_DB_FILE), exist_ok=True)
        urllib.request.urlretrieve(GEOIP_DB_URL, tmp_path)
        # 简单健全性检查:文件不能小得离谱(下载中断/返回了错误页面之类的情况)
        if os.path.getsize(tmp_path) < 1024 * 100:
            raise ValueError(f"downloaded file suspiciously small ({os.path.getsize(tmp_path)} bytes)")
        os.replace(tmp_path, GEOIP_DB_FILE)  # 原子替换,不会出现"下载一半的坏文件"被当成正式库用
        _log(f"GeoIP DB refreshed OK ({os.path.getsize(GEOIP_DB_FILE)} bytes)")
        return True
    except Exception as e:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        if exists:
            _log(f"WARN: GeoIP DB refresh failed ({e}), keeping existing cached copy")
            return True
        _log(f"WARN: GeoIP DB download failed ({e}) and no cached copy exists yet")
        return False


_ranges_cache = None  # (starts_list, ends_list, ccs_list), 进程内缓存,一次运行只需加载一次


def _load_ranges():
    global _ranges_cache
    if _ranges_cache is not None:
        return _ranges_cache
    starts, ends, ccs = [], [], []
    try:
        with open(GEOIP_DB_FILE, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split(",")
                if len(parts) < 3:
                    continue
                try:
                    starts.append(int(parts[0]))
                    ends.append(int(parts[1]))
                    ccs.append(parts[2])
                except ValueError:
                    continue
    except Exception as e:
        _log(f"WARN: failed to load GeoIP DB into memory: {e}")
        _ranges_cache = ([], [], [])
        return _ranges_cache
    # 文件本身按起始IP升序排列(sapics 的发布格式保证这点),bisect 需要这个前提
    _ranges_cache = (starts, ends, ccs)
    return _ranges_cache


def country_of_ip(ip_str: str) -> str | None:
    """查一个 IPv4 地址属于哪个国家(ISO两位代码,比如 'US')。查不到/不是合法IPv4/库没加载成功都返回 None——
    调用方应该把 None 当成"验证不了",不能当成"确认不是目标国家"。"""
    try:
        ip_int = int(ipaddress.IPv4Address(ip_str))
    except Exception:
        return None  # 不是合法 IPv4(比如是 IPv6,或者传进来的其实是个域名没解析)

    starts, ends, ccs = _load_ranges()
    if not starts:
        return None

    i = bisect.bisect_right(starts, ip_int) - 1
    if i < 0 or i >= len(starts):
        return None
    if starts[i] <= ip_int <= ends[i]:
        return ccs[i]
    return None

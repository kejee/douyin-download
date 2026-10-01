"""代理配置：从**挂载目录里的环境变量文件**读取代理，优先级高于 compose 环境变量。

为什么要有它
------------
容器部署时改代理只能改 compose 再重建容器，而重建会丢掉正在排队的任务；
NAS 用户手上也常常没有编辑器、只有 File Station。把代理写进 `/config` 下的一个
普通文本文件后：**在文件管理器里改一行、刷新网页就生效**，容器不用动。

优先级（高 → 低）
-----------------
1. `proxy.env`（挂载目录里的文件，本模块负责）
2. compose / 命令行传入的环境变量（启动时快照为「基线」）
3. 无

文件里没写的键**不覆盖**基线；文件被删除或清空 → 自动回落到基线。
这样"先试一下代理、不行就把文件删掉"不会留下副作用。

生效时机
--------
本模块只改 `os.environ`，而各平台的抓取代码都是**用的时候才读**环境变量
（多数 httpx 客户端每请求新建、yt-dlp 读 opts 时才取），所以改完文件、触发一次
重载，后续解析与下载就会走新代理。重载点挂在 `/api/server/config`（网页每次刷新都会
请求它）以及解析/下载入口上，按 mtime 缓存，没变就不重复读盘。
"""
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from .paths import app_config_dir, ensure_dir

# 规范文件名放最前，后面的只是容错别名
FILE_NAMES = ("proxy.env", "proxy.txt")

# 这些键会被镜像成「大写 + 小写」两份：
# urllib 的 getproxies_environment() 大小写都认，但**小写优先**；
# httpx 通过它取代理，两份都写最省心。
KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")

# 「只有哪些平台走代理」——它不是环境变量，而是本模块自己的配置项，
# 用来把全局代理**收窄到指定平台**（例如只让 twitter 走代理，其余直连）。
SCOPE_KEYS = ("PROXY_PLATFORMS", "PROXY_ONLY")

# 写了这些等于"所有平台都走代理"（与不写 scope 等价）
_ALL_TOKENS = frozenset({"*", "all", "any", "全部", "所有"})

# 平台标识的常见别名 → 规范名（与 extractors 返回的 platform 字段对齐）
_PLATFORM_ALIASES = {
    "twitter": "twitter", "x": "twitter", "推特": "twitter",
    "bilibili": "bilibili", "b站": "bilibili", "bili": "bilibili",
    "douyin": "douyin", "抖音": "douyin",
    "xhs": "xhs", "xiaohongshu": "xhs", "小红书": "xhs",
    "kuaishou": "kuaishou", "快手": "kuaishou",
    "pipixia": "pipixia", "皮皮虾": "pipixia", "pipix": "pipixia",
    "youtube": "youtube", "yt": "youtube",
}

# 模板内容：**全部注释掉**，所以它不可能意外清掉 compose 里的值
_TEMPLATE = """# 代理配置文件（可选）
#
# 这个文件的优先级**高于** compose 里写的 HTTP_PROXY / HTTPS_PROXY，
# 改完保存、刷新网页即生效，**不需要重建容器**。
#
# ── 写法一：只让部分平台走代理（推荐）─────────────────────────────
#   PROXY_PLATFORMS=twitter
#   http://192.168.1.2:7890
#   这样只有 Twitter/X 的解析与下载走代理，抖音、B站、小红书、快手等一律直连。
#   多个平台用逗号分隔：PROXY_PLATFORMS=twitter,bilibili
#   可用名字：twitter(x) / bilibili / douyin / xhs / kuaishou / pipixia / youtube
#   也认中文：推特 / B站 / 抖音 / 小红书 / 快手 / 皮皮虾
#
#   ⚠️ 限定平台时，代理**不会**写进环境变量 —— 这正是"其余平台直连"的实现方式。
#      所以此时必须走上面这种配置；直接设 HTTP_PROXY 是全局的，做不到只代理一个平台。
#
# ── 写法二：所有平台都走代理 ─────────────────────────────────────
#   最省事的写法，只写一行地址（http 与 https 都会用它）：
#     http://192.168.1.2:7890
#   或者逐项写：
#     HTTP_PROXY=http://192.168.1.2:7890
#     HTTPS_PROXY=http://192.168.1.2:7890
#     NO_PROXY=localhost,127.0.0.1,192.168.0.0/16
#
# 注意：
#   · 必须是**局域网地址**，不能写 127.0.0.1 —— 容器里的 127.0.0.1 是容器自己；
#   · 不写 http:// 也可以（会按 http:// 处理）；
#   · 键不写或留空 = 不覆盖，继续用 compose 里的值；
#   · 把整个文件删掉 = 完全回落到 compose 的设置。

# PROXY_PLATFORMS=twitter
# HTTP_PROXY=
# HTTPS_PROXY=
# NO_PROXY=
"""

_UNSAFE_KEYS = ()  # 预留：将来若有键需要强制清掉，写在这里


def _roots() -> List[str]:
    """候选配置根目录，**顺序即优先级**。

    容器里 `XDG_CONFIG_HOME=/config`，而 app_config_dir() 会再拼一层
    `UniversalDownloader/`。用户在 File Station 里打开挂载出来的 config 目录时，
    第一眼看到的就是根目录 —— 把 proxy.env 放在**根**上，他才找得到；
    放在 `UniversalDownloader/` 子目录里等于藏起来了。

    桌面端没有 XDG_CONFIG_HOME，就只用应用自己的目录（绝不往
    `~/Library/Application Support` 这种系统级目录里写文件）。
    """
    roots: List[str] = []
    xdg = (os.getenv("XDG_CONFIG_HOME") or "").strip()
    if xdg:
        roots.append(xdg)
    own = app_config_dir()
    if own not in roots:
        roots.append(own)
    return roots


def _config_dir() -> str:
    return _roots()[0]


def file_path() -> str:
    """规范配置文件路径（也是界面上给用户看的那个）"""
    return os.path.join(_config_dir(), FILE_NAMES[0])


def _candidate_paths() -> List[str]:
    """按优先级列出所有会被读取的路径（只为容错，正常只用到第一个）"""
    return [os.path.join(root, name) for root in _roots() for name in FILE_NAMES]


def ensure_template() -> bool:
    """首次运行时落一份注释模板，让用户知道该在哪儿写。已存在则不写。"""
    path = file_path()
    if os.path.exists(path):
        return False
    try:
        ensure_dir(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(_TEMPLATE)
        return True
    except OSError:
        return False


def _normalize_url(value: str) -> str:
    """补全 scheme：`192.168.1.2:7890` → `http://192.168.1.2:7890`"""
    value = value.strip()
    if not value:
        return ""
    if "://" not in value:
        return "http://" + value
    return value


def parse_env_file(text: str) -> Tuple[Dict[str, str], List[str], Optional[frozenset]]:
    """解析环境变量文件。容错优先，返回 (键值, 警告列表, 平台白名单)。

    平台白名单为 None 表示**不限制**（所有平台都走代理，默认）；
    为 frozenset 表示**只有这些平台走代理**，其余一律直连。

    支持：`#`/`;` 注释、`export ` 前缀、值两侧引号、CRLF、键大小写不敏感、
    以及**不带等号的一行地址**（等价于同时设置 HTTP_PROXY 与 HTTPS_PROXY）。
    """
    values: Dict[str, str] = {}
    warnings: List[str] = []
    platforms: Optional[frozenset] = None

    for lineno, raw in enumerate((text or "").replace("\r\n", "\n").split("\n"), 1):
        line = raw.replace("\r", "").strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()

        if "=" not in line:
            # 只写了一个地址：http/https 都用它
            url = _normalize_url(line.strip('"').strip("'"))
            if not url:
                continue
            values["HTTP_PROXY"] = url
            values.setdefault("HTTPS_PROXY", url)
            continue

        key, _, val = line.partition("=")
        key = key.strip().upper()
        val = val.strip().strip('"').strip("'").strip()

        if key in SCOPE_KEYS:
            tokens = [t for t in re.split(r"[,\s]+", val) if t]
            if not tokens or any(t.lower() in _ALL_TOKENS for t in tokens):
                platforms = None                     # 不限制
            else:
                resolved, unknown = set(), []
                for token in tokens:
                    name = _PLATFORM_ALIASES.get(token.lower())
                    if name:
                        resolved.add(name)
                    else:
                        unknown.append(token)
                if unknown:
                    warnings.append(
                        f"第 {lineno} 行：{key} 里不认识的平台 {unknown}（已忽略；"
                        f"可用：twitter / bilibili / douyin / xhs / kuaishou / pipixia）"
                    )
                platforms = frozenset(resolved) if resolved else None
            continue

        if key not in KEYS:
            warnings.append(f"第 {lineno} 行：不认识的键 `{key}`（已忽略）")
            continue
        if not val:
            # 留空 = 不覆盖，继续用 compose 的值（模板里全被注释掉，就是靠这条兜底）
            warnings.append(f"第 {lineno} 行：{key} 为空，已忽略（继续用 compose 的值）")
            continue
        values[key] = _normalize_url(val) if key != "NO_PROXY" else val

    # 只给了 http 或 https 其中之一时，镜像到另一个 ——
    # urllib 一旦发现环境里有代理，就**整体**不再读 macOS 系统代理，
    # 只设 http 会让 https 悄悄失去代理，是最容易踩的一种"配对漏配"。
    if "HTTP_PROXY" in values and "HTTPS_PROXY" not in values:
        values["HTTPS_PROXY"] = values["HTTP_PROXY"]
    elif "HTTPS_PROXY" in values and "HTTP_PROXY" not in values:
        values["HTTP_PROXY"] = values["HTTPS_PROXY"]

    return values, warnings, platforms


def mask(url: str) -> str:
    """脱敏：代理地址里可能带 `user:password@`，别原样回给前端。"""
    if not url:
        return ""
    return re.sub(r"(://[^:/@]*:)[^@]*(@)", r"\1***\2", url)


# ---------------------------------------------------------------------------
# 状态与重载
# ---------------------------------------------------------------------------

_baseline: Optional[Dict[str, str]] = None   # compose 那一层（启动时快照，抓完就不再变）
_effective: Dict[str, str] = {}              # 文件覆盖基线之后的最终值
_platforms: Optional[frozenset] = None       # None = 不限制平台；否则只有这些平台走代理
_status: Dict[str, Any] = {
    "active": False, "source": "none", "file": file_path(), "file_exists": False,
    "file_used": "", "keys": {}, "from_file": {}, "from_env": {},
    "warnings": [], "reloaded_at": 0.0, "scope": "all", "platforms": [],
}
_stamp: Optional[Tuple[int, int, str]] = None   # (mtime_ns, size, path)
_loaded = False


def _snapshot_baseline() -> Dict[str, str]:
    """把启动时的环境变量记为基线（**必须在任何覆盖之前**抓，只抓一次）"""
    global _baseline
    if _baseline is None:
        _baseline = {}
        for key in KEYS:
            for name in (key, key.lower()):
                val = (os.environ.get(name) or "").strip()
                if val:
                    _baseline[key] = val
                    break
    return _baseline


def _read_file() -> Tuple[str, str, str, List[str]]:
    """找并读第一个存在的配置文件，返回 (路径, 内容, 错误, )"""
    for path in _candidate_paths():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8-sig") as handle:
                return path, handle.read(), "", []
        except OSError as exc:
            return path, "", f"读取失败：{exc}", []
    return "", "", "", []


def _stat_stamp() -> Tuple[int, int, str]:
    """按 mtime+size 判断要不要重读；文件不存在时也给一个稳定的戳"""
    for path in _candidate_paths():
        try:
            info = os.stat(path)
            return (info.st_mtime_ns, info.st_size, path)
        except OSError:
            continue
    return (0, 0, "")


def _apply(target: Dict[str, str]) -> None:
    """把目标值写进 os.environ；不在目标里的键一并清掉，避免残留旧值。

    大小写两份都写：urllib 的 getproxies_environment() 小写优先，
    只写一份时行为依赖库的实现细节，不值得赌。
    """
    for key in KEYS:
        value = target.get(key, "")
        for name in (key, key.lower()):
            try:
                if value:
                    os.environ[name] = value
                else:
                    os.environ.pop(name, None)
            except (OSError, ValueError):
                pass


def reload(force: bool = False) -> Dict[str, Any]:
    """按需重读配置文件并更新环境变量，返回当前状态。

    文件没变化（mtime+size 相同）时直接返回缓存，代价只有一次 stat ——
    所以可以放心挂在「每次刷新网页」和「每次提交任务」上。
    """
    global _stamp, _loaded, _status, _effective, _platforms

    baseline = _snapshot_baseline()
    stamp = _stat_stamp()
    if _loaded and not force and stamp == _stamp:
        return dict(_status)

    path, text, err, _ = _read_file()
    file_values: Dict[str, str] = {}
    warnings: List[str] = []
    platforms: Optional[frozenset] = None
    if path:
        if err:
            warnings.append(err)
        else:
            file_values, warnings, platforms = parse_env_file(text)

    # 有效代理值 = 基线 + 文件覆盖（不管作用范围如何，这个值都要算出来，
    # 因为「只让 twitter 走代理」时，twitter 仍然要用它）
    effective = dict(baseline)
    effective.update(file_values)

    _effective = effective
    _platforms = platforms

    if platforms is None:
        # 不限制：把代理写进环境变量，所有客户端（httpx trust_env / yt-dlp）都会走
        target = effective
        scope = "all"
    else:
        # **限定平台时绝不能写全局环境变量** —— 否则"不想要的平台"照样会走代理，
        # 那就等于没限定。这里只清掉代理变量，需要代理的平台在调用点显式取用
        # （proxy_for / proxy_for_url），其余平台自然直连。
        target = {}
        scope = "selected"
        if not effective.get("HTTP_PROXY") and not effective.get("HTTPS_PROXY"):
            warnings.append(
                "指定了 PROXY_PLATFORMS，但没有可用的代理地址（文件或 compose 里都没填）"
            )
    _apply(target)

    if file_values or platforms is not None:
        source = "file"
    elif baseline:
        source = "env"
    else:
        source = "none"

    _stamp = stamp
    _loaded = True
    _status = {
        "active": bool(effective.get("HTTP_PROXY") or effective.get("HTTPS_PROXY")
                       or effective.get("ALL_PROXY")),
        "source": source,
        "scope": scope,
        # 限定平台时给出名单，界面据此显示"只作用于：twitter"
        "platforms": sorted(platforms) if platforms else [],
        # 用户最关心的两个地址（脱敏后）
        "http": mask(effective.get("HTTP_PROXY", "")),
        "https": mask(effective.get("HTTPS_PROXY", "")),
        "no_proxy": effective.get("NO_PROXY", ""),
        "keys": {k: (mask(v) if k != "NO_PROXY" else v) for k, v in sorted(effective.items())},
        "from_file": {k: (mask(v) if k != "NO_PROXY" else v) for k, v in sorted(file_values.items())},
        "from_env": {k: (mask(v) if k != "NO_PROXY" else v) for k, v in sorted(baseline.items())},
        # 给界面用的三个字段
        "file": file_path(),
        "file_exists": bool(path),
        "file_used": path,
        "warnings": warnings,
        "reloaded_at": time.time(),
    }
    return dict(_status)


def _base_proxy() -> Optional[str]:
    return (_effective.get("HTTP_PROXY") or _effective.get("HTTPS_PROXY")
            or _effective.get("ALL_PROXY") or None)


def proxy_for(platform: str = "") -> Optional[str]:
    """**某个平台**该用的代理地址；None = 这个平台直连。

    这是"只让某些插件走代理"的落地点：限定平台时，调用方必须显式取这个值
    （因为环境变量里已经没有代理了）。
    """
    reload()
    if _platforms is not None:
        raw = (platform or "").strip().lower()
        name = _PLATFORM_ALIASES.get(raw, raw)
        if name not in _platforms:
            return None
    return _base_proxy()


def proxy_for_url(url: str) -> Optional[str]:
    """按媒体直链反推平台，再决定要不要走代理。

    下载/预览阶段手里只有一条 CDN 直链（如 video.twimg.com/...），
    平台只能从域名推断 —— 复用 http_util 那张域名表，避免第二份口径。
    """
    from .http_util import platform_for_url      # 延迟导入，避免包初始化期的循环
    return proxy_for(platform_for_url(url))


def status() -> Dict[str, Any]:
    """只读当前状态（不碰磁盘）；从未加载过时先加载一次"""
    if not _loaded:
        return reload()
    return dict(_status)


def active_proxy() -> Optional[str]:
    """配置里配的代理地址（未脱敏），**不考虑平台限定**。

    要按平台判断请用 `proxy_for(platform)` / `proxy_for_url(url)` ——
    限定平台时环境变量是空的，这个函数仍会返回地址，直接用就绕过了限定。
    """
    reload()
    return _base_proxy()

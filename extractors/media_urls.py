"""
媒体 CDN 地址策略（解析层与下载层共用，不依赖任何项目内模块）。

背景：B站会把部分码率变体调度到第三方 PCDN 边缘节点
（`*.mcdn.bilivideo.cn:8082` / `*.edge.mountaintoys.cn:4483`，即返回体里的
`os=mcdn`）。这类节点按 IP + 会话授权，稳定性显著低于官方 CDN，实测会直接返回
403；而官方 `upos-*` 镜像接受**同一份签名路径与查询串**（实测 6/6 可用）。

因此本模块提供两件事：
1. `stream_candidate_urls()`：解析时汇总 baseUrl + backupUrl，**官方 CDN 优先、PCDN 垫底**；
2. `build_download_candidates()`：下载失败时给出「原地址 → 备份 → 官方镜像改写」
   的换源候选列表。
"""
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlsplit, urlunsplit

# 第三方 PCDN / 边缘节点特征
PCDN_HOST_MARKERS = ("mcdn.bilivideo.cn", "edge.mountaintoys.cn", "pcdn")

# 官方 CDN 镜像（实测均接受 PCDN 签名路径）
BILIBILI_MIRROR_HOSTS = (
    "upos-sz-mirrorcos.bilivideo.com",
    "upos-sz-mirrorhw.bilivideo.com",
    "upos-sz-estghw.bilivideo.com",
    "upos-sz-estgcos.bilivideo.com",
    "upos-sz-estgoss.bilivideo.com",
    "upos-sz-mirrorali.bilivideo.com",
)

_BILIBILI_HOST_MARKERS = (
    "bilivideo.com",
    "bilivideo.cn",
    "bilibili.com",
    "hdslb.com",
    "mountaintoys.cn",
)


def host_of(url: str) -> str:
    try:
        return urlsplit(url).netloc.lower()
    except (ValueError, AttributeError):
        return ""


def is_pcdn_url(url: str) -> bool:
    """是否为按 IP+会话授权的第三方 PCDN 地址"""
    host = host_of(url)
    return bool(host) and any(marker in host for marker in PCDN_HOST_MARKERS)


def is_bilibili_media_url(url: str) -> bool:
    host = host_of(url)
    return any(marker in host for marker in _BILIBILI_HOST_MARKERS)


def rewrite_host(url: str, host: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))


def _dedupe(urls: Iterable[str]) -> List[str]:
    result: List[str] = []
    for url in urls:
        if url and url not in result:
            result.append(url)
    return result


def _official_first(urls: List[str]) -> List[str]:
    official = [u for u in urls if not is_pcdn_url(u)]
    pcdn = [u for u in urls if is_pcdn_url(u)]
    return official + pcdn


def stream_candidate_urls(stream: Dict[str, Any]) -> List[str]:
    """汇总一条 DASH 流的 baseUrl + backupUrl，官方 CDN 优先、PCDN 垫底。

    返回列表首项即"应当优先使用"的地址；后续项可用于换源重试。
    """
    if not isinstance(stream, dict):
        return []
    urls = []
    base = stream.get("baseUrl") or stream.get("base_url") or stream.get("url")
    if base:
        urls.append(base)
    for backup in stream.get("backupUrl") or stream.get("backup_url") or []:
        if backup:
            urls.append(backup)
    return _official_first(_dedupe(urls))


def build_download_candidates(url: str, backups: Optional[List[str]] = None) -> List[str]:
    """下载候选地址：原地址 → 显式备份地址 → 官方镜像改写。

    仅在原地址被拒（4xx/5xx）时才会用到后续项，成功路径行为不变。
    """
    candidates = _dedupe([url, *(backups or [])])
    if url and is_bilibili_media_url(url):
        for host in BILIBILI_MIRROR_HOSTS:
            if host_of(url) == host:
                continue
            candidates.append(rewrite_host(url, host))
    return _dedupe(candidates)

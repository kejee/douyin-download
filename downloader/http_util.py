"""
平台相关的 HTTP 请求头推断。

桌面端"原生保存"下载与服务端代理下载必须共用同一套规则，
否则同一个媒体直链会出现"一条路径能下、另一条 403"的诡异现象。
"""
import os
from typing import List, Optional

from extractors.media_urls import is_bilibili_media_url

# 通用桌面 UA（各平台 CDN 均接受）
DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# 各平台 CDN 防盗链所需的 Referer，以及该域名归属的**平台标识**。
# 平台名与各 extractor 返回的 `platform` 字段一致（bilibili / douyin / xhs /
# kuaishou / pipixia / twitter），"哪些平台走代理"就是按这个标识来匹配的。
# 三件事（Referer、平台归属、代理是否启用）**共用这一张表**：
# 分散成两份迟早会不一致 —— 那正是本项目「重复下载没提示」的根因。
_REFERER_RULES = (
    (("xhscdn.com", "xiaohongshu.com"), "https://www.xiaohongshu.com/", "xhs"),
    (("kuaishou.com", "gifshow.com", "yximgs.com"), "https://www.kuaishou.com/", "kuaishou"),
    (("pipix.com", "snssdk.com"), "https://h5.pipix.com/", "pipixia"),
    (
        ("bilibili.com", "bilivideo.cn", "bilivideo.com", "hdslb.com"),
        "https://www.bilibili.com/",
        "bilibili",
    ),
    (("twimg.com", "twitter.com", "x.com"), "https://twitter.com/", "twitter"),
    (
        ("douyin.com", "douyinpic.com", "douyinstatic.com", "douyinvod.com"),
        "https://www.douyin.com/",
        "douyin",
    ),
)


def referer_for_url(url: str) -> str:
    """按 CDN 域名推断合法 Referer，默认回落到抖音站"""
    if not url:
        return "https://www.douyin.com/"
    lowered = url.lower()
    for domains, referer, _platform in _REFERER_RULES:
        if any(d in lowered for d in domains):
            return referer
    return "https://www.douyin.com/"


def platform_for_url(url: str, default: str = "media") -> str:
    """按媒体直链的域名推断它属于哪个平台，认不出时返回 default。

    用途：**下载/预览阶段手里只有一条 CDN 直链**（没有解析结果），
    但"哪些平台走代理"需要知道平台 —— 例如 video.twimg.com 要认成 twitter。
    """
    if not url:
        return default
    lowered = url.lower()
    for domains, _referer, platform in _REFERER_RULES:
        if any(d in lowered for d in domains):
            return platform
    return default


def bilibili_cookie(sessdata: Optional[str] = None) -> str:
    """B站鉴权 Cookie：优先用任务携带的 SESSDATA，其次环境变量"""
    sessdata = (sessdata or "").strip()
    if sessdata:
        return f"SESSDATA={sessdata}"
    env_cookie = (os.getenv("BILIBILI_COOKIE") or "").strip()
    if env_cookie:
        return env_cookie
    env_sess = (os.getenv("SESSDATA") or "").strip()
    return f"SESSDATA={env_sess}" if env_sess else ""


def download_headers(url: str, user_agent: Optional[str] = None, cookie: str = "") -> dict:
    """构造带正确 Referer（以及 B站鉴权 Cookie）的下载请求头。

    解析阶段带了 SESSDATA、下载阶段却不带，会让登录态高码率流在部分
    CDN/PCDN 节点被判未授权（403），因此这里必须一并透传。
    """
    headers = {
        "User-Agent": user_agent or DESKTOP_UA,
        "Referer": referer_for_url(url),
    }
    if cookie and is_bilibili_media_url(url):
        headers["Cookie"] = cookie
    return headers

"""
平台相关的 HTTP 请求头推断。

桌面端"原生保存"下载与服务端代理下载必须共用同一套规则，
否则同一个媒体直链会出现"一条路径能下、另一条 403"的诡异现象。
"""
from typing import Optional

# 通用桌面 UA（各平台 CDN 均接受）
DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# 各平台 CDN 防盗链所需的 Referer
_REFERER_RULES = (
    (("xhscdn.com", "xiaohongshu.com"), "https://www.xiaohongshu.com/"),
    (("kuaishou.com", "gifshow.com", "yximgs.com"), "https://www.kuaishou.com/"),
    (("pipix.com", "snssdk.com"), "https://h5.pipix.com/"),
    (
        ("bilibili.com", "bilivideo.cn", "bilivideo.com", "hdslb.com"),
        "https://www.bilibili.com/",
    ),
    (("twimg.com", "twitter.com", "x.com"), "https://twitter.com/"),
    (("douyin.com", "douyinpic.com", "douyinstatic.com", "douyinvod.com"), "https://www.douyin.com/"),
)


def referer_for_url(url: str) -> str:
    """按 CDN 域名推断合法 Referer，默认回落到抖音站"""
    if not url:
        return "https://www.douyin.com/"
    lowered = url.lower()
    for domains, referer in _REFERER_RULES:
        if any(d in lowered for d in domains):
            return referer
    return "https://www.douyin.com/"


def download_headers(url: str, user_agent: Optional[str] = None) -> dict:
    """构造带正确 Referer 的下载请求头"""
    return {
        "User-Agent": user_agent or DESKTOP_UA,
        "Referer": referer_for_url(url),
    }

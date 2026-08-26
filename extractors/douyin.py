import re
import json
import urllib.parse
from typing import Dict, Any, Optional, List
import httpx

from extractors.base import (
    BaseExtractor,
    MediaResponse,
    AuthorInfo,
    StatisticsInfo,
    MusicInfo,
    VideoInfo,
)

APP_USER_AGENT = (
    "com.ss.android.ugc.aweme/230501 (Linux; U; Android 10; zh_CN; MI 9; Build/QKQ1.190825.002; Cronet/TTNetVersion:b4d74d15 2020-04-23 QuicVersion:0144d358 2020-03-24)"
)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

class DouyinExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        self.app_headers = {
            "User-Agent": APP_USER_AGENT,
            "Accept": "*/*",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "douyin.com",
            "iesdouyin.com",
            "tiktok.com",
        ])

    async def get_aweme_id(self, url: str) -> Optional[str]:
        """根据输入的抖音链接，追踪重定向获取真实的 aweme_id"""
        # 1. 尝试直接从当前 URL 匹配
        id_match = re.search(r"/(?:video|note)/(\d+)", url)
        if id_match:
            return id_match.group(1)

        # 2. 发起重定向追踪
        async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
            try:
                resp = await client.get(url)
                final_url = str(resp.url)
                
                # 从最终 URL 路径匹配
                id_match = re.search(r"/(?:video|note)/(\d+)", final_url)
                if id_match:
                    return id_match.group(1)
                
                # 从查询参数匹配
                id_match = re.search(r"(?:modal_id|item_ids|aweme_id)=(\d+)", final_url)
                if id_match:
                    return id_match.group(1)
            except Exception:
                pass
        return None

    async def _fetch_from_feed_api(self, client: httpx.AsyncClient, aweme_id: str) -> Optional[Dict[str, Any]]:
        """方案一（最稳定）：通过客户端原生 Feed 接口获取完整作品信息"""
        feed_endpoints = [
            f"https://api5-normal-c-lq.amemv.com/aweme/v1/feed/?aweme_id={aweme_id}",
            f"https://api.amemv.com/aweme/v1/feed/?aweme_id={aweme_id}",
            f"https://api3-normal-c-hl.amemv.com/aweme/v1/feed/?aweme_id={aweme_id}",
        ]
        
        for ep in feed_endpoints:
            try:
                resp = await client.get(ep, headers=self.app_headers, timeout=self.timeout)
                if resp.status_code == 200 and resp.text:
                    data = resp.json()
                    aweme_list = data.get("aweme_list", [])
                    if aweme_list and len(aweme_list) > 0:
                        return aweme_list[0]
            except Exception:
                continue
        return None

    def _extract_item_from_html(self, html: str) -> Optional[Dict[str, Any]]:
        """方案二：从 H5 分享页 SSR HTML 中提取数据"""
        router_match = re.search(r"window\._ROUTER_DATA\s*=\s*(.*?);\s*</script>", html, re.DOTALL)
        if router_match:
            try:
                raw_json = router_match.group(1).strip().rstrip(";")
                data = json.loads(raw_json)
                loader_data = data.get("loaderData", {})
                for key, val in loader_data.items():
                    if isinstance(val, dict):
                        item_list = val.get("videoInfoRes", {}).get("item_list", [])
                        if item_list and isinstance(item_list, list) and len(item_list) > 0:
                            return item_list[0]
                        if "item_list" in val and len(val["item_list"]) > 0:
                            return val["item_list"][0]
            except Exception:
                pass

        ssr_match = re.search(r"window\._SSR_DATA\s*=\s*(.*?);\s*</script>", html, re.DOTALL)
        if ssr_match:
            try:
                raw_json = ssr_match.group(1).strip().rstrip(";")
                data = json.loads(raw_json)
                item = data.get("itemInfo", {}).get("itemStruct")
                if item:
                    return item
            except Exception:
                pass

        return None

    async def _resolve_real_video_url(self, client: httpx.AsyncClient, video_url: str) -> str:
        """获取视频重定向后的真实 CDN 地址"""
        if not video_url:
            return ""
        try:
            resp = await client.get(
                video_url,
                headers={"User-Agent": DEFAULT_USER_AGENT, "Referer": "https://www.douyin.com/"},
                follow_redirects=True,
                timeout=self.timeout,
            )
            return str(resp.url)
        except Exception:
            return video_url

    async def extract(self, url: str) -> MediaResponse:
        aweme_id = await self.get_aweme_id(url)
        if not aweme_id:
            return MediaResponse(
                success=False,
                platform="douyin",
                platform_name="抖音",
                type="video",
                id="",
                title="",
                error="未能解析出抖音视频 ID，请确认链接是否有效",
            )

        async with httpx.AsyncClient(headers=self.headers, timeout=self.timeout) as client:
            # 1. 优先调用客户端原生 Feed 接口
            item = await self._fetch_from_feed_api(client, aweme_id)

            # 2. 备用策略：从分享页 SSR 数据提取
            if not item:
                try:
                    share_url = f"https://www.iesdouyin.com/share/video/{aweme_id}/"
                    resp = await client.get(share_url, follow_redirects=True)
                    item = self._extract_item_from_html(resp.text)
                except Exception:
                    pass

            if not item:
                return MediaResponse(
                    success=False,
                    platform="douyin",
                    platform_name="抖音",
                    type="video",
                    id=aweme_id,
                    title="",
                    error="获取抖音视频数据失败，可能是接口风控或链接已失效",
                )

            # 整理元数据
            title = item.get("desc", f"douyin_{aweme_id}").strip()
            create_time = item.get("create_time", 0)

            # 作者信息
            author = item.get("author", {})
            author_avatar = (
                author.get("avatar_thumb", {}).get("url_list", [""])[0] 
                or author.get("avatar_medium", {}).get("url_list", [""])[0]
                or author.get("avatar_larger", {}).get("url_list", [""])[0]
            )
            author_info = AuthorInfo(
                nickname=author.get("nickname", "未知作者"),
                avatar=author_avatar,
                unique_id=author.get("unique_id") or author.get("short_id") or "未知ID",
                signature=author.get("signature", ""),
            )

            # 互动数据
            stats = item.get("statistics", {})
            statistics_info = StatisticsInfo(
                digg_count=stats.get("digg_count", 0),
                comment_count=stats.get("comment_count", 0),
                share_count=stats.get("share_count", 0),
                play_count=stats.get("play_count", 0),
            )

            # 背景音乐
            music = item.get("music", {})
            music_play = music.get("play_url", {}) if music else {}
            music_url = music_play.get("url_list", [""])[0] if music_play else ""
            music_info = MusicInfo(
                title=music.get("title", "") if music else "",
                author=music.get("author", "") if music else "",
                url=music_url,
                cover=music.get("cover_large", {}).get("url_list", [""])[0] if music else "",
            )

            # 封面
            video_info = item.get("video", {})
            covers = (
                video_info.get("origin_cover", {}).get("url_list", [])
                or video_info.get("cover", {}).get("url_list", [])
                or video_info.get("dynamic_cover", {}).get("url_list", [])
            )
            cover_url = covers[0] if covers else ""

            # 判断类型：图集 or 视频
            images = item.get("images")
            if images and isinstance(images, list) and len(images) > 0:
                img_urls = []
                for img in images:
                    urls = img.get("url_list", [])
                    if urls:
                        img_urls.append(urls[0])

                return MediaResponse(
                    success=True,
                    platform="douyin",
                    platform_name="抖音",
                    type="images",
                    id=aweme_id,
                    title=title,
                    cover=cover_url or (img_urls[0] if img_urls else ""),
                    author=author_info,
                    statistics=statistics_info,
                    music=music_info,
                    images=img_urls,
                    image_count=len(img_urls),
                    create_time=create_time,
                )
            else:
                # 视频资源
                bit_rate = video_info.get("bit_rate", [])
                play_url_list = []
                if bit_rate and isinstance(bit_rate, list) and len(bit_rate) > 0:
                    sorted_bitrate = sorted(bit_rate, key=lambda x: x.get("bit_rate", 0), reverse=True)
                    play_url_list = sorted_bitrate[0].get("play_addr", {}).get("url_list", [])
                
                if not play_url_list:
                    play_url_list = video_info.get("play_addr", {}).get("url_list", [])

                raw_play_url = play_url_list[0] if play_url_list else ""
                nowm_url = raw_play_url.replace("playwm", "play") if raw_play_url else ""
                wm_url = (
                    video_info.get("download_addr", {}).get("url_list", [""])[0]
                    or raw_play_url
                )

                real_nowm_url = await self._resolve_real_video_url(client, nowm_url) if nowm_url else ""

                return MediaResponse(
                    success=True,
                    platform="douyin",
                    platform_name="抖音",
                    type="video",
                    id=aweme_id,
                    title=title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=music_info,
                    video=VideoInfo(
                        no_watermark_url=real_nowm_url or nowm_url,
                        watermark_url=wm_url,
                        ratio=video_info.get("ratio", "720p"),
                        width=video_info.get("width", 0),
                        height=video_info.get("height", 0),
                        duration=video_info.get("duration", 0),
                    ),
                    create_time=create_time,
                )

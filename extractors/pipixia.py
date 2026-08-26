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

DEFAULT_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

class PipixiaExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": DEFAULT_MOBILE_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "pipix.com",
            "pipixia.com",
        ])

    def _extract_item_from_html(self, html: str) -> Optional[Dict[str, Any]]:
        """从页面提取 SSR 内嵌数据 (ppxItemDetail)"""
        # 1. 尝试匹配 URL 编码的 JSON 数据
        match = re.search(r"<script[^>]*>(%7B%22.*?)</script>", html, re.DOTALL)
        if match:
            try:
                raw_encoded = match.group(1).strip()
                decoded = urllib.parse.unquote(raw_encoded)
                data = json.loads(decoded)
                item = data.get("ppxItemDetail", {}).get("item")
                if item and isinstance(item, dict):
                    return item
            except Exception:
                pass

        # 2. 尝试常规 JSON 格式
        match_regular = re.search(r'window\.__INITIAL_STATE__\s*=\s*(.*?);?\s*</script>', html, re.DOTALL)
        if match_regular:
            try:
                data = json.loads(match_regular.group(1).strip().rstrip(";"))
                item = data.get("itemDetail", {}).get("item") or data.get("item")
                if item and isinstance(item, dict):
                    return item
            except Exception:
                pass

        return None

    async def extract(self, url: str) -> MediaResponse:
        async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
            try:
                resp = await client.get(url)
                final_url = str(resp.url)
            except Exception as e:
                return MediaResponse(
                    success=False,
                    platform="pipixia",
                    platform_name="皮皮虾",
                    type="video",
                    id="",
                    title="",
                    error=f"请求皮皮虾链接失败: {str(e)}",
                )

            # 检查官方返回 404
            if "404 not found" in resp.text.lower():
                return MediaResponse(
                    success=False,
                    platform="pipixia",
                    platform_name="皮皮虾",
                    type="video",
                    id="",
                    title="",
                    error="该皮皮虾作品已被作者删除、下架或短链接已过期失效",
                )

            id_match = re.search(r"/(?:item|cell|post)/(\d+)", final_url)
            cell_id = id_match.group(1) if id_match else ""

            item = self._extract_item_from_html(resp.text)
            if not item:
                return MediaResponse(
                    success=False,
                    platform="pipixia",
                    platform_name="皮皮虾",
                    type="video",
                    id=cell_id,
                    title="",
                    error="未能提取到皮皮虾作品数据，请检查链接或稍后再试",
                )

            item_id = str(item.get("item_id") or cell_id or "ppx_media")
            title = item.get("content") or item.get("share", {}).get("title") or f"皮皮虾作品_{item_id}"
            create_time = item.get("create_time", 0)

            # 作者信息
            author = item.get("author", {})
            author_avatar = ""
            if isinstance(author.get("avatar"), dict):
                u_list = author["avatar"].get("url_list", [])
                if u_list:
                    author_avatar = u_list[0].get("url") if isinstance(u_list[0], dict) else str(u_list[0])
            elif isinstance(author.get("avatar"), str):
                author_avatar = author.get("avatar")

            author_info = AuthorInfo(
                nickname=author.get("name", "皮友"),
                avatar=author_avatar,
                unique_id=str(author.get("id", "")),
                signature=author.get("description", ""),
            )

            # 统计数据
            stats = item.get("stats", {})
            statistics_info = StatisticsInfo(
                digg_count=int(stats.get("like_count", 0) or 0),
                comment_count=int(stats.get("comment_count", 0) or 0),
                share_count=int(stats.get("share_count", 0) or 0),
                play_count=int(stats.get("play_count", 0) or stats.get("view_count", 0) or 0),
            )

            # 判断视频 or 图集
            video_info = item.get("video")
            if video_info and isinstance(video_info, dict):
                # 1. 优先从 item 根层级提取 origin_video_download (原始无水印)
                origin_video_download = item.get("origin_video_download")
                no_wm_url = ""
                if origin_video_download and isinstance(origin_video_download, dict):
                    u_list = origin_video_download.get("url_list", [])
                    if u_list:
                        no_wm_url = u_list[0].get("url") if isinstance(u_list[0], dict) else u_list[0]

                # 2. 依次尝试 video_high / video_fallback / video_download
                wm_url = ""
                for k in ["video_high", "video_fallback", "video_mid", "video_download", "video_low"]:
                    v_obj = video_info.get(k)
                    if v_obj and isinstance(v_obj, dict):
                        u_list = v_obj.get("url_list", [])
                        if u_list:
                            u_str = u_list[0].get("url") if isinstance(u_list[0], dict) else u_list[0]
                            if u_str:
                                if not no_wm_url and k != "video_download":
                                    no_wm_url = u_str
                                if not wm_url:
                                    wm_url = u_str

                if not no_wm_url:
                    no_wm_url = wm_url

                cover_url = ""
                cover_obj = video_info.get("cover_image", {})
                if cover_obj and isinstance(cover_obj, dict):
                    c_list = cover_obj.get("url_list", [])
                    if c_list:
                        cover_url = c_list[0].get("url") if isinstance(c_list[0], dict) else c_list[0]

                width = int(video_info.get("video_width", 0) or 0)
                height = int(video_info.get("video_height", 0) or 0)
                duration = int(video_info.get("duration", 0) or 0)

                return MediaResponse(
                    success=True,
                    platform="pipixia",
                    platform_name="皮皮虾",
                    type="video",
                    id=item_id,
                    title=title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=MusicInfo(),
                    video=VideoInfo(
                        no_watermark_url=no_wm_url,
                        watermark_url=wm_url,
                        ratio=f"{width}x{height}" if width and height else "720p",
                        width=width,
                        height=height,
                        duration=duration,
                    ),
                    create_time=create_time,
                )
            else:
                # 图集作品
                images = item.get("images", []) or item.get("image_list", [])
                img_urls = []
                for img in images:
                    if isinstance(img, dict):
                        urls = img.get("url_list", [])
                        if urls:
                            u = urls[0].get("url") if isinstance(urls[0], dict) else urls[0]
                            if u:
                                img_urls.append(u)
                    elif isinstance(img, str):
                        img_urls.append(img)

                cover_url = img_urls[0] if img_urls else ""

                return MediaResponse(
                    success=True,
                    platform="pipixia",
                    platform_name="皮皮虾",
                    type="images",
                    id=item_id,
                    title=title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=MusicInfo(),
                    images=img_urls,
                    image_count=len(img_urls),
                    create_time=create_time,
                )

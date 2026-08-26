import re
import json
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

XHS_DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

class XiaohongshuExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": XHS_DESKTOP_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "xhslink.com",
            "xhslink.cn",
            "xhs.link",
            "xiaohongshu.com",
        ])

    def _extract_initial_state(self, html: str) -> Optional[Dict[str, Any]]:
        """从页面提取 window.__INITIAL_STATE__"""
        match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(.*?)</script>", html, re.DOTALL)
        if match:
            raw_str = match.group(1).strip().rstrip(";")
            raw_str = raw_str.replace("undefined", "null")
            try:
                return json.loads(raw_str)
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
                    platform="xhs",
                    platform_name="小红书",
                    type="images",
                    id="",
                    title="",
                    error=f"请求小红书链接失败: {str(e)}",
                )

            id_match = re.search(r"/(?:explore|discovery/item)/([a-zA-Z0-9]+)", final_url)
            note_id = id_match.group(1) if id_match else ""

            data = self._extract_initial_state(resp.text)
            if not data:
                return MediaResponse(
                    success=False,
                    platform="xhs",
                    platform_name="小红书",
                    type="images",
                    id=note_id,
                    title="",
                    error="未能提取到小红书数据，请检查链接或稍后重试",
                )

            note_detail = {}
            note_map = data.get("note", {}).get("noteDetailMap", {})
            if note_id and note_id in note_map:
                note_detail = note_map[note_id].get("note", {})
            elif note_map:
                first_key = next(iter(note_map))
                note_id = first_key
                note_detail = note_map[first_key].get("note", {})
            
            if not note_detail:
                note_detail = data.get("note", {}).get("note", {}) or data.get("noteData", {})

            if not note_detail:
                return MediaResponse(
                    success=False,
                    platform="xhs",
                    platform_name="小红书",
                    type="images",
                    id=note_id,
                    title="",
                    error="未能读取到笔记详情内容",
                )

            title = note_detail.get("title") or note_detail.get("desc", f"xhs_{note_id}")
            desc = note_detail.get("desc", "")
            full_title = f"{title}\n{desc}".strip() if desc and desc != title else title
            create_time = note_detail.get("time", 0)

            # 作者信息
            user_data = note_detail.get("user", {})
            author_info = AuthorInfo(
                nickname=user_data.get("nickname") or user_data.get("nickName", "小红书用户"),
                avatar=user_data.get("avatar", ""),
                unique_id=user_data.get("userId") or user_data.get("redId", "未知ID"),
                signature="",
            )

            # 互动数据
            interact = note_detail.get("interactInfo", {})
            statistics_info = StatisticsInfo(
                digg_count=int(interact.get("likedCount", 0) or 0),
                comment_count=int(interact.get("commentCount", 0) or 0),
                share_count=int(interact.get("shareCount", 0) or 0),
                play_count=0,
            )

            # 判断类型：视频 or 图集
            note_type = note_detail.get("type", "normal")
            video_data = note_detail.get("video")

            if (note_type == "video" or video_data) and isinstance(video_data, dict):
                # 视频笔记
                media = video_data.get("media", {})
                stream = media.get("stream", {})
                h264_list = stream.get("h264", []) or stream.get("h265", [])
                
                video_url = ""
                if h264_list and isinstance(h264_list, list):
                    video_url = h264_list[0].get("masterUrl", "")

                # 封面 (提取完整有效防盗链签名地址)
                cover_url = ""
                if note_detail.get("imageList"):
                    img_first = note_detail["imageList"][0]
                    cover_url = img_first.get("urlDefault") or img_first.get("urlPre") or img_first.get("url") or ""

                return MediaResponse(
                    success=True,
                    platform="xhs",
                    platform_name="小红书",
                    type="video",
                    id=note_id,
                    title=full_title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=MusicInfo(),
                    video=VideoInfo(
                        no_watermark_url=video_url,
                        watermark_url=video_url,
                        ratio="1080p",
                    ),
                    create_time=create_time,
                )
            else:
                # 图集笔记 (保留有效防盗链签名)
                raw_images = note_detail.get("imageList", [])
                clean_img_urls = []
                for img in raw_images:
                    url_default = (
                        img.get("urlDefault") 
                        or img.get("urlOriginal") 
                        or img.get("urlPre")
                        or img.get("url") 
                        or ""
                    )
                    if url_default:
                        clean_img_urls.append(url_default)

                cover_url = clean_img_urls[0] if clean_img_urls else ""

                return MediaResponse(
                    success=True,
                    platform="xhs",
                    platform_name="小红书",
                    type="images",
                    id=note_id,
                    title=full_title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=MusicInfo(),
                    images=clean_img_urls,
                    image_count=len(clean_img_urls),
                    create_time=create_time,
                )

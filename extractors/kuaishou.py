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

KUAISHOU_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

class KuaishouExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": KUAISHOU_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "kuaishou.com",
            "gifshow.com",
            "chenzhongtech.com",
        ])

    async def extract(self, url: str) -> MediaResponse:
        async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
            try:
                resp = await client.get(url)
                final_url = str(resp.url)
            except Exception as e:
                return MediaResponse(
                    success=False,
                    platform="kuaishou",
                    platform_name="快手",
                    type="video",
                    id="",
                    title="",
                    error=f"请求快手链接失败: {str(e)}",
                )

            # 提取 photoId
            id_match = re.search(r"/(?:photo|short-video)/([a-zA-Z0-9]+)", final_url)
            photo_id = id_match.group(1) if id_match else "ks_media"

            # 匹配网页内嵌数据 (window.INIT_STATE)
            init_state_match = re.search(r"window\.INIT_STATE\s*=\s*(.*?);?\s*</script>", resp.text, re.DOTALL)
            photo_data = None

            if init_state_match:
                try:
                    state_json = init_state_match.group(1).strip().rstrip(";")
                    state_data = json.loads(state_json)
                    for k, v in state_data.items():
                        if isinstance(v, dict) and "photo" in v and isinstance(v["photo"], dict):
                            photo_data = v["photo"]
                            break
                        if isinstance(v, dict) and "currentWork" in v and isinstance(v["currentWork"], dict):
                            photo_data = v["currentWork"]
                            break
                except Exception:
                    pass

            if not photo_data:
                # 备用正则匹配
                video_url_match = re.search(r'"url"\s*:\s*"(https://[^"]+\.mp4[^"]*)"', resp.text)
                if video_url_match:
                    clean_video_url = video_url_match.group(1).encode("utf-8").decode("unicode_escape")
                    return MediaResponse(
                        success=True,
                        platform="kuaishou",
                        platform_name="快手",
                        type="video",
                        id=photo_id,
                        title=f"快手视频_{photo_id}",
                        author=AuthorInfo(nickname="快手创作者"),
                        statistics=StatisticsInfo(),
                        video=VideoInfo(
                            no_watermark_url=clean_video_url,
                            watermark_url=clean_video_url,
                            ratio="720p",
                        ),
                    )

                return MediaResponse(
                    success=False,
                    platform="kuaishou",
                    platform_name="快手",
                    type="video",
                    id=photo_id,
                    title="",
                    error="未能提取到快手视频数据，可能链接已失效或被风控",
                )

            title = photo_data.get("caption", f"kuaishou_{photo_id}")
            author_name = photo_data.get("userName") or photo_data.get("author", {}).get("name", "快手创作者")
            author_avatar = (
                photo_data.get("headUrl")
                or (photo_data.get("headUrls", [""])[0] if photo_data.get("headUrls") else "")
                or photo_data.get("author", {}).get("headerUrl", "")
            )
            author_id = str(photo_data.get("userId") or photo_data.get("author", {}).get("id", ""))
            
            author_info = AuthorInfo(
                nickname=author_name,
                avatar=author_avatar,
                unique_id=author_id,
            )

            # 提取点赞、评论、播放与分享互动数据
            statistics_info = StatisticsInfo(
                digg_count=int(photo_data.get("likeCount", 0) or photo_data.get("realLikeCount", 0) or 0),
                comment_count=int(photo_data.get("commentCount", 0) or 0),
                share_count=int(photo_data.get("forwardCount", 0) or photo_data.get("shareCount", 0) or 0),
                play_count=int(photo_data.get("viewCount", 0) or 0),
            )

            # 封面
            covers = photo_data.get("coverUrls", []) or photo_data.get("webpCoverUrls", [])
            cover_url = covers[0].get("url") if (covers and isinstance(covers[0], dict)) else (covers[0] if covers else photo_data.get("coverUrl", ""))

            # 音乐
            music_data = photo_data.get("music", {})
            music_info = MusicInfo()
            if music_data and isinstance(music_data, dict):
                audio_urls = music_data.get("audioUrls", [])
                m_url = audio_urls[0].get("url") if (audio_urls and isinstance(audio_urls[0], dict)) else (audio_urls[0] if audio_urls else "")
                music_info = MusicInfo(
                    title=music_data.get("name") or music_data.get("title", ""),
                    author=music_data.get("artist") or music_data.get("author", ""),
                    url=m_url,
                    cover=music_data.get("avatar", ""),
                )

            # 判断是否为图集
            ext_params = photo_data.get("ext_params", {})
            atlas = ext_params.get("atlas", {}) if isinstance(ext_params, dict) else {}
            if atlas and isinstance(atlas, dict) and "list" in atlas:
                img_list = atlas.get("list", [])
                img_urls = [f"https://{img}" if not str(img).startswith("http") else str(img) for img in img_list]
                return MediaResponse(
                    success=True,
                    platform="kuaishou",
                    platform_name="快手",
                    type="images",
                    id=photo_id,
                    title=title,
                    cover=cover_url or (img_urls[0] if img_urls else ""),
                    author=author_info,
                    statistics=statistics_info,
                    music=music_info,
                    images=img_urls,
                    image_count=len(img_urls),
                )

            # 视频
            main_mv_urls = photo_data.get("mainMvUrls", [])
            video_url = main_mv_urls[0].get("url") if (main_mv_urls and isinstance(main_mv_urls[0], dict)) else photo_data.get("photoUrl", "")
            duration_raw = int(photo_data.get("duration", 0) or 0)
            duration = int(duration_raw / 1000) if duration_raw > 1000 else duration_raw
            width = int(photo_data.get("width", 0) or 0)
            height = int(photo_data.get("height", 0) or 0)

            return MediaResponse(
                success=True,
                platform="kuaishou",
                platform_name="快手",
                type="video",
                id=photo_id,
                title=title,
                cover=cover_url,
                author=author_info,
                statistics=statistics_info,
                music=music_info,
                video=VideoInfo(
                    no_watermark_url=video_url,
                    watermark_url=video_url,
                    ratio=f"{width}x{height}" if width and height else "720p",
                    width=width,
                    height=height,
                    duration=duration,
                ),
            )

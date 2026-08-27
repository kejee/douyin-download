import re
import os
import json
import asyncio
from typing import Dict, Any, List, Optional
import httpx
from .base import (
    BaseExtractor,
    VideoInfo,
    AuthorInfo,
    StatisticsInfo,
    MediaResponse,
    QualityOption,
)

TWITTER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

def format_bytes(size_bytes: int) -> str:
    """格式化字节大小为可读字符串"""
    if not size_bytes or size_bytes <= 0:
        return ""
    if size_bytes >= 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"
    elif size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    elif size_bytes >= 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB" if size_bytes >= 1000000 else f"{size_bytes / 1024:.0f} KB"
    return f"{size_bytes} B"

class TwitterExtractor(BaseExtractor):
    """Twitter / X 平台推文视频与高清原图解析器"""

    def __init__(self, timeout: float = 20.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": TWITTER_UA,
            "Referer": "https://twitter.com/",
            "Accept": "*/*",
        }
        # 支持从环境变量获取代理配置
        self.proxy = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or None

    def match(self, url: str) -> bool:
        """匹配 Twitter / X 域名"""
        patterns = [
            r'twitter\.com',
            r'x\.com',
            r't\.co',
        ]
        return any(re.search(p, url, re.IGNORECASE) for p in patterns)

    def _extract_tweet_id(self, url: str) -> Optional[str]:
        """从 URL 提取 Tweet ID"""
        # 匹配 https://twitter.com/username/status/123456789 或 https://x.com/i/status/123456789
        match = re.search(r'(?:twitter\.com|x\.com)/[^/]+/status/(\d+)', url)
        if match:
            return match.group(1)
        
        # 匹配单纯的 status/123456789
        match = re.search(r'status/(\d+)', url)
        if match:
            return match.group(1)
            
        return None

    async def _resolve_short_url(self, url: str) -> str:
        """追踪 t.co 等短链接"""
        if "t.co" in url or "x.com" in url or "twitter.com" in url:
            try:
                async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=10.0, proxy=self.proxy) as client:
                    resp = await client.get(url)
                    return str(resp.url)
            except Exception:
                pass
        return url

    async def extract(self, url: str) -> MediaResponse:
        real_url = await self._resolve_short_url(url)
        tweet_id = self._extract_tweet_id(real_url)
        
        if not tweet_id:
            # 若未能从 URL 直接提取，尝试解析完整 URL
            tweet_id = self._extract_tweet_id(url)
            
        if not tweet_id:
            return MediaResponse(
                success=False,
                platform="twitter",
                platform_name="Twitter / X",
                type="video",
                id="",
                title="",
                author=AuthorInfo(),
                statistics=StatisticsInfo(),
                error="无法识别推文链接中的 Tweet ID，请提供格式如 https://x.com/username/status/123456 的链接",
            )

        # 1. 优先通道 A: 尝试通过官方 Syndication API / 开放接口获取
        try:
            res = await self._extract_via_api(tweet_id)
            if res and res.success:
                return res
        except Exception:
            pass

        # 2. 坚固兜底通道 B: 调用 yt-dlp
        try:
            res_ytdlp = await self._extract_via_ytdlp(real_url or url, tweet_id)
            if res_ytdlp and res_ytdlp.success:
                return res_ytdlp
        except Exception as e:
            return MediaResponse(
                success=False,
                platform="twitter",
                platform_name="Twitter / X",
                type="video",
                id=tweet_id,
                title="",
                author=AuthorInfo(),
                statistics=StatisticsInfo(),
                error=f"解析 Twitter 推文失败: {str(e)}",
            )

        return MediaResponse(
            success=False,
            platform="twitter",
            platform_name="Twitter / X",
            type="video",
            id=tweet_id,
            title="",
            author=AuthorInfo(),
            statistics=StatisticsInfo(),
            error="无法获取该推文媒体内容（可能推文已删除、设为私密或需要登录）",
        )

    async def _extract_via_api(self, tweet_id: str) -> Optional[MediaResponse]:
        """通过 Syndication / 镜像 API 提取推文"""
        # Syndication Token
        syndication_url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&token=5"
        
        async with httpx.AsyncClient(headers=self.headers, timeout=self.timeout, proxy=self.proxy) as client:
            resp = await client.get(syndication_url)
            if resp.status_code != 200:
                return None
                
            try:
                data = resp.json()
            except Exception:
                return None

        # 提取推文基本信息
        text = data.get("text", "")
        # 去除末尾的 t.co 链接
        clean_text = re.sub(r'https://t\.co/\w+$', '', text).strip()
        
        user_data = data.get("user", {})
        nickname = user_data.get("name", "Twitter User")
        screen_name = user_data.get("screen_name", "")
        avatar_url = user_data.get("profile_image_url_https", "")
        if avatar_url:
            # 替换为高清大头像
            avatar_url = avatar_url.replace("_normal.", "_400x400.")

        author = AuthorInfo(
            nickname=nickname,
            unique_id=f"@{screen_name}" if screen_name else "",
            avatar=avatar_url,
        )

        statistics = StatisticsInfo(
            digg_count=data.get("favorite_count", 0),
            comment_count=data.get("reply_count", 0),
            share_count=data.get("retweet_count", 0),
            play_count=data.get("views", {}).get("count", 0) if isinstance(data.get("views"), dict) else 0,
        )

        # 检查是否包含图集 photos
        photos = data.get("photos", [])
        video_data = data.get("video", {})
        media_entities = data.get("mediaDetails", [])

        # 若包含视频/GIF
        if video_data and video_data.get("variants"):
            variants = video_data.get("variants", [])
            # 过滤 mp4 格式并按码率降序
            mp4_variants = [v for v in variants if v.get("type") == "video/mp4" or "mp4" in v.get("src", "")]
            mp4_variants.sort(key=lambda x: x.get("bitrate", 0), reverse=True)

            if mp4_variants:
                best_video = mp4_variants[0]
                best_url = best_video.get("src", "")
                poster_url = video_data.get("poster", "")
                duration_sec = int(video_data.get("durationMillis", 0) / 1000)

                # 构造多画质选项
                qualities: List[QualityOption] = []
                for v in mp4_variants:
                    src = v.get("src", "")
                    bitrate = v.get("bitrate", 0)
                    
                    # 从 URL 中提取分辨率标识，如 /vid/avc1/1280x720/xxx.mp4 或 /vid/720x1280/xxx.mp4
                    res_match = re.search(r'/vid/(?:avc1/)?(\d+x\d+)/', src)
                    res_tag = res_match.group(1) if res_match else ""
                    
                    label = "原画高清"
                    if bitrate > 2000000 or "1080" in res_tag:
                        label = f"1080P 高清 {f'({res_tag})' if res_tag else ''}"
                    elif bitrate > 800000 or "720" in res_tag:
                        label = f"720P 高清 {f'({res_tag})' if res_tag else ''}"
                    elif bitrate > 300000 or "480" in res_tag:
                        label = f"480P 清晰 {f'({res_tag})' if res_tag else ''}"
                    elif res_tag:
                        label = f"标清 ({res_tag})"
                    else:
                        label = f"普清 ({bitrate // 1000} Kbps)"

                    # 预估体积 = bitrate * duration / 8
                    size_bytes = int((bitrate * duration_sec) / 8) if bitrate and duration_sec else 0
                    size_str = format_bytes(size_bytes)
                    if size_str:
                        label += f" ~ {size_str}"

                    qualities.append(QualityOption(
                        id=str(bitrate),
                        label=label.strip(),
                        video_url=src,
                        audio_url="",
                        filesize_bytes=size_bytes,
                        filesize_str=size_str,
                        codec="H.264",
                    ))

                return MediaResponse(
                    success=True,
                    platform="twitter",
                    platform_name="Twitter / X",
                    type="video",
                    title=clean_text or "Twitter 视频",
                    author=author,
                    statistics=statistics,
                    cover=poster_url,
                    video=VideoInfo(
                        watermark_url="",
                        no_watermark_url=best_url,
                        audio_url="",
                        ratio="1080P 高清" if len(qualities) > 0 and "1080" in qualities[0].label else "高清",
                        duration=duration_sec,
                        qualities=qualities,
                    ),
                    id=tweet_id,
                )

        # 若包含图片列表
        if photos or media_entities:
            image_urls: List[str] = []
            img_list = photos if photos else media_entities
            for p in img_list:
                orig_url = p.get("url") or p.get("media_url_https", "")
                if orig_url:
                    # 转换为原图 4K 尺寸 name=orig
                    if "?" in orig_url:
                        base = orig_url.split("?")[0]
                        orig_url = f"{base}?format=jpg&name=orig"
                    else:
                        orig_url = f"{orig_url}?format=jpg&name=orig"
                    image_urls.append(orig_url)

            if image_urls:
                return MediaResponse(
                    success=True,
                    platform="twitter",
                    platform_name="Twitter / X",
                    type="images",
                    title=clean_text or "Twitter 图集",
                    author=author,
                    statistics=statistics,
                    cover=image_urls[0],
                    images=image_urls,
                    image_count=len(image_urls),
                    id=tweet_id,
                )

        # 若为纯文本推文（无视频/图片）
        if clean_text:
            return MediaResponse(
                success=True,
                platform="twitter",
                platform_name="Twitter / X",
                type="text",
                title=clean_text,
                author=author,
                statistics=statistics,
                id=tweet_id,
            )

        return None

    async def _extract_via_ytdlp(self, url: str, tweet_id: str) -> Optional[MediaResponse]:
        """通过 yt-dlp 引擎提取"""
        cmd = [
            "yt-dlp",
            "-j",
            "--no-warnings",
            "--no-check-certificates",
            "--socket-timeout", "15",
            url
        ]

        if self.proxy:
            cmd.extend(["--proxy", self.proxy])

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0 or not stdout:
            return None

        data = json.loads(stdout.decode('utf-8'))
        title = data.get("title") or data.get("description") or "Twitter 视频"
        clean_title = re.sub(r'https://t\.co/\w+', '', title).strip()

        uploader = data.get("uploader") or data.get("uploader_id") or "Twitter User"
        uploader_id = data.get("uploader_id", "")
        author = AuthorInfo(
            nickname=uploader,
            unique_id=f"@{uploader_id}" if uploader_id else "",
            avatar="",
        )

        statistics = StatisticsInfo(
            digg_count=data.get("like_count", 0),
            comment_count=data.get("comment_count", 0),
            share_count=data.get("repost_count", 0),
            play_count=data.get("view_count", 0),
        )

        formats = data.get("formats", [])
        mp4_formats = [f for f in formats if f.get("ext") == "mp4" and f.get("url")]
        mp4_formats.sort(key=lambda x: x.get("height", 0) or x.get("tbr", 0) or 0, reverse=True)

        qualities: List[QualityOption] = []
        for f in mp4_formats:
            v_url = f.get("url", "")
            height = f.get("height")
            width = f.get("width")
            filesize = f.get("filesize") or f.get("filesize_approx") or 0
            size_str = format_bytes(filesize)
            
            label = f"{height}P 高清" if height else "MP4 标清"
            if width and height:
                label += f" ({width}x{height})"
            if size_str:
                label += f" ~ {size_str}"

            qualities.append(QualityOption(
                id=str(f.get("format_id", "")),
                label=label,
                video_url=v_url,
                audio_url="",
                filesize_bytes=filesize,
                filesize_str=size_str,
                width=width,
                height=height,
                codec="H.264",
            ))

        best_video_url = mp4_formats[0].get("url") if mp4_formats else data.get("url", "")
        cover = data.get("thumbnail", "")
        duration = int(data.get("duration", 0))

        return MediaResponse(
            success=True,
            platform="twitter",
            platform_name="Twitter / X",
            type="video",
            title=clean_title,
            author=author,
            statistics=statistics,
            cover=cover,
            video=VideoInfo(
                watermark_url="",
                no_watermark_url=best_video_url,
                audio_url="",
                ratio=f"{qualities[0].height}P 高清" if qualities and qualities[0].height else "高清",
                duration=duration,
                qualities=qualities,
            ),
            id=tweet_id,
        )

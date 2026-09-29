import re
import os
import json
import asyncio
import logging
import tempfile
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

logger = logging.getLogger(__name__)

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

    async def extract(
        self,
        url: str,
        auth_token: Optional[str] = None,
        ct0: Optional[str] = None,
    ) -> MediaResponse:
        auth_token = (auth_token or "").strip() or os.getenv("TWITTER_AUTH_TOKEN", "").strip() or None
        ct0 = (ct0 or "").strip() or os.getenv("TWITTER_CT0", "").strip() or None

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

        # 1. 优先通道 A: 尝试通过官方 Syndication API / 开放接口获取（匿名极速）
        try:
            res = await self._extract_via_api(tweet_id)
            if res and res.success:
                return res
        except Exception:
            pass

        # 2. 坚固兜底通道 B: 调用 yt-dlp（支持凭证解锁敏感/需登录推文）
        try:
            res_ytdlp = await self._extract_via_ytdlp(
                real_url or url, tweet_id, auth_token=auth_token, ct0=ct0
            )
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

        err_msg = (
            "无法获取该推文媒体内容（推文可能已删除、设为私密或当前 Twitter 凭证已失效）"
            if auth_token
            else "无法获取该推文媒体内容（此推文可能需要登录或含敏感内容。请配置 Twitter auth_token 凭证后重试）"
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
            error=err_msg,
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
            mp4_variants = [v for v in variants if v.get("type") == "video/mp4" or "mp4" in v.get("src", "")]

            def get_variant_score(v: dict) -> int:
                src = v.get("src", "")
                bitrate = v.get("bitrate") or 0
                match = re.search(r'/vid/(?:avc1/)?(\d+)x(\d+)/', src)
                if match:
                    w, h = int(match.group(1)), int(match.group(2))
                    return max(w, h) * 10000000 + bitrate
                return bitrate

            # 严格按分辨率长边权重与码率从大到小排序
            mp4_variants.sort(key=get_variant_score, reverse=True)

            if mp4_variants:
                poster_url = video_data.get("poster", "")
                duration_sec = int(video_data.get("durationMillis", 0) / 1000)

                # 构造多画质选项 (按分辨率去重，保留最高码率)
                seen_res = set()
                qualities: List[QualityOption] = []
                for v in mp4_variants:
                    src = v.get("src", "")
                    bitrate = v.get("bitrate", 0) or 0
                    
                    # 从 URL 中提取分辨率标识，如 /vid/avc1/1280x720/xxx.mp4 或 /vid/720x1280/xxx.mp4
                    res_match = re.search(r'/vid/(?:avc1/)?(\d+)x(\d+)/', src)
                    if res_match:
                        w, h = int(res_match.group(1)), int(res_match.group(2))
                        res_tag = f"{w}x{h}"
                        min_dim = min(w, h)
                        max_dim = max(w, h)
                    else:
                        res_tag = ""
                        min_dim = 0
                        max_dim = 0

                    res_key = f"{min_dim}p" if min_dim else src
                    if res_key in seen_res:
                        continue
                    seen_res.add(res_key)

                    label = "原画高清"
                    if max_dim >= 1920 or min_dim >= 1080 or bitrate > 2000000:
                        label = f"1080P 高清 {f'({res_tag})' if res_tag else ''}"
                    elif max_dim >= 1280 or min_dim >= 720 or bitrate > 800000:
                        label = f"720P 高清 {f'({res_tag})' if res_tag else ''}"
                    elif max_dim >= 850 or min_dim >= 480 or bitrate > 300000:
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
                        id=str(bitrate or len(qualities)),
                        label=label.strip(),
                        video_url=src,
                        audio_url="",
                        filesize_bytes=size_bytes,
                        filesize_str=size_str,
                        width=w if res_match else 0,
                        height=h if res_match else 0,
                        codec="H.264",
                    ))

                best_url = qualities[0].video_url if qualities else mp4_variants[0].get("src", "")
                best_label = qualities[0].label.split("(")[0].strip() if qualities else "高清"
                video_backup_urls = []
                for variant in (mp4_variants or []):
                    src_u = variant.get("src") if isinstance(variant, dict) else None
                    if src_u and src_u != best_url and src_u not in video_backup_urls:
                        video_backup_urls.append(src_u)

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
                        video_backup_urls=video_backup_urls,
                        audio_url="",
                        ratio=best_label,
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

    async def _extract_via_ytdlp(
        self,
        url: str,
        tweet_id: str,
        auth_token: Optional[str] = None,
        ct0: Optional[str] = None,
    ) -> Optional[MediaResponse]:
        """通过 yt-dlp 引擎提取（支持 Netscape Cookie 鉴权与详细错误探测）"""
        temp_cookie_path = None
        cmd = [
            "yt-dlp",
            "-j",
            "--no-warnings",
            "--no-check-certificates",
            "--socket-timeout", "20",
        ]

        try:
            if auth_token:
                domains = [".twitter.com", ".x.com", "api.twitter.com", "api.x.com", "twitter.com", "x.com"]
                cookie_lines = ["# Netscape HTTP Cookie File"]
                for dom in domains:
                    cookie_lines.append(f"{dom}\tTRUE\t/\tTRUE\t2147483647\tauth_token\t{auth_token}")
                    if ct0:
                        cookie_lines.append(f"{dom}\tTRUE\t/\tTRUE\t2147483647\tct0\t{ct0}")

                fd, temp_cookie_path = tempfile.mkstemp(prefix="tw_cookie_", suffix=".txt")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write("\n".join(cookie_lines) + "\n")

                cmd.extend(["--cookies", temp_cookie_path])
                if ct0:
                    cmd.extend(["--add-header", f"x-csrf-token:{ct0}"])
                cmd.extend(["--add-header", f"authorization:Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"])
                cmd.extend(["--user-agent", TWITTER_UA])
                cmd.extend(["--referer", "https://x.com/"])

            cmd.append(url)

            if self.proxy:
                cmd.extend(["--proxy", self.proxy])

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            err_text = (stderr.decode("utf-8", errors="ignore") if stderr else "").strip()

            if process.returncode != 0 or not stdout:
                if err_text:
                    logger.warning(f"[{tweet_id}] yt-dlp Twitter 提取日志: {err_text}")
                    # 匹配精准错误原因
                    if "Private tweet" in err_text or "protected" in err_text.lower():
                        raise ValueError("该推文为私密推文（锁推），需要推主互关/授权方可查看")
                    if "age-restricted" in err_text.lower() or "nsfw" in err_text.lower():
                        raise ValueError("该推文含成人/敏感内容，您的 Twitter 账号设置中需开启「允许显示敏感内容」")
                    if "rate limit" in err_text.lower():
                        raise ValueError("Twitter 接口访问受限 (Rate Limit)，请稍候再试")
                    if "login" in err_text.lower() or "unauthorized" in err_text.lower():
                        raise ValueError("Twitter 提示凭证已过期或无效，请重新登录 x.com 复制最新的 auth_token")
                    
                    # 提取 ERROR 行反馈给用户
                    first_err = [line for line in err_text.splitlines() if "ERROR:" in line]
                    if first_err:
                        clean_err = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?", "", first_err[0])
                        raise ValueError(f"Twitter 提取失败: {clean_err}")
                return None
        finally:
            if temp_cookie_path and os.path.exists(temp_cookie_path):
                try:
                    os.remove(temp_cookie_path)
                except Exception:
                    pass

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

        def get_format_score(f: dict) -> int:
            h = f.get("height") or 0
            w = f.get("width") or 0
            tbr = f.get("tbr") or 0
            filesize = f.get("filesize") or f.get("filesize_approx") or 0
            return max(w, h) * 100000000 + h * 1000000 + int(tbr * 1000) + int(filesize / 1024)

        mp4_formats.sort(key=get_format_score, reverse=True)

        seen_heights = set()
        qualities: List[QualityOption] = []
        for f in mp4_formats:
            v_url = f.get("url", "")
            height = f.get("height")
            width = f.get("width")
            filesize = f.get("filesize") or f.get("filesize_approx") or 0
            size_str = format_bytes(filesize)
            
            res_key = f"{height}p" if height else v_url
            if res_key in seen_heights:
                continue
            seen_heights.add(res_key)

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

        best_video_url = qualities[0].video_url if qualities else (mp4_formats[0].get("url") if mp4_formats else data.get("url", ""))
        best_ratio = qualities[0].label.split("(")[0].strip() if qualities else "高清"
        video_backup_urls = []
        for variant in (mp4_formats or []):
            src_u = variant.get("url") if isinstance(variant, dict) else None
            if src_u and src_u != best_video_url and src_u not in video_backup_urls:
                video_backup_urls.append(src_u)
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
                video_backup_urls=video_backup_urls,
                audio_url="",
                ratio=best_ratio,
                duration=duration,
                qualities=qualities,
            ),
            id=tweet_id,
        )

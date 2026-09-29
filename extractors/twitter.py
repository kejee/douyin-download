import re
import os
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


class _YTDLPLogger:
    """把 yt-dlp 的日志转发到本项目 logger。

    必须显式接管输出：打包成 windowed app（desktop.spec 里 console=False）后
    sys.stderr / sys.stdout 可能是 None，yt-dlp 的默认 logger 直接往流里写会抛异常。
    这里刻意用 debug 级别承接 info/warning —— 正常解析不该往用户日志里倒 yt-dlp 的
    每行输出，只有 error 提到 warning 便于排障。
    """

    def debug(self, msg):
        logger.debug(msg)

    def info(self, msg):
        logger.debug(msg)

    def warning(self, msg):
        logger.debug(msg)

    def error(self, msg):
        logger.warning(f"[yt-dlp] {msg}")


_YTDLP_LOGGER = _YTDLPLogger()

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
        fallback: Optional[MediaResponse] = None
        try:
            res = await self._extract_via_api(tweet_id)
            if res and res.success:
                # 纯文本结果先不全信：敏感内容的推文在这个接口里可能**只回文本、
                # 把媒体字段整个剥掉**，直接返回文本卡片会让用户以为
                # "解析成功了但没有视频"。配了凭证就继续走通道 B 试一次，
                # B 也拿不到才回落这张文本卡片（普通纯文本推文行为不变）。
                if res.type == "text" and auth_token:
                    fallback = res
                else:
                    return res
        except Exception as e:
            logger.debug(f"[{tweet_id}] syndication 通道无结果: {e}")

        # 2. 坚固兜底通道 B: 内置 yt-dlp 库（支持凭证解锁敏感/需登录推文）
        try:
            res_ytdlp = await self._extract_via_ytdlp(
                real_url or url, tweet_id, auth_token=auth_token, ct0=ct0
            )
            if res_ytdlp and res_ytdlp.success:
                return res_ytdlp
        except Exception as e:
            logger.warning(f"[{tweet_id}] Twitter 凭证通道失败: {e}")
            if fallback is not None:
                return fallback
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

        if fallback is not None:
            return fallback

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

    @staticmethod
    def _translate_ytdlp_error(err_text: str) -> str:
        """把 yt-dlp 的英文报错翻译成可操作的中文提示

        顺序有讲究：先判最能定位问题的（锁推 / 敏感内容 / 限流 / 凭证失效），
        都不匹配再原样回传（截断），别把 yt-dlp 的原始信息吃掉 —— 排障时它最有用。
        """
        low = (err_text or "").lower()
        if "private tweet" in low or "protected" in low:
            return "该推文为私密推文（锁推），需要推主互关/授权方可查看"
        if "age-restricted" in low or "nsfw" in low or "sensitive" in low:
            return "该推文含成人/敏感内容，您的 Twitter 账号设置中需开启「允许显示敏感内容」"
        if "rate limit" in low or "too many requests" in low:
            return "Twitter 接口访问受限 (Rate Limit)，请稍候再试"
        if any(k in low for k in ("login", "unauthorized", "401", "could not authenticate")):
            return "Twitter 提示凭证已过期或无效：请重新登录 x.com，从 Cookie 里复制最新的 auth_token 与 ct0"
        if "no video could be found" in low or "no media" in low:
            return "该推文里没有可下载的视频或图片"
        clean = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?", "", (err_text or "").strip())
        clean = re.sub(r"\s+", " ", clean)
        return f"Twitter 提取失败: {clean[:300]}"

    def _write_twitter_cookie_file(self, auth_token: str, ct0: Optional[str]) -> str:
        """把 auth_token / ct0 写成 yt-dlp 认的 Netscape cookie 文件，返回路径。

        两个必须遵守的硬约束（各踩过一次）：

        1. **域名必须覆盖 api.x.com**：yt-dlp 的 TwitterBaseIE._API_BASE 就是
           https://api.x.com/1.1/，它用 _get_cookies(该 URL) 取 auth_token 判断
           "是否已登录"、并取 ct0 当 x-csrf-token。只写 .twitter.com 时
           api.x.com 匹配不上 → 判定为未登录 → 敏感内容/需登录推文照样拿不到。
        2. **域名与"包含子域"标记必须一致**：Netscape 格式里带前导点的域名
           （`.x.com`）子域标记才能是 TRUE，无点的（`x.com`）只能是 FALSE。
           写成 `api.x.com\tTRUE\t...` 会被 cookie 解析器判为非法行，
           整份文件直接加载失败（报 "invalid Netscape format cookies file"），
           结果是**一个 cookie 都没生效**。

        所以这里只写带点的两个根域：`.x.com` 与 `.twitter.com` 都能匹配到
        各自的子域（api.x.com / api.twitter.com），既合法又够用。
        """
        domains = [".x.com", ".twitter.com"]
        cookie_lines = ["# Netscape HTTP Cookie File"]
        for dom in domains:
            cookie_lines.append(f"{dom}\tTRUE\t/\tTRUE\t2147483647\tauth_token\t{auth_token}")
            if ct0:
                cookie_lines.append(f"{dom}\tTRUE\t/\tTRUE\t2147483647\tct0\t{ct0}")
        fd, path = tempfile.mkstemp(prefix="tw_cookie_", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(cookie_lines) + "\n")
        return path

    async def _extract_via_ytdlp(
        self,
        url: str,
        tweet_id: str,
        auth_token: Optional[str] = None,
        ct0: Optional[str] = None,
    ) -> Optional[MediaResponse]:
        """通过**内置的 yt-dlp Python 库**提取（凭证可解锁需登录/敏感内容推文）

        为什么必须是库、不能是 `yt-dlp` 命令行：打包成 .app 之后进程里根本没有
        `yt-dlp` 这个可执行文件（desktop.spec 只把 yt_dlp 作为 Python 模块收进去，
        它也不是 PATH 上的命令）。旧实现 create_subprocess_exec("yt-dlp", ...)
        会直接抛 FileNotFoundError，被外层 catch 成
        "解析 Twitter 推文失败: [Errno 2] No such file or directory: 'yt-dlp'"
        —— 于是**配了凭证也永远解析失败**。项目里 bilibili 的 yt-dlp 通道一直是
        按库调用的（extractors/bilibili.py），这里统一成同一种用法。

        鉴权只需要 cookie 文件：yt-dlp 的 TwitterBaseIE._set_base_headers() 会自己
        从 cookie 里取 auth_token / ct0 组装 Authorization 与 x-csrf-token，
        而它的 _API_BASE 是 https://api.x.com/1.1/ —— 所以 cookie 域名必须覆盖
        api.x.com（下面 domains 里已包含）。**不要**再手动注入那两个头：
        手写的 bearer 是写死的旧值，只会和 yt-dlp 自己的鉴权打架。
        """
        temp_cookie_path = None
        try:
            import yt_dlp
        except ImportError as e:      # 理论上不会（requirements.txt 里有 yt-dlp）
            logger.warning(f"[{tweet_id}] yt-dlp 库不可用: {e}")
            return None

        opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
            "noplaylist": True,
            "socket_timeout": 20,
            "logger": _YTDLP_LOGGER,
        }

        try:
            if auth_token:
                temp_cookie_path = self._write_twitter_cookie_file(auth_token, ct0)
                opts["cookiefile"] = temp_cookie_path

            if self.proxy:
                opts["proxy"] = self.proxy

            def _run() -> Dict[str, Any]:
                # 只解析不下载：拿到 info dict 由下面统一映射成 MediaResponse
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(url, download=False) or {}

            # yt-dlp 是同步阻塞的，丢到线程里跑，别把事件循环（和 SSE 推送）占住
            data = await asyncio.to_thread(_run)
        except yt_dlp.utils.DownloadError as e:
            err_text = str(e)
            logger.warning(f"[{tweet_id}] yt-dlp Twitter 提取失败: {err_text}")
            raise ValueError(self._translate_ytdlp_error(err_text))
        except Exception as e:
            logger.warning(f"[{tweet_id}] yt-dlp 调用异常: {type(e).__name__}: {e}")
            raise ValueError(f"Twitter 提取失败: {type(e).__name__}: {e}")
        finally:
            if temp_cookie_path and os.path.exists(temp_cookie_path):
                try:
                    os.remove(temp_cookie_path)
                except Exception:
                    pass

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

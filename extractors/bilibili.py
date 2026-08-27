import re
import asyncio
from typing import Dict, Any, Optional, List
import httpx

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

from extractors.base import (
    BaseExtractor,
    MediaResponse,
    AuthorInfo,
    StatisticsInfo,
    MusicInfo,
    VideoInfo,
    QualityOption,
)

BILIBILI_DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

QUALITY_MAP = {
    127: "8K 超高清",
    120: "4K 超清",
    116: "1080P 60帧",
    112: "1080P 高码率",
    80: "1080P 高清",
    64: "720P 高清",
    32: "480P 清晰",
    16: "360P 流畅",
}

def format_bytes(size_bytes: int) -> str:
    """格式化字节大小为可读字符串"""
    if not size_bytes or size_bytes <= 0:
        return ""
    if size_bytes >= 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"
    elif size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    elif size_bytes >= 1024:
        return f"{size_bytes / 1024:.0f} KB"
    return f"{size_bytes} B"

class BilibiliExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.headers = {
            "User-Agent": BILIBILI_DESKTOP_UA,
            "Referer": "https://www.bilibili.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "bilibili.com",
            "b23.tv",
            "bili2233.cn",
        ])

    async def get_bvid_or_aid(self, url: str) -> Optional[str]:
        """提取或跟随短链获取 BV 号或 AV 号"""
        # 1. 直接正则匹配 BV 号
        bv_match = re.search(r"(BV[a-zA-Z0-9]{10})", url)
        if bv_match:
            return bv_match.group(1)

        # 2. 匹配 av 号
        av_match = re.search(r"(av\d+)", url, re.IGNORECASE)
        if av_match:
            return av_match.group(1)

        # 3. 如果是 b23.tv 短链，跟踪重定向
        if "b23.tv" in url or "bili2233.cn" in url:
            try:
                m = re.search(r"https?://(?:b23\.tv|bili2233\.cn)/[a-zA-Z0-9]+", url)
                target_url = m.group(0) if m else url
                async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
                    resp = await client.get(target_url)
                    final_url = str(resp.url)
                    bv_m = re.search(r"(BV[a-zA-Z0-9]{10})", final_url)
                    if bv_m:
                        return bv_m.group(1)
                    av_m = re.search(r"(av\d+)", final_url, re.IGNORECASE)
                    if av_m:
                        return av_m.group(1)
            except Exception:
                pass

        return None

    def _extract_via_ytdlp(self, target_url: str) -> Optional[Dict[str, Any]]:
        """利用 yt-dlp 深度提取免登录 1080P/720P DASH 流与元数据"""
        if not yt_dlp:
            return None
        try:
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": False,
                "http_headers": {
                    "User-Agent": BILIBILI_DESKTOP_UA,
                    "Referer": "https://www.bilibili.com/",
                },
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(target_url, download=False)
                return info
        except Exception:
            return None

    async def extract(self, url: str) -> MediaResponse:
        bvid = await self.get_bvid_or_aid(url)
        if not bvid:
            return MediaResponse(
                success=False,
                platform="bilibili",
                platform_name="哔哩哔哩",
                type="video",
                id="",
                title="",
                error="未能识别出有效的 B站 视频链接或 BV号，请确认后重试",
            )

        video_page_url = f"https://www.bilibili.com/video/{bvid}"

        # 并发获取官方 View 接口以获得 UP主真实高清头像与互动数据
        up_avatar = ""
        try:
            async with httpx.AsyncClient(headers=self.headers, timeout=5.0) as client:
                r_v = await client.get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
                if r_v.status_code == 200:
                    d_v = r_v.json().get("data", {})
                    up_avatar = d_v.get("owner", {}).get("face", "")
        except Exception:
            pass

        # 方案一：优先通过 yt-dlp 异步提取 1080P / 720P 最高画质与音频轨
        loop = asyncio.get_event_loop()
        ytdl_info = await loop.run_in_executor(None, self._extract_via_ytdlp, video_page_url)

        if ytdl_info:
            formats = ytdl_info.get("formats", [])
            video_formats = [f for f in formats if f.get("vcodec") != "none" and f.get("url")]
            audio_formats = [f for f in formats if f.get("acodec") != "none" and f.get("vcodec") == "none" and f.get("url")]

            if video_formats:
                # 最佳音频流及其大小
                top_a = audio_formats[-1] if audio_formats else None
                audio_url = top_a.get("url", "") if top_a else ""
                audio_bytes = int(top_a.get("filesize") or top_a.get("filesize_approx") or 0) if top_a else 0

                # 收集并去重多清晰度画质选项 (优先挑选 H.264/AVC 编码)
                quality_options: List[QualityOption] = []
                seen_res = set()

                # 按照画质高到低排序
                for f in reversed(video_formats):
                    w = f.get("width") or 0
                    h = f.get("height") or 0
                    res_key = f"{w}x{h}" if w and h else f.get("resolution", "unknown")
                    is_avc = "avc" in f.get("vcodec", "").lower() or "h264" in f.get("vcodec", "").lower()

                    # 同一分辨率优先保留 AVC (H.264)
                    if res_key in seen_res:
                        continue
                    
                    if not is_avc:
                        # 检查同分辨率是否有 AVC 版本
                        has_avc = any(
                            ("avc" in item.get("vcodec", "").lower() or "h264" in item.get("vcodec", "").lower())
                            and (item.get("width") == w and item.get("height") == h)
                            for item in video_formats
                        )
                        if has_avc:
                            continue

                    seen_res.add(res_key)

                    # 计算预估文件大小 (视频 + 音频)
                    v_bytes = int(f.get("filesize") or f.get("filesize_approx") or 0)
                    total_bytes = v_bytes + audio_bytes if v_bytes > 0 else 0
                    size_str = format_bytes(total_bytes)

                    # 格式化友好的画质标签
                    max_dim = max(w, h)
                    min_dim = min(w, h)
                    if max_dim >= 1920 or min_dim >= 1080:
                        q_name = "1080P 高清"
                    elif max_dim >= 1280 or min_dim >= 720:
                        q_name = "720P 高清"
                    elif max_dim >= 852 or min_dim >= 480:
                        q_name = "480P 清晰"
                    else:
                        q_name = "360P 流畅"

                    label_text = f"{q_name} ({w}x{h})"
                    if size_str:
                        label_text += f" ~ {size_str}"

                    quality_options.append(QualityOption(
                        id=f.get("format_id", res_key),
                        label=label_text,
                        video_url=f.get("url", ""),
                        audio_url=audio_url,
                        filesize_bytes=total_bytes,
                        filesize_str=size_str,
                        width=w,
                        height=h,
                        codec="H.264" if is_avc else f.get("vcodec", "H.264")
                    ))

                # 默认最高清晰度
                top_option = quality_options[0] if quality_options else None
                top_v_url = top_option.video_url if top_option else video_formats[-1].get("url", "")
                top_ratio = top_option.label.split("(")[0].strip() if top_option else "1080P 高清"

                title = ytdl_info.get("title") or f"bilibili_{bvid}"
                description = ytdl_info.get("description", "")
                full_title = f"{title}\n{description}".strip() if description and description != title else title
                cover = ytdl_info.get("thumbnail") or ""
                uploader = ytdl_info.get("uploader") or "哔哩哔哩UP主"
                uploader_id = str(ytdl_info.get("uploader_id") or "")
                
                duration = int(ytdl_info.get("duration") or 0)
                view_count = int(ytdl_info.get("view_count") or 0)
                like_count = int(ytdl_info.get("like_count") or 0)
                comment_count = int(ytdl_info.get("comment_count") or 0)

                return MediaResponse(
                    success=True,
                    platform="bilibili",
                    platform_name="哔哩哔哩",
                    type="video",
                    id=bvid,
                    title=full_title,
                    cover=cover,
                    author=AuthorInfo(
                        nickname=uploader,
                        avatar=up_avatar or f"https://ui-avatars.com/api/?name={uploader}&background=fb7299&color=fff",
                        unique_id=uploader_id,
                    ),
                    statistics=StatisticsInfo(
                        digg_count=like_count,
                        comment_count=comment_count,
                        play_count=view_count,
                    ),
                    music=MusicInfo(
                        title=title,
                        author=uploader,
                        url=audio_url,
                        cover=cover,
                    ),
                    video=VideoInfo(
                        no_watermark_url=top_v_url,
                        watermark_url=top_v_url,
                        audio_url=audio_url,
                        ratio=top_ratio,
                        width=top_option.width if top_option else 1920,
                        height=top_option.height if top_option else 1080,
                        duration=duration,
                        qualities=quality_options,
                    ),
                )

        # 方案二：回退到官方 View 与 PlayURL 接口
        async with httpx.AsyncClient(headers=self.headers, timeout=self.timeout) as client:
            view_param = f"bvid={bvid}" if bvid.startswith("BV") else f"aid={bvid.lower().replace('av', '')}"
            view_api = f"https://api.bilibili.com/x/web-interface/view?{view_param}"

            try:
                view_resp = await client.get(view_api)
                view_json = view_resp.json()
            except Exception as e:
                return MediaResponse(
                    success=False,
                    platform="bilibili",
                    platform_name="哔哩哔哩",
                    type="video",
                    id=bvid,
                    title="",
                    error=f"获取 B站 视频详情异常: {str(e)}",
                )

            if view_json.get("code") != 0:
                return MediaResponse(
                    success=False,
                    platform="bilibili",
                    platform_name="哔哩哔哩",
                    type="video",
                    id=bvid,
                    title="",
                    error=view_json.get("message", "获取 B站 视频详情失败"),
                )

            data = view_json.get("data", {})
            title = data.get("title", f"bilibili_{bvid}")
            desc = data.get("desc", "")
            full_title = f"{title}\n{desc}".strip() if desc and desc != title else title
            cover = data.get("pic", "")
            cid = data.get("cid")
            duration = data.get("duration", 0)
            pubdate = data.get("pubdate", 0)

            owner = data.get("owner", {})
            author_info = AuthorInfo(
                nickname=owner.get("name", "哔哩哔哩UP主"),
                avatar=owner.get("face", "") or up_avatar,
                unique_id=str(owner.get("mid", "")),
                signature="",
            )

            stat = data.get("stat", {})
            statistics_info = StatisticsInfo(
                digg_count=int(stat.get("like", 0) or 0),
                comment_count=int(stat.get("reply", 0) or 0),
                share_count=int(stat.get("share", 0) or 0),
                play_count=int(stat.get("view", 0) or 0),
                danmaku_count=int(stat.get("danmaku", 0) or 0),
                coin_count=int(stat.get("coin", 0) or 0),
            )

            play_api = f"https://api.bilibili.com/x/player/playurl?{view_param}&cid={cid}&fnval=4048&fourk=1"
            video_url = ""
            audio_url = ""
            ratio = "720P 高清"

            try:
                play_resp = await client.get(play_api)
                if play_resp.status_code == 200:
                    play_data = play_resp.json().get("data", {})
                    dash = play_data.get("dash", {})
                    if dash:
                        video_streams = dash.get("video", [])
                        if video_streams:
                            top_v = video_streams[0]
                            video_url = top_v.get("baseUrl") or (top_v.get("backupUrl", [""])[0] if top_v.get("backupUrl") else "")
                            q_id = top_v.get("id", 64)
                            ratio = QUALITY_MAP.get(q_id, "720P 高清")

                        audio_streams = dash.get("audio", []) or dash.get("dolby", {}).get("audio", [])
                        if audio_streams:
                            top_a = audio_streams[0]
                            audio_url = top_a.get("baseUrl") or (top_a.get("backupUrl", [""])[0] if top_a.get("backupUrl") else "")
            except Exception:
                pass

            return MediaResponse(
                success=True,
                platform="bilibili",
                platform_name="哔哩哔哩",
                type="video",
                id=bvid,
                title=full_title,
                cover=cover,
                author=author_info,
                statistics=statistics_info,
                music=MusicInfo(
                    title=title,
                    author=author_info.nickname,
                    url=audio_url,
                    cover=cover,
                ),
                video=VideoInfo(
                    no_watermark_url=video_url,
                    watermark_url=video_url,
                    audio_url=audio_url,
                    ratio=ratio,
                    duration=duration,
                ),
                create_time=pubdate,
            )

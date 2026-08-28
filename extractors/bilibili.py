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
    VideoEpisode,
    UserProfileInfo,
    UserPostItem,
    UserProfileResponse,
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

def get_bilibili_cookie() -> str:
    """获取 B 站 Cookie (支持环境变量 BILIBILI_COOKIE / SESSDATA 或本地 cookies.txt 文件)"""
    import os
    cookie = os.getenv("BILIBILI_COOKIE", "").strip()
    if not cookie:
        sess = os.getenv("SESSDATA", "").strip()
        if sess:
            cookie = f"SESSDATA={sess}"
    
    if not cookie:
        for cfile in ["bilibili_cookie.txt", "cookies.txt", "/app/bilibili_cookie.txt", "/app/cookies.txt"]:
            if os.path.isfile(cfile):
                try:
                    with open(cfile, "r", encoding="utf-8") as f:
                        content = f.read().strip()
                        if content:
                            cookie = content
                            break
                except Exception:
                    pass
    return cookie

class BilibiliExtractor(BaseExtractor):
    def __init__(self, timeout: float = 15.0):
        super().__init__(timeout)
        self.cookie = get_bilibili_cookie()
        self.headers = {
            "User-Agent": BILIBILI_DESKTOP_UA,
            "Referer": "https://www.bilibili.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        if self.cookie:
            self.headers["Cookie"] = self.cookie

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

    def _extract_via_ytdlp(self, target_url: str, sessdata: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """利用 yt-dlp 深度提取免登录/登录 1080P/720P DASH 流与元数据"""
        if not yt_dlp:
            return None
        try:
            import os
            proxy = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or None
            http_headers = {
                "User-Agent": BILIBILI_DESKTOP_UA,
                "Referer": "https://www.bilibili.com/",
            }
            cookie = f"SESSDATA={sessdata}" if sessdata else get_bilibili_cookie()
            if cookie:
                http_headers["Cookie"] = cookie

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": False,
                "http_headers": http_headers,
            }
            if proxy:
                ydl_opts["proxy"] = proxy
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(target_url, download=False)
                return info
        except Exception as e:
            logger.warning(f"[Bilibili] yt-dlp 提取异常 (将回退至官方接口通道): {e}")
            return None

    async def extract(self, url: str, sessdata: Optional[str] = None) -> MediaResponse:
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

        # 识别 URL 中的分P参数 (如 ?p=2)
        p_match = re.search(r"[?&]p=(\d+)", url)
        selected_page = int(p_match.group(1)) if p_match else 1

        custom_headers = dict(self.headers)
        if sessdata:
            custom_headers["Cookie"] = f"SESSDATA={sessdata}"

        # 1. 获取官方 View 接口 (获取分P列表 pages、合集 ugc_season、UP主信息、互动数据等)
        view_param = f"bvid={bvid}" if bvid.startswith("BV") else f"aid={bvid.lower().replace('av', '')}"
        view_api = f"https://api.bilibili.com/x/web-interface/view?{view_param}"

        view_data = {}
        async with httpx.AsyncClient(headers=custom_headers, timeout=self.timeout) as client:
            try:
                view_resp = await client.get(view_api)
                view_json = view_resp.json()
                if view_json.get("code") == 0:
                    view_data = view_json.get("data", {})
                else:
                    return MediaResponse(
                        success=False,
                        platform="bilibili",
                        platform_name="哔哩哔哩",
                        type="video",
                        id=bvid,
                        title="",
                        error=view_json.get("message", "获取 B站 视频详情失败"),
                    )
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

        main_title = view_data.get("title", f"bilibili_{bvid}")
        desc = view_data.get("desc", "")
        main_cover = view_data.get("pic", "")
        default_cid = view_data.get("cid")
        pubdate = view_data.get("pubdate", 0)
        total_duration = view_data.get("duration", 0)

        owner = view_data.get("owner", {})
        author_info = AuthorInfo(
            nickname=owner.get("name", "哔哩哔哩UP主"),
            avatar=owner.get("face", ""),
            unique_id=str(owner.get("mid", "")),
            signature="",
        )

        stat = view_data.get("stat", {})
        statistics_info = StatisticsInfo(
            digg_count=int(stat.get("like", 0) or 0),
            comment_count=int(stat.get("reply", 0) or 0),
            share_count=int(stat.get("share", 0) or 0),
            play_count=int(stat.get("view", 0) or 0),
            danmaku_count=int(stat.get("danmaku", 0) or 0),
            coin_count=int(stat.get("coin", 0) or 0),
        )

        # 2. 提取分P列表 (pages)，若 view 接口未返回完整 pages 则自动通过 pagelist 接口补全
        raw_pages = view_data.get("pages", [])
        if not raw_pages or len(raw_pages) <= 1:
            try:
                async with httpx.AsyncClient(headers=custom_headers, timeout=self.timeout) as pl_client:
                    pl_resp = await pl_client.get(f"https://api.bilibili.com/x/player/pagelist?bvid={bvid}")
                    if pl_resp.status_code == 200:
                        pl_json = pl_resp.json()
                        if pl_json.get("code") == 0 and pl_json.get("data"):
                            pl_data = pl_json.get("data", [])
                            if len(pl_data) > len(raw_pages):
                                raw_pages = pl_data
            except Exception:
                pass

        episodes: List[VideoEpisode] = []
        target_cid = default_cid
        target_page_title = ""
        target_duration = total_duration
        target_cover = main_cover

        if raw_pages and isinstance(raw_pages, list):
            for p_item in raw_pages:
                p_num = int(p_item.get("page", 1))
                p_cid = p_item.get("cid")
                p_part = p_item.get("part") or f"第{p_num}集"
                p_dur = int(p_item.get("duration", 0) or 0)
                p_first_frame = p_item.get("first_frame") or main_cover

                episodes.append(VideoEpisode(
                    id=str(p_cid or p_num),
                    title=p_part,
                    page=p_num,
                    duration=p_dur,
                    cover=p_first_frame,
                    cid=p_cid,
                    bvid=bvid,
                    share_url=f"https://www.bilibili.com/video/{bvid}?p={p_num}",
                ))

            # 匹配当前选中的分P
            matched_page = next((p for p in raw_pages if int(p.get("page", 1)) == selected_page), None)
            if not matched_page and raw_pages:
                matched_page = raw_pages[0]
                selected_page = 1

            if matched_page:
                target_cid = matched_page.get("cid")
                target_page_title = matched_page.get("part", "")
                target_duration = int(matched_page.get("duration", 0) or 0)
                if matched_page.get("first_frame"):
                    target_cover = matched_page.get("first_frame")

        # 3. 提取 UGC 视频合集 / 剧集 (ugc_season)
        ugc_season = view_data.get("ugc_season")
        season_title = None
        if ugc_season and isinstance(ugc_season, dict):
            season_title = ugc_season.get("title")
            # 若单视频只有1个分P，但属于多视频组成的合集，则展开合集视频列表
            if len(episodes) <= 1:
                season_episodes = []
                sections = ugc_season.get("sections", [])
                ep_idx = 1
                for sec in sections:
                    for ep in sec.get("episodes", []):
                        ep_bvid = ep.get("bvid") or bvid
                        ep_cid = ep.get("cid")
                        ep_t = ep.get("title") or (ep.get("arc", {}).get("title") if ep.get("arc") else f"第{ep_idx}集")
                        arc_info = ep.get("arc", {}) or {}
                        ep_d = int(arc_info.get("duration", 0) or (ep.get("page", {}).get("duration", 0) if ep.get("page") else 0))
                        ep_pic = arc_info.get("pic") or main_cover
                        season_episodes.append(VideoEpisode(
                            id=str(ep_cid or ep_bvid),
                            title=ep_t,
                            page=ep_idx,
                            duration=ep_d,
                            cover=ep_pic,
                            cid=ep_cid,
                            bvid=ep_bvid,
                            share_url=f"https://www.bilibili.com/video/{ep_bvid}",
                        ))
                        ep_idx += 1
                if len(season_episodes) > 1:
                    episodes = season_episodes

        # 组装展示标题：若有多分集，附带分P标签
        if len(episodes) > 1 and target_page_title and target_page_title != main_title:
            full_title = f"{main_title} (P{selected_page}: {target_page_title})"
        else:
            full_title = f"{main_title}\n{desc}".strip() if desc and desc != main_title else main_title

        # 4. 获取当前分P的 DASH 播放流与多画质
        video_url = ""
        audio_url = ""
        ratio = "720P 高清"
        quality_options: List[QualityOption] = []

        # 优先使用官方 PlayURL 提取对应 target_cid 的 DASH 流
        async with httpx.AsyncClient(headers=custom_headers, timeout=self.timeout) as client:
            play_api = f"https://api.bilibili.com/x/player/playurl?{view_param}&cid={target_cid}&fnval=4048&fourk=1"
            try:
                play_resp = await client.get(play_api)
                if play_resp.status_code == 200:
                    play_data = play_resp.json().get("data", {})
                    dash = play_data.get("dash", {})
                    if dash:
                        # 最佳音频流
                        audio_streams = dash.get("audio", []) or dash.get("dolby", {}).get("audio", [])
                        if audio_streams:
                            top_a = audio_streams[0]
                            audio_url = top_a.get("baseUrl") or (top_a.get("backupUrl", [""])[0] if top_a.get("backupUrl") else "")

                        # 所有视频清晰度
                        video_streams = dash.get("video", [])
                        seen_qids = set()
                        for v in video_streams:
                            qid = v.get("id", 64)
                            v_url = v.get("baseUrl") or (v.get("backupUrl", [""])[0] if v.get("backupUrl") else "")
                            w = v.get("width") or 0
                            h = v.get("height") or 0
                            codecs = v.get("codecs", "H.264")
                            is_avc = "avc" in codecs.lower()

                            # 优先保留 AVC (H.264)
                            if qid in seen_qids:
                                continue
                            seen_qids.add(qid)

                            q_name = QUALITY_MAP.get(qid, f"{h}P" if h else "标清")
                            label_text = f"{q_name} ({w}x{h})" if w and h else q_name

                            quality_options.append(QualityOption(
                                id=str(qid),
                                label=label_text,
                                video_url=v_url,
                                audio_url=audio_url,
                                width=w,
                                height=h,
                                codec="H.264" if is_avc else codecs,
                            ))

                        if quality_options:
                            video_url = quality_options[0].video_url
                            ratio = quality_options[0].label.split("(")[0].strip()
                        elif video_streams:
                            top_v = video_streams[0]
                            video_url = top_v.get("baseUrl") or (top_v.get("backupUrl", [""])[0] if top_v.get("backupUrl") else "")
                            q_id = top_v.get("id", 64)
                            ratio = QUALITY_MAP.get(q_id, "720P 高清")
            except Exception:
                pass

        # 方案补充：若官方未获取到画质且 yt-dlp 可用，尝试 yt-dlp 补充
        if not video_url:
            loop = asyncio.get_event_loop()
            target_p_url = f"https://www.bilibili.com/video/{bvid}?p={selected_page}"
            ytdl_info = await loop.run_in_executor(None, self._extract_via_ytdlp, target_p_url, sessdata)
            if ytdl_info:
                formats = ytdl_info.get("formats", [])
                video_formats = [f for f in formats if f.get("vcodec") != "none" and f.get("url")]
                audio_formats = [f for f in formats if f.get("acodec") != "none" and f.get("vcodec") == "none" and f.get("url")]

                if video_formats:
                    top_a = audio_formats[-1] if audio_formats else None
                    audio_url = top_a.get("url", "") if top_a else ""
                    audio_bytes = int(top_a.get("filesize") or top_a.get("filesize_approx") or 0) if top_a else 0

                    seen_res = set()
                    for f in reversed(video_formats):
                        w = f.get("width") or 0
                        h = f.get("height") or 0
                        res_key = f"{w}x{h}" if w and h else f.get("resolution", "unknown")
                        is_avc = "avc" in f.get("vcodec", "").lower() or "h264" in f.get("vcodec", "").lower()

                        if res_key in seen_res:
                            continue
                        seen_res.add(res_key)

                        v_bytes = int(f.get("filesize") or f.get("filesize_approx") or 0)
                        total_bytes = v_bytes + audio_bytes if v_bytes > 0 else 0
                        size_str = format_bytes(total_bytes)

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

                    if quality_options:
                        video_url = quality_options[0].video_url
                        ratio = quality_options[0].label.split("(")[0].strip()

        return MediaResponse(
            success=True,
            platform="bilibili",
            platform_name="哔哩哔哩",
            type="video",
            id=f"{bvid}_p{selected_page}" if len(episodes) > 1 else bvid,
            title=full_title,
            cover=target_cover,
            author=author_info,
            statistics=statistics_info,
            music=MusicInfo(
                title=full_title,
                author=author_info.nickname,
                url=audio_url,
                cover=target_cover,
            ),
            video=VideoInfo(
                no_watermark_url=video_url,
                watermark_url=video_url,
                audio_url=audio_url,
                ratio=ratio,
                duration=target_duration,
                qualities=quality_options,
            ),
            episodes=episodes,
            current_page=selected_page,
            season_title=season_title,
            create_time=pubdate,
        )

    async def get_mid(self, url: str) -> Optional[str]:
        """从主页链接或短链中提取 UP主的 mid (UID)"""
        # 1. 直接匹配 space.bilibili.com/数字 或 bilibili.com/space/数字 或 mid=数字
        m = re.search(r"space\.bilibili\.com/(\d+)", url) or re.search(r"bilibili\.com/space/(\d+)", url) or re.search(r"[?&]mid=(\d+)", url)
        if m:
            return m.group(1)

        # 2. 如果是短链 b23.tv / bili2233.cn，逐级追踪 302 Location
        if "b23.tv" in url or "bili2233.cn" in url:
            try:
                m_short = re.search(r"https?://(?:b23\.tv|bili2233\.cn)/[a-zA-Z0-9]+", url)
                target = m_short.group(0) if m_short else url
                async with httpx.AsyncClient(headers=self.headers, follow_redirects=False, timeout=self.timeout) as client:
                    resp = await client.get(target)
                    loc = resp.headers.get("location", "")
                    if loc:
                        m_loc = re.search(r"space(?:/|\.bilibili\.com/)(\d+)", loc) or re.search(r"[?&]mid=(\d+)", loc)
                        if m_loc:
                            return m_loc.group(1)
            except Exception:
                pass

        return None

    def _extract_space_entries(self, space_url: str, start_idx: int, end_idx: int) -> List[str]:
        """利用 yt-dlp 分页拉取 UP 主空间投稿的 BVID 列表"""
        if not yt_dlp:
            return []
        try:
            import os
            proxy = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or None
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,
                "playliststart": start_idx,
                "playlistend": end_idx,
            }
            if proxy:
                ydl_opts["proxy"] = proxy
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(space_url, download=False)
                entries = info.get("entries", []) if info else []
                bvids = []
                for e in entries:
                    bid = e.get("id") or ""
                    if bid.startswith("BV") or bid.startswith("bv"):
                        bvids.append(bid)
                    elif e.get("url"):
                        m = re.search(r"(BV[a-zA-Z0-9]{10})", e.get("url"))
                        if m:
                            bvids.append(m.group(1))
                return bvids
        except Exception:
            return []

    async def extract_user_posts(self, url: str, cursor: int = 0, count: int = 20, sessdata: Optional[str] = None) -> UserProfileResponse:
        """抓取 B站 UP 主主页空间作品列表 (带分页游标)"""
        mid = await self.get_mid(url)
        if not mid:
            return UserProfileResponse(
                success=False,
                platform="bilibili",
                platform_name="哔哩哔哩",
                error="未能识别出有效的 B站 UP 主主页链接，请提供如 https://space.bilibili.com/946974 或分享短链",
            )

        # 将游标转换为页码 (cursor 0 -> page 1, cursor 20 -> page 2)
        page_num = (cursor // count) + 1 if count > 0 else 1

        mobile_headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "Referer": f"https://m.bilibili.com/space/{mid}",
        }
        if sessdata:
            mobile_headers["Cookie"] = f"SESSDATA={sessdata}"
        elif self.cookie:
            mobile_headers["Cookie"] = self.cookie

        user_info = UserProfileInfo(
            sec_uid=mid,
            unique_id=mid,
            nickname=f"UP主_{mid}",
        )

        posts: List[UserPostItem] = []
        has_more = False
        next_cursor = cursor

        async with httpx.AsyncClient(headers=mobile_headers, follow_redirects=True, timeout=self.timeout) as client:
            # 1. 尝试从移动端主页获取 UP 主头像和个性签名
            try:
                r_home = await client.get(f"https://m.bilibili.com/space/{mid}")
                if r_home.status_code == 200:
                    import json
                    m_state = re.search(r'__INITIAL_STATE__\s*=\s*(\{.*?\});', r_home.text)
                    if m_state:
                        st_data = json.loads(m_state.group(1))
                        u_info = st_data.get("space", {}).get("info", {})
                        if u_info:
                            user_info.nickname = u_info.get("name") or user_info.nickname
                            user_info.avatar = u_info.get("face") or ""
                            user_info.signature = u_info.get("sign") or ""
            except Exception:
                pass

            # 2. 获取 UP 主粉丝数
            try:
                r_stat = await client.get(f"https://api.bilibili.com/x/relation/stat?vmid={mid}")
                if r_stat.status_code == 200:
                    d_stat = r_stat.json().get("data", {})
                    user_info.follower_count = int(d_stat.get("follower", 0) or 0)
            except Exception:
                pass

            # 3. 获取 UP 主投稿作品分页列表
            try:
                arc_url = f"https://api.bilibili.com/x/space/arc/search?mid={mid}&ps={count}&pn={page_num}"
                r_arc = await client.get(arc_url)
                if r_arc.status_code == 200:
                    arc_data = r_arc.json().get("data", {})
                    vlist = arc_data.get("list", {}).get("vlist", [])
                    page_info = arc_data.get("page", {})
                    total_count = page_info.get("count", 0)
                    user_info.aweme_count = total_count
                    total_plays = sum(int(v.get("play", 0) or 0) for v in vlist)
                    user_info.total_favorited = total_plays

                    for v in vlist:
                        bvid = v.get("bvid", "")
                        title = v.get("title", "")
                        cover = v.get("pic", "")
                        # 转换时长 "03:45" 或 "01:23:45"
                        length_str = v.get("length", "0:0")
                        dur_secs = 0
                        try:
                            parts = [int(p) for p in str(length_str).split(":")]
                            if len(parts) == 2:
                                dur_secs = parts[0] * 60 + parts[1]
                            elif len(parts) == 3:
                                dur_secs = parts[0] * 3600 + parts[1] * 60 + parts[2]
                        except Exception:
                            dur_secs = 0

                        pubdate = int(v.get("created", 0) or 0)
                        play_num = int(v.get("play", 0) or 0)
                        comment_num = int(v.get("comment", 0) or 0)
                        danmaku_num = int(v.get("video_review", 0) or 0)

                        if not user_info.nickname or user_info.nickname.startswith("UP主_"):
                            if v.get("author"):
                                user_info.nickname = v.get("author")

                        # 识别视频合集与分P标识 (如 【全1000集】、共xx讲、分P等)
                        is_season = bool(v.get("is_season") or v.get("season_id") or v.get("ugc_season"))
                        season_label = ""
                        m_season = re.search(r"【全(\d+)[集P讲话]】|\[全(\d+)[集P讲话]\]|[【\[]共(\d+)[集P讲话][】\]]|全(\d+)[集P讲话]|1[~-](\d+)[集P讲话]", title)
                        if m_season:
                            is_season = True
                            count_str = next(g for g in m_season.groups() if g)
                            season_label = f"合集·共{count_str}集"
                        elif is_season:
                            season_label = "合集"

                        posts.append(UserPostItem(
                            id=bvid,
                            title=title,
                            cover=cover,
                            type="video",
                            duration=dur_secs,
                            create_time=pubdate,
                            digg_count=play_num,
                            comment_count=comment_num,
                            download_url=f"https://www.bilibili.com/video/{bvid}",
                            images=[],
                            share_url=f"https://www.bilibili.com/video/{bvid}",
                            is_season=is_season,
                            season_label=season_label,
                        ))

                    has_more = (page_num * count) < total_count
                    next_cursor = cursor + len(posts)
            except Exception as e:
                return UserProfileResponse(
                    success=False,
                    platform="bilibili",
                    platform_name="哔哩哔哩",
                    error=f"拉取 B站 UP 主投稿列表异常: {str(e)}",
                )

        return UserProfileResponse(
            success=True,
            platform="bilibili",
            platform_name="哔哩哔哩",
            user=user_info,
            posts=posts,
            has_more=has_more,
            max_cursor=next_cursor,
        )

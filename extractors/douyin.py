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
    UserProfileResponse,
    UserProfileInfo,
    UserPostItem,
)

APP_USER_AGENT = (
    "com.ss.android.ugc.aweme/230501 (Linux; U; Android 10; zh_CN; MI 9; Build/QKQ1.190825.002; Cronet/TTNetVersion:b4d74d15 2020-04-23 QuicVersion:0144d358 2020-03-24)"
)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
)

SPIDER_USER_AGENT = (
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)"
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
        self.spider_headers = {
            "User-Agent": SPIDER_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }

    def match(self, url: str) -> bool:
        return any(domain in url for domain in [
            "douyin.com",
            "iesdouyin.com",
            "tiktok.com",
        ])

    async def get_aweme_id(self, url: str) -> Optional[str]:
        """提取或跟随重定向获取真实 aweme_id"""
        # 检查是否直接包含 ID
        id_match = re.search(r"/(?:video|note)/(\d+)", url)
        if id_match:
            return id_match.group(1)

        # 跟随短链接重定向
        try:
            async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
                resp = await client.get(url)
                final_url = str(resp.url)
                id_match = re.search(r"/(?:video|note)/(\d+)", final_url)
                if id_match:
                    return id_match.group(1)
                
                # 从 HTML 页面中提取
                modal_match = re.search(r"modal_id=(\d+)", final_url) or re.search(r"/(?:video|note)/(\d+)", resp.text)
                if modal_match:
                    return modal_match.group(1)
        except Exception:
            pass

        return None

    async def _fetch_from_feed_api(self, client: httpx.AsyncClient, aweme_id: str) -> Optional[Dict[str, Any]]:
        """方案一：调用原生 Feed 流接口（必须精准匹配目标 ID）"""
        feed_endpoints = [
            f"https://api5-normal-c-lq.amemv.com/aweme/v1/feed/?aweme_id={aweme_id}",
            f"https://api.amemv.com/aweme/v1/feed/?aweme_id={aweme_id}",
            f"https://aweme.snssdk.com/aweme/v1/feed/?aweme_id={aweme_id}",
        ]
        for ep in feed_endpoints:
            try:
                resp = await client.get(ep, headers=self.app_headers, timeout=self.timeout)
                if resp.status_code == 200 and resp.text:
                    data = resp.json()
                    aweme_list = data.get("aweme_list", [])
                    for item in aweme_list:
                        if str(item.get("aweme_id")) == str(aweme_id):
                            return item
            except Exception:
                continue
        return None

    async def _fetch_note_from_schema(self, client: httpx.AsyncClient, aweme_id: str) -> Optional[MediaResponse]:
        """方案二：通过 Schema 通道专有解析抖音图文笔记 (note)"""
        note_urls = [
            f"https://www.iesdouyin.com/share/note/{aweme_id}/",
            f"https://www.douyin.com/note/{aweme_id}",
        ]
        for nu in note_urls:
            try:
                resp = await client.get(nu, headers=self.spider_headers, follow_redirects=True, timeout=self.timeout)
                if resp.status_code != 200 or not resp.text:
                    continue

                for s in re.findall(r"<script[^>]*type=[\"\x27]application/ld\+json[\"\x27][^>]*>(.*?)</script>", resp.text, re.DOTALL):
                    try:
                        data = json.loads(s.strip())
                        if data.get("@type") == "article" or "image" in data:
                            title = data.get("headline") or data.get("name") or f"抖音图文_{aweme_id}"
                            images = data.get("image", [])
                            if not images or not isinstance(images, list):
                                continue

                            # 作者信息
                            author_raw = data.get("author", {})
                            author_name = author_raw.get("name", "抖音创作者") if isinstance(author_raw, dict) else "抖音创作者"
                            author_avatar = author_raw.get("image", "") if isinstance(author_raw, dict) else ""
                            author_id = ""
                            if isinstance(author_raw, dict) and author_raw.get("url"):
                                m_uid = re.search(r"/user/([^/?]+)", author_raw["url"])
                                if m_uid:
                                    author_id = m_uid.group(1)

                            # 互动统计数据 (点赞、评论、分享)
                            digg_count = 0
                            # 1. 优先提取作品自身的获赞数
                            root_stats = data.get("interactionStatistic", [])
                            if isinstance(root_stats, list):
                                for stat in root_stats:
                                    if "LikeAction" in str(stat.get("interactionType", "")):
                                        digg_count = int(stat.get("userInteractionCount", 0) or 0)
                            
                            # 2. 如果根级未找到，从描述文案或作者数据提取
                            if digg_count == 0:
                                desc_str = data.get("description", "")
                                m_like = re.search(r"已经收获了(\d+)个喜欢", desc_str)
                                if m_like:
                                    digg_count = int(m_like.group(1))
                                elif isinstance(author_raw, dict):
                                    for stat in author_raw.get("interactionStatistic", []):
                                        if "LikeAction" in str(stat.get("interactionType", "")):
                                            digg_count = int(stat.get("userInteractionCount", 0) or 0)

                            comment_count = int(data.get("commentCount", 0) or len(data.get("comment", [])) or 0)
                            share_count = int(data.get("repostCount", 0) or data.get("shareCount", 0) or 0)

                            # 解析发布时间
                            create_time = 0
                            pub_str = data.get("datePublished", "")
                            if pub_str:
                                try:
                                    from datetime import datetime
                                    dt = datetime.strptime(pub_str, "%Y-%m-%d %H:%M")
                                    create_time = int(dt.timestamp())
                                except Exception:
                                    create_time = 0

                            return MediaResponse(
                                success=True,
                                platform="douyin",
                                platform_name="抖音",
                                type="images",
                                id=aweme_id,
                                title=title,
                                cover=images[0] if images else "",
                                author=AuthorInfo(
                                    nickname=author_name,
                                    avatar=author_avatar,
                                    unique_id=author_id or "douyin_user",
                                ),
                                statistics=StatisticsInfo(
                                    digg_count=digg_count,
                                    comment_count=comment_count,
                                    share_count=share_count,
                                ),
                                music=MusicInfo(),
                                images=images,
                                image_count=len(images),
                                create_time=create_time,
                            )
                    except Exception:
                        continue
            except Exception:
                continue
        return None

    def _extract_item_from_html(self, html: str) -> Optional[Dict[str, Any]]:
        """方案三：从 H5 分享页 SSR HTML 中提取数据"""
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
                error="未能解析出抖音作品 ID，请确认链接是否有效",
            )

        async with httpx.AsyncClient(headers=self.headers, timeout=self.timeout) as client:
            # 1. 优先调用客户端原生 Feed 接口 (针对单视频)
            item = await self._fetch_from_feed_api(client, aweme_id)

            # 2. 如果是图文笔记 (note) 或 Feed 未命中，通过 Schema 通道提取完整图集
            if not item:
                note_response = await self._fetch_note_from_schema(client, aweme_id)
                if note_response:
                    return note_response

            # 3. 备用策略：从分享页 SSR 数据提取
            if not item:
                for share_type in ["video", "note"]:
                    try:
                        share_url = f"https://www.iesdouyin.com/share/{share_type}/{aweme_id}/"
                        resp = await client.get(share_url, follow_redirects=True)
                        extracted = self._extract_item_from_html(resp.text)
                        if extracted:
                            item = extracted
                            break
                    except Exception:
                        continue

            if not item:
                return MediaResponse(
                    success=False,
                    platform="douyin",
                    platform_name="抖音",
                    type="video",
                    id=aweme_id,
                    title="",
                    error="未能获取到该作品数据，可能已被作者删除或链接已失效",
                )

            # 解析作品基本信息
            title = item.get("desc", f"douyin_{aweme_id}")
            create_time = item.get("create_time", 0)

            # 作者信息
            author = item.get("author", {})
            author_info = AuthorInfo(
                nickname=author.get("nickname", "未知用户"),
                avatar=author.get("avatar_thumb", {}).get("url_list", [""])[0] if author.get("avatar_thumb") else "",
                unique_id=author.get("unique_id") or author.get("short_id") or "",
                signature=author.get("signature", ""),
            )

            # 统计数据
            statistics = item.get("statistics", {})
            statistics_info = StatisticsInfo(
                digg_count=statistics.get("digg_count", 0),
                comment_count=statistics.get("comment_count", 0),
                share_count=statistics.get("share_count", 0),
                play_count=statistics.get("play_count", 0),
            )

            # 背景音乐
            music = item.get("music", {})
            music_url = music.get("play_url", {}).get("url_list", [""])[0] if music.get("play_url") else ""
            music_cover = music.get("cover_large", {}).get("url_list", [""])[0] if music.get("cover_large") else ""
            music_info = MusicInfo(
                title=music.get("title", ""),
                author=music.get("author", ""),
                url=music_url,
                cover=music_cover,
            )

            # 判断是图集 (images) 还是 视频 (video)
            images_data = item.get("images")
            if images_data and isinstance(images_data, list) and len(images_data) > 0:
                image_urls = []
                for img in images_data:
                    url_list = img.get("url_list", [])
                    if url_list:
                        image_urls.append(url_list[-1])

                cover_url = image_urls[0] if image_urls else ""

                return MediaResponse(
                    success=True,
                    platform="douyin",
                    platform_name="抖音",
                    type="images",
                    id=aweme_id,
                    title=title,
                    cover=cover_url,
                    author=author_info,
                    statistics=statistics_info,
                    music=music_info,
                    images=image_urls,
                    image_count=len(image_urls),
                    create_time=create_time,
                )

            # 处理视频
            video_data = item.get("video", {})
            wm_url = ""
            no_wm_url = ""

            play_addr = video_data.get("play_addr", {})
            if play_addr and "url_list" in play_addr and len(play_addr["url_list"]) > 0:
                raw_url = play_addr["url_list"][0]
                no_wm_url = raw_url.replace("playwm", "play")

            download_addr = video_data.get("download_addr", {})
            if download_addr and "url_list" in download_addr and len(download_addr["url_list"]) > 0:
                wm_url = download_addr["url_list"][0]
            else:
                wm_url = no_wm_url

            cover_data = video_data.get("cover", {})
            cover_url = cover_data.get("url_list", [""])[0] if cover_data.get("url_list") else ""

            duration_raw = video_data.get("duration", 0)
            duration = int(duration_raw / 1000) if duration_raw else 0
            width = video_data.get("width", 0)
            height = video_data.get("height", 0)
            ratio = video_data.get("ratio", "720p")

            # 解析真实重定向地址
            real_no_wm_url = await self._resolve_real_video_url(client, no_wm_url)
            real_wm_url = await self._resolve_real_video_url(client, wm_url) if wm_url != no_wm_url else real_no_wm_url

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
                    no_watermark_url=real_no_wm_url,
                    watermark_url=real_wm_url,
                    ratio=ratio,
                    width=width,
                    height=height,
                    duration=duration,
                ),
                create_time=create_time,
            )

    async def get_sec_uid(self, url: str) -> Optional[str]:
        """从 URL 或重定向地址中提取抖音博主的 sec_uid"""
        # 1. 直接匹配 URL 中的 sec_uid 或 user/ 路径
        sec_match = re.search(r"sec_uid=([^&]+)", url) or re.search(r"sec_user_id=([^&]+)", url)
        if sec_match:
            return urllib.parse.unquote(sec_match.group(1))

        user_match = re.search(r"/user/([A-Za-z0-9_\-]+)", url)
        if user_match:
            return user_match.group(1)

        # 2. 跟随短链接重定向 (如 https://v.douyin.com/xxxx/)
        try:
            async with httpx.AsyncClient(headers=self.headers, follow_redirects=True, timeout=self.timeout) as client:
                resp = await client.get(url)
                final_url = str(resp.url)
                
                sec_match = re.search(r"sec_uid=([^&]+)", final_url) or re.search(r"sec_user_id=([^&]+)", final_url)
                if sec_match:
                    return urllib.parse.unquote(sec_match.group(1))

                user_match = re.search(r"/user/([A-Za-z0-9_\-]+)", final_url)
                if user_match:
                    return user_match.group(1)
                
                # 从 HTML 页面中匹配 sec_uid
                html_sec = re.search(r'"sec_uid"\s*:\s*"([^"]+)"', resp.text) or re.search(r'secUid\\":\\"([^"\\]+)\\"', resp.text)
                if html_sec:
                    return html_sec.group(1)
        except Exception:
            pass

        return None

    async def extract_user_posts(self, url: str, cursor: int = 0, count: int = 20) -> UserProfileResponse:
        """抓取博主主页元数据与分页作品列表"""
        sec_uid = await self.get_sec_uid(url)
        if not sec_uid:
            return UserProfileResponse(
                success=False,
                platform="douyin",
                platform_name="抖音",
                error="无法识别博主主页中的 sec_uid，请提供如 https://www.douyin.com/user/... 或手机分享的博主主页短链",
            )

        user_info = UserProfileInfo(sec_uid=sec_uid)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # 1. 优先调用官方公开 user/info 接口获取博主画像
            try:
                user_info_url = f"https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid={sec_uid}"
                headers = {
                    "User-Agent": DEFAULT_USER_AGENT,
                    "Referer": f"https://www.iesdouyin.com/share/user/{sec_uid}",
                }
                r_user = await client.get(user_info_url, headers=headers)
                if r_user.status_code == 200 and r_user.text:
                    u_data = r_user.json().get("user_info", {})
                    if u_data:
                        user_info.nickname = u_data.get("nickname", "抖音博主")
                        user_info.unique_id = u_data.get("unique_id") or str(u_data.get("short_id", ""))
                        user_info.signature = u_data.get("signature", "")
                        
                        avatar_dict = u_data.get("avatar_medium") or u_data.get("avatar_larger") or u_data.get("avatar_thumb", {})
                        if avatar_dict and "url_list" in avatar_dict and len(avatar_dict["url_list"]) > 0:
                            user_info.avatar = avatar_dict["url_list"][0]
                            
                        user_info.follower_count = u_data.get("mplatform_followers_count") or u_data.get("follower_count") or 0
                        user_info.total_favorited = u_data.get("total_favorited") or 0
                        user_info.aweme_count = u_data.get("aweme_count") or 0
            except Exception:
                pass

            # 2. 尝试拉取作品列表
            post_api_urls = [
                f"https://www.iesdouyin.com/web/api/v2/aweme/post/?sec_uid={sec_uid}&count={count}&max_cursor={cursor}&aid=1128&_signature=1",
                f"https://api5-normal-c-lq.amemv.com/aweme/v1/aweme/post/?sec_user_id={sec_uid}&count={count}&max_cursor={cursor}&aid=1128",
                f"https://aweme.snssdk.com/aweme/v1/aweme/post/?sec_user_id={sec_uid}&count={count}&max_cursor={cursor}&aid=1128",
            ]

            data = None
            for ep in post_api_urls:
                try:
                    headers = self.headers if "iesdouyin" in ep else self.app_headers
                    resp = await client.get(ep, headers=headers)
                    if resp.status_code == 200 and resp.text:
                        res_json = resp.json()
                        if res_json and "aweme_list" in res_json:
                            data = res_json
                            break
                except Exception:
                    continue

            aweme_list = data.get("aweme_list", []) if data else []
            has_more = bool(data.get("has_more", 0)) if data else False
            max_cursor = int(data.get("max_cursor", 0)) if data else 0

            # 解析每一个作品列表项
            posts: List[UserPostItem] = []
            for item in aweme_list:
                aid = str(item.get("aweme_id", ""))
                desc = item.get("desc", "")
                create_time = item.get("create_time", 0)
                statistics = item.get("statistics", {})
                digg_count = statistics.get("digg_count", 0)
                comment_count = statistics.get("comment_count", 0)
                
                # 判断是视频还是图文
                images_list: List[str] = []
                images_data = item.get("images")
                if images_data and isinstance(images_data, list) and len(images_data) > 0:
                    item_type = "images"
                    for img in images_data:
                        url_list = img.get("url_list", [])
                        if url_list:
                            images_list.append(url_list[0])
                    cover_url = images_list[0] if images_list else ""
                    download_url = images_list[0] if images_list else ""
                    duration = 0
                else:
                    item_type = "video"
                    video_data = item.get("video", {})
                    cover_data = video_data.get("cover", {})
                    cover_url = cover_data.get("url_list", [""])[0] if cover_data.get("url_list") else ""
                    duration = int(video_data.get("duration", 0) / 1000) if video_data.get("duration") else 0
                    
                    play_addr = video_data.get("play_addr", {})
                    raw_video_url = play_addr.get("url_list", [""])[0] if play_addr.get("url_list") else ""
                    download_url = raw_video_url.replace("playwm", "play")

                posts.append(UserPostItem(
                    id=aid,
                    title=desc,
                    cover=cover_url,
                    type=item_type,
                    duration=duration,
                    create_time=create_time,
                    digg_count=digg_count,
                    comment_count=comment_count,
                    download_url=download_url,
                    images=images_list,
                    share_url=f"https://www.douyin.com/video/{aid}",
                ))

            return UserProfileResponse(
                success=True,
                platform="douyin",
                platform_name="抖音",
                user=user_info,
                posts=posts,
                has_more=has_more,
                max_cursor=max_cursor,
            )

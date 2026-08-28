from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class AuthorInfo(BaseModel):
    nickname: str = "未知作者"
    avatar: str = ""
    unique_id: str = "未知ID"
    signature: str = ""

class StatisticsInfo(BaseModel):
    digg_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    play_count: int = 0
    danmaku_count: int = 0
    coin_count: int = 0

class MusicInfo(BaseModel):
    title: str = ""
    author: str = ""
    url: str = ""
    cover: str = ""

class QualityOption(BaseModel):
    id: str = Field(description="清晰度ID，如 1080p, 720p, 480p, 360p")
    label: str = Field(description="展示标签，如 1080P 高清 (1080x1920)")
    video_url: str = Field(description="该档画质视频轨直链")
    audio_url: str = Field(default="", description="对应音频轨直链")
    filesize_bytes: int = Field(default=0, description="预估文件字节大小")
    filesize_str: str = Field(default="", description="预估文件可读大小，如 6.5 MB")
    width: int = 0
    height: int = 0
    codec: str = "H.264"

class VideoEpisode(BaseModel):
    id: str = Field(description="分P/集ID，如 cid 或 bvid")
    title: str = Field(description="分P/集标题")
    page: int = Field(default=1, description="分P序号/集数")
    duration: int = Field(default=0, description="时长(秒)")
    cover: str = Field(default="", description="分P/集封面")
    cid: Optional[int] = Field(default=None, description="B站特有 cid")
    bvid: Optional[str] = Field(default=None, description="B站特有 bvid (合集场景)")
    share_url: str = Field(default="", description="该分集独立跳转链接")

class VideoInfo(BaseModel):
    no_watermark_url: str = ""
    watermark_url: str = ""
    audio_url: str = ""  # DASH 音频轨直链 (B站等)
    ratio: str = "720p"
    width: int = 0
    height: int = 0
    duration: int = 0
    qualities: List[QualityOption] = Field(default_factory=list, description="多清晰度画质列表")

class MediaResponse(BaseModel):
    success: bool = True
    platform: str = Field(description="平台名称，如 douyin, xhs, kuaishou, pipixia, bilibili")
    platform_name: str = Field(description="平台中文展示名称，如 抖音, 小红书, 快手")
    type: str = Field(description="媒体类型: video 或 images")
    id: str = Field(description="作品唯一ID")
    title: str = Field(description="作品标题或文案描述")
    cover: str = Field(default="", description="作品主封面")
    author: AuthorInfo = Field(default_factory=AuthorInfo)
    statistics: StatisticsInfo = Field(default_factory=StatisticsInfo)
    music: MusicInfo = Field(default_factory=MusicInfo)
    video: Optional[VideoInfo] = None
    episodes: List[VideoEpisode] = Field(default_factory=list, description="多P分集或视频选集列表")
    current_page: int = Field(default=1, description="当前选中的分P序号")
    season_title: Optional[str] = Field(default=None, description="若属于合集，合集名称")
    images: List[str] = Field(default_factory=list, description="无水印高清原图列表")
    image_count: int = 0
    create_time: int = 0
    error: Optional[str] = None

class UserProfileInfo(BaseModel):
    nickname: str = "未知博主"
    avatar: str = ""
    unique_id: str = ""
    sec_uid: str = ""
    signature: str = ""
    follower_count: int = 0
    total_favorited: int = 0
    aweme_count: int = 0

class UserPostItem(BaseModel):
    id: str = Field(description="作品ID")
    title: str = Field(default="", description="作品标题或文案")
    cover: str = Field(default="", description="封面图")
    type: str = Field(default="video", description="类型: video 或 images")
    duration: int = Field(default=0, description="时长(秒)")
    create_time: int = Field(default=0, description="发布时间戳")
    digg_count: int = Field(default=0, description="点赞数")
    comment_count: int = 0
    download_url: str = Field(default="", description="默认高清下载链接/视频直链")
    images: List[str] = Field(default_factory=list, description="若为图集则包含所有原图链接")
    share_url: str = Field(default="", description="作品原网页链接")

class UserProfileResponse(BaseModel):
    success: bool = True
    platform: str = Field(description="平台标识")
    platform_name: str = Field(description="平台中文名")
    user: UserProfileInfo = Field(default_factory=UserProfileInfo)
    posts: List[UserPostItem] = Field(default_factory=list, description="作品列表")
    has_more: bool = Field(default=False, description="是否还有更多作品")
    max_cursor: int = Field(default=0, description="下一页分页游标")
    error: Optional[str] = None

class BaseExtractor(ABC):
    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    @abstractmethod
    def match(self, url: str) -> bool:
        """检查该 URL 是否属于本解析器支持的平台"""
        pass

    @abstractmethod
    async def extract(self, url: str) -> MediaResponse:
        """解析单作品核心逻辑，返回统一的 MediaResponse"""
        pass

    async def extract_user_posts(self, url: str, cursor: int = 0, count: int = 20) -> UserProfileResponse:
        """解析博主主页与分页作品列表 (默认返回不支持提示)"""
        return UserProfileResponse(
            success=False,
            platform="unknown",
            platform_name="未知平台",
            error="该平台暂未支持博主主页全量抓取功能",
        )

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

class MusicInfo(BaseModel):
    title: str = ""
    author: str = ""
    url: str = ""
    cover: str = ""

class VideoInfo(BaseModel):
    no_watermark_url: str = ""
    watermark_url: str = ""
    ratio: str = "720p"
    width: int = 0
    height: int = 0
    duration: int = 0

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
    images: List[str] = Field(default_factory=list, description="无水印高清原图列表")
    image_count: int = 0
    create_time: int = 0
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
        """解析核心逻辑，返回统一的 MediaResponse"""
        pass

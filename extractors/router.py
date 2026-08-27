import re
from typing import Optional, List
from extractors.base import BaseExtractor, MediaResponse
from extractors.douyin import DouyinExtractor
from extractors.xiaohongshu import XiaohongshuExtractor
from extractors.kuaishou import KuaishouExtractor
from extractors.pipixia import PipixiaExtractor
from extractors.bilibili import BilibiliExtractor
from extractors.twitter import TwitterExtractor

class UnifiedMediaRouter:
    def __init__(self):
        # 注册所有支持的主流平台解析器
        self.extractors: List[BaseExtractor] = [
            DouyinExtractor(),
            XiaohongshuExtractor(),
            KuaishouExtractor(),
            PipixiaExtractor(),
            BilibiliExtractor(),
            TwitterExtractor(),
        ]

    @staticmethod
    def clean_and_extract_url(text: str) -> Optional[str]:
        """从用户粘贴的任意复杂文本中提取出有效 URL"""
        if not text:
            return None
        match = re.search(r"https?://[a-zA-Z0-9.\-_/%\?&=#+:~]+", text)
        return match.group(0) if match else None

    async def parse(self, text: str) -> MediaResponse:
        """核心路由与解析入口"""
        url = self.clean_and_extract_url(text)
        if not url:
            return MediaResponse(
                success=False,
                platform="unknown",
                platform_name="未知平台",
                type="video",
                id="",
                title="",
                error="未从输入内容中检测到有效的链接，请检查输入",
            )

        # 遍历已注册解析器
        for extractor in self.extractors:
            if extractor.match(url):
                return await extractor.extract(url)

        return MediaResponse(
            success=False,
            platform="unsupported",
            platform_name="暂不支持",
            type="video",
            id="",
            title="",
            error="当前暂不支持该平台链接，已支持：抖音、TikTok、小红书、快手、皮皮虾、B站 (Bilibili)、Twitter / X",
        )

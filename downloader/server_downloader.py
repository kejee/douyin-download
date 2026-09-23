import os
import re
import asyncio
import logging
import shutil
import time
from typing import Dict, List, Optional, Any
from pydantic import BaseModel
import httpx
from extractors.router import UnifiedMediaRouter
from downloader.paths import (
    default_download_dir,
    ensure_dir,
    is_desktop_mode,
    load_local_dir,
    save_local_dir,
)
from downloader.http_util import download_headers

logger = logging.getLogger(__name__)

# 下载归档根目录（不依赖进程 cwd；本模块导入期不做任何磁盘写入）
DOWNLOAD_DIR = default_download_dir()

class ServerTask(BaseModel):
    id: str
    title: str
    filename: str
    save_path: str
    url: Optional[str] = None
    direct_url: Optional[str] = None
    audio_url: Optional[str] = None
    sessdata: Optional[str] = None
    channel: str = "server"  # server: NAS/服务端归档 | local: 桌面端本地保存
    status: str = "waiting"  # waiting | running | paused | success | error
    progress: int = 0
    total_bytes: int = 0
    downloaded_bytes: int = 0
    error: Optional[str] = None
    created_at: float = 0.0

class ServerDownloadManager:
    """服务端/NAS/桌面端 统一异步下载与自动归档调度引擎"""

    def __init__(self, download_dir: str = DOWNLOAD_DIR, max_concurrent: int = 3):
        self.server_dir = download_dir
        self.local_dir = load_local_dir() if is_desktop_mode() else download_dir
        self.max_concurrent = max_concurrent
        # 惰性建目录：失败不影响进程启动（历史坑：import 期 makedirs 导致双击崩溃）
        ensure_dir(self.server_dir)
        ensure_dir(self.local_dir)
        self.tasks: Dict[str, ServerTask] = {}
        self.task_controllers: Dict[str, asyncio.Event] = {}
        self.router = UnifiedMediaRouter()
        self.listeners: List[asyncio.Queue] = []
        self._worker_task = None
        self._running = True
        self._semaphore = asyncio.Semaphore(max_concurrent)

    def get_config(self) -> Dict[str, Any]:
        active_root = self.local_dir if is_desktop_mode() else self.server_dir
        return {
            "download_dir": self.server_dir,
            "server_dir": self.server_dir,
            "local_dir": self.local_dir,
            "max_concurrent": self.max_concurrent,
            "is_nas_mode": bool(os.getenv("DOWNLOAD_DIR")),
            "is_desktop": is_desktop_mode(),
            "free_space_gb": self._get_free_space_gb(active_root),
        }

    def set_local_dir(self, path: str) -> bool:
        """设置桌面端"存到当前设备"的目标目录（持久化到用户配置）"""
        path = (path or "").strip()
        if not path or not os.path.isdir(path):
            return False
        self.local_dir = path
        save_local_dir(path)
        logger.info(f"本地保存目录已切换为: {path}")
        return True

    def _root_for_channel(self, channel: str) -> str:
        return self.local_dir if channel == "local" else self.server_dir

    def _get_free_space_gb(self, path: str = "") -> float:
        try:
            total, used, free = shutil.disk_usage(path or self.server_dir)
            return round(free / (1024 ** 3), 2)
        except Exception:
            return 0.0

    def sanitize_filename(self, name: str) -> str:
        if not name:
            return "media"
        # 移除非法路径字符
        clean = re.sub(r'[\r\n\\/:*?"<>|]+', '_', name).strip(' ._')
        if not clean:
            return "media"
        if len(clean) <= 100:
            return clean
        # 超长时截断，但保留扩展名（否则 .mp4/.jpg 会被吃掉）
        stem, dot, ext = clean.rpartition('.')
        if dot and 0 < len(ext) <= 5:
            return f"{stem[:100 - len(ext) - 1]}.{ext}"
        return clean[:100]

    def add_task(
        self,
        url: Optional[str] = None,
        direct_url: Optional[str] = None,
        audio_url: Optional[str] = None,
        title: str = "视频",
        season_title: Optional[str] = None,
        platform: str = "media",
        page_num: Optional[int] = None,
        sessdata: Optional[str] = None,
        channel: str = "server",
        filename: Optional[str] = None,
        subdir: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> ServerTask:
        """解析归档路径并加入下载队列。

        路径规则:
        1. 显式 filename 优先（桌面端沿用前端已算好的文件名，保留原扩展名）；
        2. 合集/多P    -> {root}/{合集名}/P01_{标题}.mp4
        3. 普通单作品  -> {root}/{平台}/{标题}.mp4（桌面端本地保存则平铺，不建平台子目录）
        """
        root = self._root_for_channel(channel)
        safe_title = self.sanitize_filename(title)

        if filename:
            resolved = self.sanitize_filename(filename)
        else:
            p_prefix = f"P{str(page_num).zfill(2)}_" if page_num else ""
            resolved = f"{p_prefix}{safe_title}.mp4"

        if subdir:
            folder_name = self.sanitize_filename(subdir)
        elif season_title:
            folder_name = self.sanitize_filename(season_title)
        elif channel == "local":
            folder_name = ""  # 用户已选定保存目录，直接平铺
        else:
            folder_name = self.sanitize_filename(platform)

        target_folder = os.path.join(root, folder_name) if folder_name else root
        ensure_dir(target_folder)
        filename = resolved
        save_path = os.path.join(target_folder, filename)

        # 允许调用方（桌面端前端）指定任务 id，使 SSE 事件能与本地任务一一对应，
        # 避免事件早于 HTTP 响应到达而产生重复条目
        task_id = (task_id or "").strip() or f"stask_{int(time.time() * 1000)}_{len(self.tasks) + 1}"
        if task_id in self.tasks:
            task_id = f"{task_id}_{int(time.time() * 1000)}"
        task = ServerTask(
            id=task_id,
            title=title,
            filename=filename,
            save_path=save_path,
            url=url,
            direct_url=direct_url,
            audio_url=audio_url,
            sessdata=sessdata,
            channel=channel,
            status="waiting",
            progress=0,
            created_at=time.time(),
        )

        self.tasks[task_id] = task
        self._notify_listeners("task_added", task.dict())
        
        # 异步启动执行
        asyncio.create_task(self._process_single_task(task))
        return task

    async def _process_single_task(self, task: ServerTask):
        async with self._semaphore:
            if task.status == "paused" or task.status == "canceled":
                return

            task.status = "running"
            task.progress = 5
            self._notify_listeners("task_progress", task.dict())

            try:
                v_url = task.direct_url
                a_url = task.audio_url

                # 如果传入的是作品/分集页面链接，先进行核心解析
                if not v_url and task.url:
                    parse_result = await self.router.parse(task.url, sessdata=task.sessdata)
                    if not parse_result.success or not parse_result.video:
                        raise ValueError(parse_result.error or "解析媒体数据失败")
                    v_url = parse_result.video.no_watermark_url
                    a_url = parse_result.video.audio_url

                if not v_url:
                    raise ValueError("未提取到有效的视频下载流地址")

                # 如果需要音视频混流 (如 B站 DASH 音视频分离格式)
                if a_url:
                    await self._download_and_mux_ffmpeg(task, v_url, a_url)
                else:
                    await self._download_direct_stream(task, v_url)

                task.status = "success"
                task.progress = 100
                self._notify_listeners("task_success", task.dict())
            except asyncio.CancelledError:
                self._cleanup_temp_files(task)
                if task.status == "canceled":
                    self._notify_listeners("task_canceled", task.dict())
                else:
                    task.status = "paused"
                    self._notify_listeners("task_paused", task.dict())
            except Exception as e:
                logger.exception(f"服务端下载任务异常: {task.id}")
                self._cleanup_temp_files(task)
                task.status = "error"
                task.error = str(e)
                self._notify_listeners("task_error", task.dict())

    def _cleanup_temp_files(self, task: ServerTask):
        """清理中断/失败残留的分片临时文件"""
        for temp_f in (
            f"{task.save_path}.downloading",
            f"{task.save_path}.temp_v.m4s",
            f"{task.save_path}.temp_a.m4s",
        ):
            try:
                if os.path.exists(temp_f):
                    os.remove(temp_f)
            except OSError:
                pass

    async def _download_direct_stream(self, task: ServerTask, video_url: str):
        """直链流式落盘"""
        headers = download_headers(video_url or task.direct_url)
        temp_path = f"{task.save_path}.downloading"

        async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=True) as client:
            async with client.stream("GET", video_url) as resp:
                if resp.status_code >= 400:
                    raise RuntimeError(f"视频源响应异常: HTTP {resp.status_code}")

                total = int(resp.headers.get("content-length", 0))
                task.total_bytes = total
                downloaded = 0

                with open(temp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        if task.status == "paused" or task.status == "canceled":
                            raise asyncio.CancelledError()
                        f.write(chunk)
                        downloaded += len(chunk)
                        task.downloaded_bytes = downloaded
                        if total > 0:
                            task.progress = min(99, int((downloaded / total) * 95))
                            self._notify_listeners("task_progress", task.dict())

        # 完成后原子重命名
        if os.path.exists(task.save_path):
            os.remove(task.save_path)
        os.rename(temp_path, task.save_path)

    async def _download_and_mux_ffmpeg(self, task: ServerTask, video_url: str, audio_url: str):
        """调用 FFmpeg 混流下载并直接保存至 NAS 目标目录"""
        temp_v = f"{task.save_path}.temp_v.m4s"
        temp_a = f"{task.save_path}.temp_a.m4s"

        headers = download_headers(video_url)

        # 1. 下载视频轨
        task.progress = 10
        self._notify_listeners("task_progress", task.dict())
        async with httpx.AsyncClient(headers=headers, timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", video_url) as resp:
                total_v = int(resp.headers.get("content-length", 0))
                if resp.status_code >= 400:
                    raise RuntimeError(f"视频轨响应异常: HTTP {resp.status_code}")
                dl_v = 0
                with open(temp_v, "wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        if task.status in ("paused", "canceled"):
                            raise asyncio.CancelledError()
                        f.write(chunk)
                        dl_v += len(chunk)
                        if total_v > 0:
                            task.progress = 10 + int((dl_v / total_v) * 45)
                            self._notify_listeners("task_progress", task.dict())

            # 2. 下载音频轨
            task.progress = 60
            self._notify_listeners("task_progress", task.dict())
            async with client.stream("GET", audio_url) as resp:
                total_a = int(resp.headers.get("content-length", 0))
                if resp.status_code >= 400:
                    raise RuntimeError(f"音频轨响应异常: HTTP {resp.status_code}")
                dl_a = 0
                with open(temp_a, "wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        if task.status in ("paused", "canceled"):
                            raise asyncio.CancelledError()
                        f.write(chunk)
                        dl_a += len(chunk)
                        if total_a > 0:
                            task.progress = 60 + int((dl_a / total_a) * 25)
                            self._notify_listeners("task_progress", task.dict())

        # 3. FFmpeg 极速封装落盘 (copy 流无损不转码)
        task.progress = 90
        self._notify_listeners("task_progress", task.dict())
        
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", temp_v,
            "-i", temp_a,
            "-c:v", "copy",
            "-c:a", "copy",
            "-movflags", "+faststart",
            task.save_path
        ]

        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await proc.communicate()

        # 清理临时音视频轨
        for temp_f in [temp_v, temp_a]:
            if os.path.exists(temp_f):
                try:
                    os.remove(temp_f)
                except Exception:
                    pass

        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg 封装失败: {stderr.decode('utf-8', errors='ignore')}")

    def pause_task(self, task_id: str) -> bool:
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.status = "paused"
            self._notify_listeners("task_paused", task.dict())
            return True
        return False

    def resume_task(self, task_id: str) -> bool:
        if task_id in self.tasks:
            task = self.tasks[task_id]
            if task.status in ["paused", "error"]:
                task.status = "waiting"
                self._notify_listeners("task_resumed", task.dict())
                asyncio.create_task(self._process_single_task(task))
                return True
        return False

    def cancel_task(self, task_id: str) -> bool:
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.status = "canceled"
            self._notify_listeners("task_canceled", task.dict())
            return True
        return False

    def clear_completed(self) -> int:
        to_del = [tid for tid, t in self.tasks.items() if t.status in ["success", "canceled", "error"]]
        for tid in to_del:
            del self.tasks[tid]
        return len(to_del)

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self.listeners:
            self.listeners.remove(q)

    def _notify_listeners(self, event_type: str, data: Dict[str, Any]):
        message = {"event": event_type, "data": data, "timestamp": time.time()}
        for q in list(self.listeners):
            try:
                q.put_nowait(message)
            except Exception:
                pass

# 单例实例
server_downloader = ServerDownloadManager()

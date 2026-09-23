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
from downloader.http_util import bilibili_cookie, download_headers
from extractors.media_urls import build_download_candidates, host_of

logger = logging.getLogger(__name__)


class _SourceRejected(Exception):
    """媒体源在响应头阶段就被拒（4xx/5xx），可换源重试"""


def _fmt_size(num_bytes: int) -> str:
    """人类可读的体积字符串（日志用）"""
    size = float(num_bytes or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)}B" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"

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

        logger.info(
            f"[{task_id}] 任务创建 | channel={channel} | {filename} -> {save_path}"
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
            logger.info(
                f"[{task.id}] 开始下载 | {task.filename} | 来源="
                f"{'作品链接' if (task.url and not task.direct_url) else '直链'}"
            )
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
                    logger.info(
                        f"[{task.id}] 解析完成 | {parse_result.platform_name} | "
                        f"视频源={host_of(v_url)} | 音频轨={'有' if a_url else '无'}"
                    )

                if not v_url:
                    raise ValueError("未提取到有效的视频下载流地址")

                # 如果需要音视频混流 (如 B站 DASH 音视频分离格式)
                if a_url:
                    await self._download_and_mux_ffmpeg(task, v_url, a_url)
                else:
                    await self._download_direct_stream(task, v_url)

                task.status = "success"
                task.progress = 100
                final_size = (
                    os.path.getsize(task.save_path) if os.path.exists(task.save_path) else 0
                )
                logger.info(
                    f"[{task.id}] 下载完成 | {task.filename} | {_fmt_size(final_size)} | "
                    f"耗时 {time.time() - task.created_at:.1f}s | {task.save_path}"
                )
                self._notify_listeners("task_success", task.dict())
            except asyncio.CancelledError:
                self._cleanup_temp_files(task)
                if task.status == "canceled":
                    logger.info(f"[{task.id}] 已取消 | {task.filename}")
                    self._notify_listeners("task_canceled", task.dict())
                else:
                    task.status = "paused"
                    logger.info(
                        f"[{task.id}] 已暂停 | {task.filename} | "
                        f"已下载 {_fmt_size(task.downloaded_bytes)}/{_fmt_size(task.total_bytes)}"
                    )
                    self._notify_listeners("task_paused", task.dict())
            except Exception as e:
                logger.exception(
                    f"[{task.id}] 下载失败 | {task.filename} | "
                    f"耗时 {time.time() - task.created_at:.1f}s | {e}"
                )
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
        """直链流式落盘（失败自动换源）"""
        temp_path = f"{task.save_path}.downloading"
        await self._download_track(
            task, video_url, temp_path, label="媒体流", base_progress=0, span=95
        )

        # 完成后原子重命名
        if os.path.exists(task.save_path):
            os.remove(task.save_path)
        os.rename(temp_path, task.save_path)

    async def _download_track(
        self,
        task: ServerTask,
        url: str,
        dest_path: str,
        label: str = "媒体流",
        base_progress: int = 0,
        span: int = 95,
        backups: Optional[List[str]] = None,
    ):
        """下载单条轨道，被拒时按候选地址换源重试。

        B站会把部分码率变体调度到第三方 PCDN 节点（*.mcdn.bilivideo.cn /
        *.edge.mountaintoys.cn），这类节点按 IP + 会话授权、稳定性差，实测会
        直接返回 403；官方 upos-* 镜像接受同一份签名路径（实测 6/6 可用）。
        因此按「原地址 → 备份地址 → 官方镜像改写」逐个重试，并透传 SESSDATA，
        避免登录态高码率流被判未授权。
        """
        candidates = build_download_candidates(url, backups)
        last_error = ""
        for index, candidate in enumerate(candidates):
            if index:
                logger.warning(
                    f"[{task.id}] {label} 换源重试 {index + 1}/{len(candidates)} "
                    f"-> {host_of(candidate)}（上次失败: {last_error}）"
                )
                task.progress = base_progress
                self._notify_listeners("task_progress", task.dict())
            headers = download_headers(candidate, cookie=bilibili_cookie(task.sessdata))
            try:
                await self._stream_to_file(
                    task, candidate, headers, dest_path, base_progress, span
                )
                logger.info(
                    f"[{task.id}] {label} 完成 | {host_of(candidate)} | "
                    f"{_fmt_size(task.downloaded_bytes)} | 候选 {index + 1}/{len(candidates)}"
                )
                return
            except _SourceRejected as exc:
                last_error = str(exc)
                continue
        raise RuntimeError(
            f"{label}全部候选地址均不可用（共 {len(candidates)} 个）: {last_error}"
        )

    async def _stream_to_file(
        self,
        task: ServerTask,
        url: str,
        headers: Dict[str, str],
        dest_path: str,
        base_progress: int,
        span: int,
    ):
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise _SourceRejected(f"HTTP {resp.status_code}")

                total = int(resp.headers.get("content-length", 0))
                task.total_bytes = total
                task.downloaded_bytes = 0

                with open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        if task.status in ("paused", "canceled"):
                            raise asyncio.CancelledError()
                        f.write(chunk)
                        task.downloaded_bytes += len(chunk)
                        if total > 0:
                            task.progress = min(
                                99, base_progress + int((task.downloaded_bytes / total) * span)
                            )
                            self._notify_listeners("task_progress", task.dict())

    async def _download_and_mux_ffmpeg(self, task: ServerTask, video_url: str, audio_url: str):
        """下载音视频双轨并调用 FFmpeg 无损封装"""
        temp_v = f"{task.save_path}.temp_v.m4s"
        temp_a = f"{task.save_path}.temp_a.m4s"

        # 1. 下载视频轨
        task.progress = 10
        self._notify_listeners("task_progress", task.dict())
        await self._download_track(
            task, video_url, temp_v, label="视频轨", base_progress=10, span=45
        )

        # 2. 下载音频轨
        task.progress = 60
        self._notify_listeners("task_progress", task.dict())
        await self._download_track(
            task, audio_url, temp_a, label="音频轨", base_progress=60, span=25
        )

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

import os
import re
import asyncio
import logging
import shutil
import time
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
import httpx
from extractors.router import UnifiedMediaRouter
from downloader.paths import (
    MAX_MAX_CONCURRENT,
    MIN_MAX_CONCURRENT,
    default_download_dir,
    ensure_dir,
    is_desktop_mode,
    load_local_dir,
    load_max_concurrent,
    reveal_in_file_manager,
    save_local_dir,
    save_max_concurrent,
)
from downloader.history import delete_history, record_history
from downloader.http_util import bilibili_cookie, download_headers
from downloader.preview import preview_dir
from extractors.media_urls import build_download_candidates, host_of

logger = logging.getLogger(__name__)


class _SourceRejected(Exception):
    """媒体源在响应头阶段就被拒（4xx/5xx），可换源重试"""


class DuplicateTaskError(Exception):
    """目标路径上已存在活动任务（waiting / running / paused）

    同一 save_path 上跑两个任务是危险的：两者会写同一个临时文件，后开者以
    "wb" 截断前者已写内容，两个协程又各自维护 offset 写同一 inode，内容会交错；
    先完成者 rename 走文件后，后完成者 rename 直接抛 FileNotFoundError。
    实测更糟的情况是「任务报 success 但目标文件根本不存在」——
    因此同一路径同时只允许一个活动任务。
    """

    def __init__(self, existing: "ServerTask"):
        self.existing = existing
        super().__init__(f"该文件已在下载队列中（{existing.status}）")


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
    platform: str = "media"  # 来源平台（bilibili / douyin / xhs ...），历史记录里要展示
    direct_backup_urls: List[str] = Field(default_factory=list, description="视频轨备用直链")
    audio_backup_urls: List[str] = Field(default_factory=list, description="音频轨备用直链")
    status: str = "waiting"  # waiting | running | paused | success | error
    progress: int = 0
    total_bytes: int = 0
    downloaded_bytes: int = 0
    error: Optional[str] = None
    created_at: float = 0.0

class ServerDownloadManager:
    """服务端/NAS/桌面端 统一异步下载与自动归档调度引擎"""

    # 同一个候选地址内的重试次数（含首次）与退避秒数。
    # 网络抖动是最常见的中断形态，而换源意味着从头开始 —— 所以先在同源上
    # 多试几次（可从断点续传），把换源留给真正的源端故障。
    TRACK_RETRIES = 3
    RETRY_BACKOFF = (1.0, 2.5)

    def __init__(self, download_dir: str = DOWNLOAD_DIR, max_concurrent: Optional[int] = None):
        self.server_dir = download_dir
        self.local_dir = load_local_dir() if is_desktop_mode() else download_dir
        self.max_concurrent = max_concurrent or load_max_concurrent()
        # 惰性建目录：失败不影响进程启动（历史坑：import 期 makedirs 导致双击崩溃）
        ensure_dir(self.server_dir)
        ensure_dir(self.local_dir)
        self.tasks: Dict[str, ServerTask] = {}
        self.task_controllers: Dict[str, asyncio.Event] = {}
        self.router = UnifiedMediaRouter()
        self.listeners: List[asyncio.Queue] = []
        self._worker_task = None
        self._running = True
        # 并发闸门：不用 asyncio.Semaphore —— 它的容量创建后无法修改，
        # 而"同时下载数"要在界面上随时可调、且立即生效。这里用计数 + 条件变量，
        # 改上限时唤醒等待者重新判断即可。
        self._active_slots = 0
        self._gate = asyncio.Condition()
        # 正在被某个协程执行的 task.id（防止同一任务被并发下两次）
        self._running_ids: set = set()
        # 已派发协程（含还在排队等槽位的）的 task.id（防止同一任务被重复调度）
        self._scheduled: set = set()

    async def set_max_concurrent(self, value: int) -> int:
        """调整同时下载数（1~8），持久化并立即生效"""
        try:
            value = int(value)
        except (TypeError, ValueError):
            return self.max_concurrent
        value = max(MIN_MAX_CONCURRENT, min(MAX_MAX_CONCURRENT, value))
        self.max_concurrent = value
        save_max_concurrent(value)
        logger.info(f"同时下载数已设为 {value}")
        # 上限调大后要唤醒正在排队的任务（调小则无需操作，等待者会自行继续判断）
        async with self._gate:
            self._gate.notify_all()
        return value

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

    def _resolve_target(self, filename: str, subdir: str = "") -> str:
        """算出目标文件的绝对路径（与 add_task 的落盘规则保持一致）"""
        root = self.local_dir
        if subdir:
            root = os.path.join(root, self.sanitize_filename(subdir))
        return os.path.join(root, self.sanitize_filename(filename))

    def unique_filename(self, filename: str, subdir: str = "") -> str:
        """在目标目录里找一个不冲突的名字：xxx.mp4 -> xxx (1).mp4 -> xxx (2).mp4

        与 Finder 的「保留两者」命名习惯一致。
        """
        safe = self.sanitize_filename(filename)
        stem, dot, ext = safe.rpartition('.')
        if not dot or not (0 < len(ext) <= 5):
            stem, ext = safe, ''
        for index in range(1, 1000):
            candidate = f"{stem} ({index})" + (f".{ext}" if ext else "")
            if not os.path.exists(self._resolve_target(candidate, subdir)):
                return candidate
        return safe

    def check_local_file(self, filename: str, subdir: str = "") -> Dict[str, Any]:
        """下载前检查目标文件是否已存在

        供前端弹窗让用户选择「覆盖重下」还是「保留两者」。只读操作。
        """
        safe = self.sanitize_filename(filename)
        info: Dict[str, Any] = {"exists": False, "filename": safe, "suggested": safe}
        target = self._resolve_target(safe, subdir)
        if not os.path.isfile(target):
            return info
        try:
            stat = os.stat(target)
        except OSError:
            return info
        info.update({
            "exists": True,
            "size_text": _fmt_size(stat.st_size),
            "mtime_text": time.strftime("%m-%d %H:%M", time.localtime(stat.st_mtime)),
            "suggested": self.unique_filename(safe, subdir),
        })
        return info

    def reveal_file(self, path: str) -> bool:
        """在访达/资源管理器中定位已下载的文件（桌面端「定位文件」入口）。

        这是一个可由页面 JS 直接调用的接口，因此必须限制范围：只允许定位
        **下载根目录**（本地保存目录 / 服务端归档目录）之内的文件，
        避免被用来探测或打开任意路径。
        """
        target = os.path.realpath(path or "")
        if not target or not os.path.isfile(target):
            return False
        roots = {
            os.path.realpath(self.local_dir),
            os.path.realpath(self.server_dir),
        }
        if not any(root and target.startswith(root + os.sep) for root in roots):
            logger.warning(f"拒绝定位下载目录之外的文件: {target}")
            return False
        ok = reveal_in_file_manager(target)
        logger.info(f"定位文件 | {target} | {'成功' if ok else '失败'}")
        return ok

    def list_local_files(self, subdir: str = "") -> Dict[str, Any]:
        """列出桌面端保存目录下的文件名

        供前端在批量下载前跳过「本地已存在」的集数。只读操作，不改动任何文件。
        """
        target = self.local_dir
        if subdir:
            target = os.path.join(self.local_dir, self.sanitize_filename(subdir))
        if not os.path.isdir(target):
            return {"dir": target, "exists": False, "files": []}
        try:
            files = sorted(
                n for n in os.listdir(target)
                if os.path.isfile(os.path.join(target, n))
                and not n.endswith((".part", ".m4s"))
            )
        except OSError:
            files = []
        return {"dir": target, "exists": True, "files": files}

    def _root_for_channel(self, channel: str) -> str:
        if channel == "preview":
            # 预览缓存：独立目录，不混进用户的下载归档
            return preview_dir()
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
        direct_backup_urls: Optional[List[str]] = None,
        audio_backup_urls: Optional[List[str]] = None,
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
        elif channel in ("local", "preview"):
            folder_name = ""  # 用户已选定保存目录 / 预览缓存直接平铺
        else:
            folder_name = self.sanitize_filename(platform)

        target_folder = os.path.join(root, folder_name) if folder_name else root
        ensure_dir(target_folder)
        filename = resolved
        save_path = os.path.join(target_folder, filename)

        # 同一目标路径只允许一个活动任务。已完成 / 失败 / 取消的任务不阻塞，
        # 否则用户想重下已失败的文件就永远排不进去。
        for existing in self.tasks.values():
            if existing.save_path == save_path and existing.status in ("waiting", "running", "paused"):
                logger.info(
                    f"任务跳过 | {filename} 已在队列中（{existing.id} / {existing.status}）"
                )
                raise DuplicateTaskError(existing)

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
            platform=platform or "media",
            direct_backup_urls=list(direct_backup_urls or []),
            audio_backup_urls=list(audio_backup_urls or []),
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
        # 同一任务同时只允许一个"调度中的协程"。
        # 触发场景：任务在排队等槽位时被「全部暂停」，随后「开始全部」又派发新协程；
        # 老协程会随槽位释放醒来。两个协程写同一个临时文件 = 内容交错（历史最严重事故形态）；
        # 即便错开执行，也会白跑一遍流量并覆盖已完成的文件。
        # 这里在**入口**就拦掉重复调度，判断与占位之间没有 await。
        if task.id in self._scheduled:
            logger.info(f"[{task.id}] 已有调度中的协程，忽略重复调度 | {task.filename}")
            return
        self._scheduled.add(task.id)

        acquired = False
        claimed = False
        try:
            acquired = await self._acquire_slot()
            if not acquired:
                return

            # 已完成的任务不再执行：排队期间被"继续"过的任务，可能在拿到槽位时已经下完了
            if task.status in ("paused", "canceled", "success"):
                return

            # 双保险：真正开始执行前再确认没有别的协程在跑同一个任务
            if task.id in self._running_ids:
                logger.info(f"[{task.id}] 已有协程在执行，跳过重复调度 | {task.filename}")
                return
            self._running_ids.add(task.id)
            claimed = True

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
                v_backups = list(task.direct_backup_urls or [])
                a_backups = list(task.audio_backup_urls or [])

                # 如果传入的是作品/分集页面链接，先进行核心解析
                if not v_url and task.url:
                    parse_result = await self.router.parse(task.url, sessdata=task.sessdata)
                    if not parse_result.success or not parse_result.video:
                        raise ValueError(parse_result.error or "解析媒体数据失败")
                    v_url = parse_result.video.no_watermark_url
                    a_url = parse_result.video.audio_url
                    v_backups = list(parse_result.video.video_backup_urls or [])
                    a_backups = list(parse_result.video.audio_backup_urls or [])
                    logger.info(
                        f"[{task.id}] 解析完成 | {parse_result.platform_name} | "
                        f"视频源={host_of(v_url)} | 音频轨={'有' if a_url else '无'}"
                    )

                if not v_url:
                    raise ValueError("未提取到有效的视频下载流地址")

                # 如果需要音视频混流 (如 B站 DASH 音视频分离格式)
                if a_url:
                    await self._download_and_mux_ffmpeg(task, v_url, a_url, v_backups, a_backups)
                else:
                    await self._download_direct_stream(task, v_url, v_backups)

                task.status = "success"
                task.progress = 100
                final_size = (
                    os.path.getsize(task.save_path) if os.path.exists(task.save_path) else 0
                )
                logger.info(
                    f"[{task.id}] 下载完成 | {task.filename} | {_fmt_size(final_size)} | "
                    f"耗时 {time.time() - task.created_at:.1f}s | {task.save_path}"
                )
                self._record_history(task, final_size)
                self._notify_listeners("task_success", task.dict())
            except asyncio.CancelledError:
                if task.status == "canceled":
                    # 用户主动取消：清理分片
                    self._cleanup_temp_files(task)
                    logger.info(f"[{task.id}] 已取消 | {task.filename}")
                    # 历史记录统一在 cancel_task 里写：那里是"用户取消"的唯一权威入口，
                    # 且能覆盖"任务还在排队（waiting）就被取消"这种没有协程在跑的情况。
                    self._notify_listeners("task_canceled", task.dict())
                else:
                    # 暂停：**保留分片**，继续时从断点续传
                    task.status = "paused"
                    logger.info(
                        f"[{task.id}] 已暂停 | {task.filename} | "
                        f"已下载 {_fmt_size(task.downloaded_bytes)}/{_fmt_size(task.total_bytes)}"
                        f"（保留分片，继续时从断点续传）"
                    )
                    self._notify_listeners("task_paused", task.dict())
            except Exception as e:
                logger.exception(
                    f"[{task.id}] 下载失败 | {task.filename} | "
                    f"耗时 {time.time() - task.created_at:.1f}s | {e}"
                )
                # 失败时同样保留分片：用户点「重试」即可从断点续传。
                # 残片的回收交给 clear_completed（见下）。
                task.status = "error"
                task.error = str(e)
                self._record_history(task)
                self._notify_listeners("task_error", task.dict())
        finally:
            if claimed:
                self._running_ids.discard(task.id)
            self._scheduled.discard(task.id)
            if acquired:
                await self._release_slot()

    async def _acquire_slot(self) -> bool:
        """占用一个下载槽位（超过同时下载数则排队等待）。

        返回 False 表示任务在排队期间被取消/暂停，无需再执行。
        """
        async with self._gate:
            while self._active_slots >= self.max_concurrent:
                await self._gate.wait()
            self._active_slots += 1
        return True

    async def _release_slot(self) -> None:
        async with self._gate:
            if self._active_slots > 0:
                self._active_slots -= 1
            self._gate.notify_all()

    @staticmethod
    def _discard_partial(dest_path: str) -> None:
        """丢弃已下载的临时分片

        换源时调用。同源重试时相反 —— 必须保留分片，断点续传才有依据。
        """
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except OSError:
            pass

    def _temp_path(self, task: ServerTask, suffix: str) -> str:
        """临时文件路径（带任务 id）

        早先用固定的 `<save_path>.downloading` 作临时名：两个指向同一目标的任务
        会写同一个文件，互相截断与交错。带上 task.id 后各写各的，互不干扰。
        """
        return f"{task.save_path}.{task.id}.{suffix}"

    def _cleanup_temp_files(self, task: ServerTask):
        """清理中断/失败残留的分片临时文件（含旧命名，便于升级后回收）"""
        candidates = [
            self._temp_path(task, "part"),
            self._temp_path(task, "v.m4s"),
            self._temp_path(task, "a.m4s"),
            # 旧版本使用的固定命名，升级后可能残留
            f"{task.save_path}.downloading",
            f"{task.save_path}.temp_v.m4s",
            f"{task.save_path}.temp_a.m4s",
        ]
        for temp_f in candidates:
            try:
                if os.path.exists(temp_f):
                    os.remove(temp_f)
            except OSError:
                pass

    async def _download_direct_stream(
        self,
        task: ServerTask,
        video_url: str,
        backups: Optional[List[str]] = None,
    ):
        """直链流式落盘（失败自动换源）"""
        temp_path = self._temp_path(task, "part")
        await self._download_track(
            task, video_url, temp_path, label="媒体流",
            base_progress=0, span=95, backups=backups,
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
        """下载单条轨道：同源退避重试（可续传）→ 换源从头来。

        两级策略，对应两类不同的故障：

        1. **同一个地址最多试 TRACK_RETRIES 次**，第 2 次起带 Range 从断点继续。
           网络抖动（连接被重置、读超时）属于瞬时故障，同源重试 + 续传能把已下
           部分保住，避免白下。
        2. 同源全部失败后才换下一个候选，**换源时丢弃已下载分片** —— 不同 CDN
           边缘缓存返回的可能是不同字节版本，跨源拼接有损坏风险，因此不做。

        候选链本身来自 B站会把部分变体调度到第三方 PCDN 节点的现实：
        *.mcdn.bilivideo.cn / *.edge.mountaintoys.cn 按 IP + 会话授权、实测会直接
        403，而官方 upos-* 镜像接受同一份签名路径（实测 6/6 可用）。
        """
        candidates = build_download_candidates(url, backups)
        last_error = ""
        for index, candidate in enumerate(candidates):
            if index:
                logger.warning(
                    f"[{task.id}] {label} 换源 {index + 1}/{len(candidates)} "
                    f"-> {host_of(candidate)}（上次失败: {last_error}）"
                )
                self._discard_partial(dest_path)
                task.downloaded_bytes = 0
                task.progress = base_progress
                self._notify_listeners("task_progress", task.dict())

            headers = download_headers(candidate, cookie=bilibili_cookie(task.sessdata))

            for attempt in range(self.TRACK_RETRIES):
                offset = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0

                # 分片已经完整（例如上次写完但 rename 失败）：不必再下
                if offset and task.total_bytes and offset >= task.total_bytes:
                    logger.info(
                        f"[{task.id}] {label} 分片已完整（{_fmt_size(offset)}），跳过下载"
                    )
                    return

                if attempt:
                    wait = self.RETRY_BACKOFF[min(attempt - 1, len(self.RETRY_BACKOFF) - 1)]
                    logger.warning(
                        f"[{task.id}] {label} 同源重试 {attempt + 1}/{self.TRACK_RETRIES} "
                        f"（{host_of(candidate)}，已下载 {_fmt_size(offset)}，"
                        f"{wait}s 后继续）: {last_error}"
                    )
                    await asyncio.sleep(wait)

                try:
                    await self._stream_to_file(
                        task, candidate, headers, dest_path, base_progress, span,
                        resume_offset=offset,
                    )
                    logger.info(
                        f"[{task.id}] {label} 完成 | {host_of(candidate)} | "
                        f"{_fmt_size(task.downloaded_bytes)} | 候选 {index + 1}/{len(candidates)}"
                        + (f" | 同源重试 {attempt} 次" if attempt else "")
                    )
                    return
                except _SourceRejected as exc:
                    # 源端明确拒绝（4xx/5xx）：同源重试没有意义，直接换源
                    last_error = str(exc)
                    break
                except (httpx.HTTPError, OSError) as exc:
                    # 网络类故障（连接重置 / 超时 / 读中断）：同源重试，可续传
                    last_error = f"{type(exc).__name__}: {exc}"
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
        resume_offset: int = 0,
    ) -> int:
        """把一条轨道流式写入 dest_path，返回本次写入的字节数。

        resume_offset > 0 时带 Range 请求续传。**必须判断服务端是否真的接受了
        Range**：若返回 200（整段内容）而我们仍以追加模式写入，分片会被拼坏 ——
        所以只在收到 206 时才追加，否则退回整段重写。实测 B站官方镜像支持
        Range（Accept-Ranges: bytes，Range 请求返回 206）。
        """
        request_headers = dict(headers)
        if resume_offset > 0:
            request_headers["Range"] = f"bytes={resume_offset}-"

        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(headers=request_headers, timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code == 416:
                    # 请求范围超出文件长度：分片已经到头了，视为完成
                    logger.info(f"[{task.id}] 服务端返回 416，分片已完整")
                    return 0
                if resp.status_code >= 400:
                    raise _SourceRejected(f"HTTP {resp.status_code}")

                appending = resume_offset > 0 and resp.status_code == 206
                if resume_offset > 0 and not appending:
                    logger.warning(
                        f"[{task.id}] 该源不支持断点续传（HTTP {resp.status_code}），"
                        f"丢弃已下载的 {_fmt_size(resume_offset)} 重新下载"
                    )

                content_length = int(resp.headers.get("content-length", 0) or 0)
                start = resume_offset if appending else 0
                total = (start + content_length) if content_length else 0
                if total:
                    task.total_bytes = total
                task.downloaded_bytes = start

                written = 0
                with open(dest_path, "ab" if appending else "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        if task.status in ("paused", "canceled"):
                            raise asyncio.CancelledError()
                        f.write(chunk)
                        written += len(chunk)
                        task.downloaded_bytes = start + written
                        if total > 0:
                            task.progress = min(
                                99, base_progress + int((task.downloaded_bytes / total) * span)
                            )
                            self._notify_listeners("task_progress", task.dict())
                return written

    async def _download_and_mux_ffmpeg(
        self,
        task: ServerTask,
        video_url: str,
        audio_url: str,
        video_backups: Optional[List[str]] = None,
        audio_backups: Optional[List[str]] = None,
    ):
        """下载音视频双轨并调用 FFmpeg 无损封装"""
        temp_v = self._temp_path(task, "v.m4s")
        temp_a = self._temp_path(task, "a.m4s")

        # 1. 下载视频轨
        task.progress = 10
        self._notify_listeners("task_progress", task.dict())
        await self._download_track(
            task, video_url, temp_v, label="视频轨",
            base_progress=10, span=45, backups=video_backups,
        )

        # 2. 下载音频轨
        task.progress = 60
        self._notify_listeners("task_progress", task.dict())
        await self._download_track(
            task, audio_url, temp_a, label="音频轨",
            base_progress=60, span=25, backups=audio_backups,
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
            # moov 前置：下载产物在任意播放器里可秒开；预览缓存靠它由 <video> 直接播
            "-movflags", "+faststart",
            task.save_path
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
        except FileNotFoundError as exc:
            # 桌面客户端启动时会把内嵌 ffmpeg 放进 PATH；裸跑服务端时可能没有
            raise RuntimeError(
                "未找到 ffmpeg（音视频混流依赖它，桌面客户端已内嵌；"
                "自行部署请安装 ffmpeg 并加入 PATH）"
            ) from exc
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
        """暂停任务。只对进行中的任务生效。

        此前不带状态判断：已完成（success）的任务被暂停后会变成 paused，
        此时再点「继续」会把整个文件重新下载一遍（实测复现）。取消态同理。
        """
        if task_id in self.tasks:
            task = self.tasks[task_id]
            if task.status not in ("waiting", "running"):
                return False
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
            # 只取消活动任务：对已完成/已取消的任务"再取消一次"会把终态改坏，
            # 也会往历史里塞重复条目（与 pause_task 同款防护）。
            if task.status not in ("waiting", "running", "paused"):
                return False
            task.status = "canceled"
            # 用户取消是唯一权威入口，历史在这里写：能覆盖"还在排队就被取消"
            # （此时没有任何协程在跑，CancelledError 分支根本不会执行）
            self._record_history(task)
            self._notify_listeners("task_canceled", task.dict())
            return True
        return False

    def clear_completed(self) -> int:
        to_del = [tid for tid, t in self.tasks.items() if t.status in ["success", "canceled", "error"]]
        for tid in to_del:
            task = self.tasks[tid]
            # 成功任务的临时分片已被 rename 掉；失败/取消的可能还留着，一并回收
            if task.status != "success":
                self._cleanup_temp_files(task)
            del self.tasks[tid]
        # 列表清空时同步清掉这些任务的历史：否则界面上刚"清空"，历史区里又冒出来，
        # 看起来像按钮没生效（历史与列表在界面上是同一块区域，必须同进同退）。
        if to_del:
            delete_history(to_del)
        return len(to_del)

    def clear_settled_tasks(self) -> int:
        """清空「已完成与历史」区在内存里的那一份：success / canceled。

        与 clear_completed 的两点区别（别合并回一个方法）：
        1. **不含 error**。失败任务要留在活跃区让用户重试或看失败原因，
           不该被"清空历史"顺手带走；clear_completed 是维护入口，会把失败一起清掉。
        2. **不碰 delete_history**。调用方（/api/history/clear）随后会整表清空历史，
           这里再按 id 删一遍是白跑一趟。

        必须连内存任务一起清：历史区的数据来源是「内存终态任务 + 持久化历史」两条，
        只清持久化历史的话，前端清完 taskQueue，下次 /api/server/tasks 同步又把旧任务
        灌回来，界面上历史区会"复活"，看起来像按钮没生效。
        """
        to_del = [tid for tid, t in self.tasks.items() if t.status in ("success", "canceled")]
        for tid in to_del:
            task = self.tasks[tid]
            # 成功的临时分片已 rename 掉；取消的可能还留着，一并回收
            if task.status == "canceled":
                self._cleanup_temp_files(task)
            del self.tasks[tid]
        return len(to_del)

    def _record_history(self, task: "ServerTask", size_bytes: int = 0) -> None:
        """把终态任务写进下载历史。失败不抛异常（历史丢一条远好过任务被判失败）"""
        try:
            if not size_bytes:
                size_bytes = task.downloaded_bytes or 0
                if task.status == "success" and task.save_path and os.path.exists(task.save_path):
                    size_bytes = os.path.getsize(task.save_path)
            record_history(
                task_id=task.id,
                title=task.title or task.filename,
                filename=task.filename,
                save_path=task.save_path or "",
                status=task.status,
                size_bytes=size_bytes,
                platform=task.platform or "",
                channel=task.channel,
                url=task.url or task.direct_url or "",
                created_at=task.created_at,
                duration=max(0.0, time.time() - (task.created_at or time.time())),
                error=task.error or "",
            )
        except Exception as e:
            logger.warning(f"[{task.id}] 写入下载历史失败: {e}")

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

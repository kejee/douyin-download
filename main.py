import os
import re
import io
import asyncio
import logging
import time
import zipfile
import urllib.parse
from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
from extractors.router import UnifiedMediaRouter
from extractors.douyin import DEFAULT_USER_AGENT
from downloader.http_util import referer_for_url

APP_VERSION = "2.6.0.0"

logger = logging.getLogger(__name__)

app = FastAPI(
    title="全网多平台短视频/图集解析与下载服务",
    description="轻量高效的抖音、TikTok、小红书、快手、皮皮虾、B站 (Bilibili)、Twitter/X 等无水印/高清视频、图集与博主主页全量解析工具",
    version=APP_VERSION,
)

# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = UnifiedMediaRouter()

class ParseRequest(BaseModel):
    url: str
    sessdata: Optional[str] = None

class UserPostsRequest(BaseModel):
    url: str
    cursor: int = 0
    count: int = 20
    sessdata: Optional[str] = None

# 挂载静态文件
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>多平台解析服务运行中，请检查前端静态资源文件。</h1>")

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "douyin-download", "version": APP_VERSION}

@app.post("/api/parse")
async def parse_media(req: ParseRequest):
    """解析抖音、小红书、快手、皮皮虾、B站、Twitter等多平台单作品分享链接"""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="请输入有效的分享链接或文案")
    
    result = await router.parse(req.url.strip(), sessdata=req.sessdata)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "解析失败")
    
    return result

@app.post("/api/user/posts")
async def get_user_posts(req: UserPostsRequest):
    """抓取博主主页元数据与分页作品列表"""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="请输入有效的博主主页链接")
    
    result = await router.parse_user_profile(req.url.strip(), cursor=req.cursor, count=req.count, sessdata=req.sessdata)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "获取博主主页作品失败")
    
    return result

@app.api_route("/api/download", methods=["GET", "HEAD"])
async def proxy_download(
    url: str = Query(..., description="目标媒体直链"),
    filename: str = Query("media", description="保存的文件名"),
):
    """多平台通用代理流式下载，突破跨域与各平台 CDN 防盗链"""
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url 参数")

    # 清理并编码文件名
    safe_filename = re.sub(r'[\\/:*?"<>|\r\n]', '_', filename).strip()
    if not safe_filename:
        safe_filename = "download"

    # 根据 CDN 域名自动适配 Referer（与桌面端本地保存共用同一套规则）
    referer = referer_for_url(url)

    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": referer,
    }

    proxy = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or None

    async def stream_generator():
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=60.0, proxy=proxy) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    yield b""
                    return
                async for chunk in response.aiter_bytes(chunk_size=1024 * 128):
                    yield chunk

    # 识别媒体类型
    media_type = "application/octet-stream"
    if safe_filename.endswith(".mp4"):
        media_type = "video/mp4"
    elif safe_filename.endswith((".jpg", ".jpeg")):
        media_type = "image/jpeg"
    elif safe_filename.endswith(".png"):
        media_type = "image/png"
    elif safe_filename.endswith(".webp"):
        media_type = "image/webp"
    elif safe_filename.endswith(".mp3"):
        media_type = "audio/mpeg"
    elif safe_filename.endswith(".m4a"):
        media_type = "audio/mp4"

    encoded_filename = urllib.parse.quote(safe_filename)
    content_disposition = f"attachment; filename*=UTF-8''{encoded_filename}"

    return StreamingResponse(
        stream_generator(),
        media_type=media_type,
        headers={
            "Content-Disposition": content_disposition,
            "Access-Control-Allow-Origin": "*",
        },
    )

@app.api_route("/api/stream/mux", methods=["GET", "HEAD"])
async def stream_mux_download(
    video_url: str = Query(..., description="视频轨直链"),
    audio_url: str = Query("", description="音频轨直链"),
    filename: str = Query("bilibili_video.mp4", description="合成后的文件名"),
    inline: bool = Query(False, description="是否用于网页内嵌预览播放"),
):
    """B站等多音视频轨 DASH 实时内存管道混流下载与在线预览 (基于 FFmpeg 零磁盘流式封装)"""
    if not video_url:
        raise HTTPException(status_code=400, detail="缺少 video_url 参数")

    # 若无音频轨，直接走普通代理下载
    if not audio_url:
        return await proxy_download(url=video_url, filename=filename)

    safe_filename = re.sub(r'[\\/:*?"<>|\r\n]', '_', filename).strip() or "video.mp4"
    if not safe_filename.endswith(".mp4"):
        safe_filename += ".mp4"

    referer = "https://www.bilibili.com/"
    bili_ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )

    # 构造 ffmpeg 管道命令: 开启 HTTP 智能重连，显式合并视频与音频轨并转为标准 aac 格式
    header_str = f"Referer: {referer}\r\nUser-Agent: {bili_ua}\r\n"
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-headers", header_str,
        "-i", video_url,
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-headers", header_str,
        "-i", audio_url,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1"
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
    except Exception as e:
        # 如果系统中未安装 ffmpeg，兜底回退为仅下载视频轨
        return await proxy_download(url=video_url, filename=filename)

    async def ffmpeg_stream_generator():
        try:
            while True:
                chunk = await process.stdout.read(1024 * 128)
                if not chunk:
                    break
                yield chunk
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            await process.wait()

    encoded_filename = urllib.parse.quote(safe_filename)
    disposition_type = "inline" if inline else "attachment"
    content_disposition = f"{disposition_type}; filename*=UTF-8''{encoded_filename}"

    return StreamingResponse(
        ffmpeg_stream_generator(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": content_disposition,
            "Access-Control-Allow-Origin": "*",
            # 这里**故意不声明** Accept-Ranges：本接口是实时 ffmpeg 管道流，没有
            # Content-Length、也不实现 Range 请求。早期版本错写成 "bytes"，等于
            # 告诉播放器「你可以寻址」，而 Safari/AVFoundation 会据此发起 Range
            # 探测、拿不到 206 就判定资源不可播放（实测无论声明与否都播不了，
            # 声明只会让排查更绕）。网页内预览请改用 /api/preview/*（落盘后提供）。
        },
    )

# ==========================================================================
# 服务端 / NAS 自动归档与任务管理接口
# ==========================================================================
from downloader import server_downloader, preview
from downloader.server_downloader import DuplicateTaskError
from downloader.paths import is_desktop_mode
from downloader.history import clear_history, delete_history, load_history

class ServerDownloadItem(BaseModel):
    url: Optional[str] = None
    direct_url: Optional[str] = None
    audio_url: Optional[str] = None
    title: str = "视频"
    season_title: Optional[str] = None
    platform: str = "media"
    page_num: Optional[int] = None
    sessdata: Optional[str] = None
    filename: Optional[str] = None
    subdir: Optional[str] = None
    task_id: Optional[str] = None
    direct_backup_urls: Optional[List[str]] = None
    audio_backup_urls: Optional[List[str]] = None

class ServerBatchDownloadRequest(BaseModel):
    tasks: List[ServerDownloadItem]

# 批次序号：同一毫秒内连续两次提交也要拿到不同 batch_id，
# 否则两次批量会被历史记录当成同一批折叠起来。
_batch_seq = 0


def _batch_meta(items: List[ServerDownloadItem]) -> tuple:
    """给一次批量提交分配 (batch_id, batch_title)。

    单条提交**不带批次**（历史里就是一条独立记录，不参与折叠）。
    多条提交共享同一个 batch_id：历史记录里折叠成一行，
    淘汰时也只占一个"组"名额 —— 否则一次 500 集的合集就会把历史上限打满。

    batch_title 优先用合集名（season_title），仅当一批里唯一且非空时才用，
    否则退化为「批量下载 N 个」。
    """
    global _batch_seq
    if len(items) <= 1:
        return "", ""
    title = ""
    seasons = {(it.season_title or "").strip() for it in items}
    if len(seasons) == 1:
        title = next(iter(seasons))
    if not title:
        title = f"批量下载 {len(items)} 个"
    _batch_seq += 1
    return f"b_{int(time.time() * 1000)}_{_batch_seq}", title


@app.get("/api/server/config")
async def get_server_config():
    """获取服务端/NAS 存储配置"""
    return server_downloader.get_config()

class ServerDirRequest(BaseModel):
    download_dir: str

@app.post("/api/server/config")
async def set_server_config(req: ServerDirRequest):
    """设置 NAS/服务端归档目录（持久化，立即对**后续**任务生效）

    存在的意义：NAS 用户换个存储位置原本要改 compose 再重建容器，
    而容器一重建就丢正在排队的任务。改成界面上可改后，换目录不动容器。

    注意只影响后续任务 —— 在途任务的目标路径在入队时就算好了，改不了。
    失败时把具体原因回给前端（不存在 / 不可写 / 非绝对路径），
    因为这些报错用户在容器里看不到。
    """
    ok, message, persistent = server_downloader.set_server_dir(req.download_dir)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    config = server_downloader.get_config()
    return {
        "success": True,
        "persistent": persistent,
        "warning": "" if persistent else "该路径不在挂载卷上，容器重建后已下载的文件会丢失",
        **config,
    }

@app.post("/api/server/download")
async def create_server_downloads(req: ServerBatchDownloadRequest):
    """提交一个或多个下载任务到服务端/NAS 自动归档"""
    created_tasks = []
    skipped: List[dict] = []
    batch_id, batch_title = _batch_meta(req.tasks)
    for item in req.tasks:
        try:
            task = server_downloader.add_task(
                url=item.url,
                direct_url=item.direct_url,
                audio_url=item.audio_url,
                title=item.title,
                season_title=item.season_title,
                platform=item.platform,
                page_num=item.page_num,
                sessdata=item.sessdata,
                channel="server",
                filename=item.filename,
                subdir=item.subdir,
                task_id=item.task_id,
                direct_backup_urls=item.direct_backup_urls,
                audio_backup_urls=item.audio_backup_urls,
                batch_id=batch_id,
                batch_title=batch_title,
            )
            created_tasks.append(task)
        except DuplicateTaskError as exc:
            # 同一目标路径已有活动任务：跳过而不是让它俩并发写同一个文件
            skipped.append({
                "title": item.title,
                "filename": item.filename,
                "reason": str(exc),
                "existing_id": exc.existing.id,
            })
    return {
        "success": True,
        "count": len(created_tasks),
        "skipped_count": len(skipped),
        "skipped": skipped,
        "tasks": created_tasks,
    }

@app.get("/api/server/tasks")
async def list_server_tasks():
    """获取当前服务端任务队列"""
    return {"tasks": list(server_downloader.tasks.values())}

@app.post("/api/server/tasks/{task_id}/pause")
async def pause_server_task(task_id: str):
    ok = server_downloader.pause_task(task_id)
    return {"success": ok}

@app.post("/api/server/tasks/{task_id}/resume")
async def resume_server_task(task_id: str):
    ok = server_downloader.resume_task(task_id)
    return {"success": ok}

@app.post("/api/server/tasks/{task_id}/cancel")
async def cancel_server_task(task_id: str):
    ok = server_downloader.cancel_task(task_id)
    return {"success": ok}

@app.post("/api/server/tasks/clear")
async def clear_server_tasks():
    count = server_downloader.clear_completed()
    return {"success": True, "cleared_count": count}

class HistoryDeleteRequest(BaseModel):
    ids: List[str] = []

@app.get("/api/history")
async def get_download_history():
    """下载历史（最近的在前）。

    任务进入终态时由 ServerDownloadManager 落一条，重启客户端后依然可查 ——
    这是"任务列表重启即清空"的补偿数据源。
    """
    entries = load_history()
    return {"count": len(entries), "entries": entries}

@app.post("/api/history/clear")
async def clear_download_history():
    """清空下载历史（只删记录，不动已下载的文件）

    历史区的数据来源是两条：内存里的 success/canceled 任务 + 持久化的 history.json。
    只清后者的话，前端清完 taskQueue，下次 /api/server/tasks 同步又把旧任务灌回来，
    界面上会残留「本次会话刚完成任务」，看起来像按钮没生效。所以这里两条一起清。
    """
    tasks_cleared = server_downloader.clear_settled_tasks()
    count = clear_history()
    return {"success": True, "cleared": count, "tasks_cleared": tasks_cleared}

@app.post("/api/history/delete")
async def delete_download_history(req: HistoryDeleteRequest):
    """按 id 删除历史记录。

    用于「移除单条历史」：界面上历史与任务列表是同一块区域，
    列表里清掉的条目必须在历史里一起消失，否则会被当成"按钮没生效"。
    """
    count = delete_history(req.ids)
    return {"success": True, "deleted": count}

class ConcurrencyRequest(BaseModel):
    max_concurrent: int

@app.post("/api/server/concurrency")
async def set_concurrency(req: ConcurrencyRequest):
    """调整同时下载数（1~8，立即生效并持久化）"""
    value = await server_downloader.set_max_concurrent(req.max_concurrent)
    return {"success": True, "max_concurrent": value}

# ==========================================================================
# 桌面客户端：原生保存（选择目录 + Python 直接落盘，不经过 WebView 下载）
# ==========================================================================

class LocalDirRequest(BaseModel):
    download_dir: str

@app.get("/api/local/config")
async def get_local_config():
    """获取桌面端本地保存目录与可用空间"""
    cfg = server_downloader.get_config()
    return {
        "download_dir": cfg["local_dir"],
        "is_desktop": cfg["is_desktop"],
        "free_space_gb": cfg["free_space_gb"],
    }

@app.post("/api/local/config")
async def set_local_config(req: LocalDirRequest):
    """设置桌面端本地保存目录（持久化，重启后仍然生效）"""
    if not server_downloader.set_local_dir(req.download_dir):
        raise HTTPException(status_code=400, detail="目录不存在或不可写")
    return {"success": True, "download_dir": server_downloader.local_dir}

class LocalCheckRequest(BaseModel):
    filename: str
    subdir: Optional[str] = None

@app.post("/api/local/check")
async def check_local_file(req: LocalCheckRequest):
    """下载前检查目标文件是否已存在

    桌面端用它决定是否弹出「覆盖重下 / 保留两者」的选择。只读。
    """
    return server_downloader.check_local_file(req.filename, req.subdir or "")

@app.get("/api/local/files")
async def list_local_files(subdir: str = ""):
    """列出桌面端保存目录下的文件名

    供前端批量下载前跳过「本地已存在」的集数，避免重复拉取。只读。
    """
    return server_downloader.list_local_files(subdir)

class RevealRequest(BaseModel):
    path: str

@app.post("/api/local/reveal")
async def reveal_local_file(req: RevealRequest):
    """在系统文件管理器中定位已下载的文件（桌面端）

    需要真正操作桌面的能力，因此只在桌面客户端模式下开放；NAS/服务端模式下
    文件在远端，定位无意义。路径范围由 reveal_file 校验（仅限下载根目录内）。
    """
    if not is_desktop_mode():
        raise HTTPException(status_code=400, detail="仅桌面客户端支持定位文件")
    if not server_downloader.reveal_file(req.path):
        raise HTTPException(status_code=404, detail="文件不存在或不在下载目录内")
    return {"success": True}

# ==========================================================================
# 视频预览：先落盘缓存再以文件（真 Range）提供
#
# 背景：桌面客户端是 WKWebView，<video> 走 AVFoundation，它只接受可寻址资源。
# 原来的 /api/stream/mux 实时管道流（chunked、无 Content-Length、不实现 Range）
# 被 AVFoundation 直接判为不可播放（实测 isPlayable=ERR(Operation Stopped)），
# 表现就是预览区黑屏。改成「下载混流为本地文件 -> FileResponse」后实测可播且可拖动。
# ==========================================================================

class PreviewPrepareRequest(BaseModel):
    video_url: str
    audio_url: Optional[str] = None
    title: Optional[str] = None

def _preview_task_id(key: str) -> str:
    return f"preview_{key}"

@app.post("/api/preview/prepare")
async def prepare_preview(req: PreviewPrepareRequest):
    """准备预览文件：命中缓存直接返回，否则后台混流并回传进度"""
    if not req.video_url:
        raise HTTPException(status_code=400, detail="缺少 video_url 参数")

    key = preview.cache_key(req.video_url, req.audio_url or "")
    if preview.is_ready(key):
        return {"success": True, "key": key, "ready": True, "progress": 100}

    task_id = _preview_task_id(key)
    existing = server_downloader.tasks.get(task_id)
    if existing and existing.status in ("waiting", "running"):
        return {"success": True, "key": key, "ready": False, "progress": existing.progress}

    preview.evict_old(keep_key=key)
    try:
        task = server_downloader.add_task(
            direct_url=req.video_url,
            audio_url=req.audio_url or None,
            title=req.title or "预览",
            channel="preview",
            filename=f"{key}.mp4",
            task_id=task_id,
        )
    except DuplicateTaskError:
        return {"success": True, "key": key, "ready": False, "progress": 0}
    return {"success": True, "key": key, "ready": False, "progress": task.progress}

@app.get("/api/preview/{key}/status")
async def preview_status(key: str):
    """查询预览准备进度；文件已就绪时以文件为准（任务可能已被清理）"""
    if preview.is_ready(key):
        return {"success": True, "ready": True, "progress": 100}
    task = server_downloader.tasks.get(_preview_task_id(key))
    if not task:
        return {"success": True, "ready": False, "progress": 0, "status": "unknown"}
    return {
        "success": True,
        "ready": task.status == "success",
        "progress": task.progress,
        "status": task.status,
        "error": task.error,
        # 让界面能显示「已缓存 xx / 共 yy」——预览是完整落盘后才播放的，
        # 透明地把这件事告诉用户，避免误以为是逐秒缓冲。
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": task.total_bytes,
    }

@app.get("/api/preview/cache")
async def preview_cache_info():
    """预览缓存占用情况"""
    return preview.cache_stats()

@app.post("/api/preview/cache/clear")
async def preview_cache_clear():
    """清空预览缓存（纯派生数据，随时可由直链重新生成）"""
    result = preview.clear_cache()
    logger.info(
        f"清理预览缓存 | 删除 {result['removed']} 个文件 | "
        f"释放 {result['freed_bytes'] / 1024 / 1024:.1f}MB"
    )
    return {"success": True, **result}

@app.get("/api/preview/{key}/stream")
async def preview_stream(key: str):
    """以文件方式提供预览（FileResponse 自带 Range/206，可拖动进度条）"""
    path = preview.cache_path(key)
    if not preview.is_ready(key):
        raise HTTPException(status_code=404, detail="预览尚未准备好")
    return FileResponse(path, media_type="video/mp4")

@app.post("/api/local/download")
async def create_local_downloads(req: ServerBatchDownloadRequest):
    """提交下载任务到桌面端本地目录归档"""
    created_tasks = []
    skipped: List[dict] = []
    batch_id, batch_title = _batch_meta(req.tasks)
    for item in req.tasks:
        try:
            task = server_downloader.add_task(
                url=item.url,
                direct_url=item.direct_url,
                audio_url=item.audio_url,
                title=item.title,
                season_title=item.season_title,
                platform=item.platform,
                page_num=item.page_num,
                sessdata=item.sessdata,
                channel="local",
                filename=item.filename,
                subdir=item.subdir,
                task_id=item.task_id,
                direct_backup_urls=item.direct_backup_urls,
                audio_backup_urls=item.audio_backup_urls,
                batch_id=batch_id,
                batch_title=batch_title,
            )
            created_tasks.append(task)
        except DuplicateTaskError as exc:
            # 同一目标路径上已有活动任务（waiting/running/paused）：跳过。
            # 否则两个任务会写同一个临时文件，导致内容交错甚至文件丢失。
            skipped.append({
                "title": item.title,
                "filename": item.filename,
                "reason": str(exc),
                "existing_id": exc.existing.id,
            })
    return {
        "success": True,
        "count": len(created_tasks),
        "skipped_count": len(skipped),
        "skipped": skipped,
        "tasks": created_tasks,
    }

@app.get("/api/tasks/events")
async def task_events():
    """全量任务事件流（服务端归档与桌面端本地保存共用）"""
    return await server_events()

@app.get("/api/server/events")
async def server_events():
    """SSE 实时推送服务端下载与归档进度"""
    queue = server_downloader.subscribe()

    async def event_generator():
        import json
        try:
            while True:
                msg = await queue.get()
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            server_downloader.unsubscribe(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

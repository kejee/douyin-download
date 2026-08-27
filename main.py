import os
import re
import io
import asyncio
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

APP_VERSION = "2.1.0.0"

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

class UserPostsRequest(BaseModel):
    url: str
    cursor: int = 0
    count: int = 20

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
    
    result = await router.parse(req.url.strip())
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "解析失败")
    
    return result

@app.post("/api/user/posts")
async def get_user_posts(req: UserPostsRequest):
    """抓取博主主页元数据与分页作品列表"""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="请输入有效的博主主页链接")
    
    result = await router.parse_user_profile(req.url.strip(), cursor=req.cursor, count=req.count)
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

    # 根据 CDN 域名自动适配 Referer
    referer = "https://www.douyin.com/"
    if "xhscdn.com" in url or "xiaohongshu.com" in url:
        referer = "https://www.xiaohongshu.com/"
    elif "kuaishou.com" in url or "gifshow.com" in url or "yximgs.com" in url:
        referer = "https://www.kuaishou.com/"
    elif "pipix.com" in url or "snssdk.com" in url:
        referer = "https://h5.pipix.com/"
    elif "bilibili.com" in url or "bilivideo.cn" in url or "bilivideo.com" in url or "hdslb.com" in url:
        referer = "https://www.bilibili.com/"
    elif "twimg.com" in url or "twitter.com" in url or "x.com" in url:
        referer = "https://twitter.com/"

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
            "Accept-Ranges": "bytes",
        },
    )

class BatchZipItem(BaseModel):
    url: str
    filename: str

class BatchZipRequest(BaseModel):
    zip_name: str = "batch_media"
    items: List[BatchZipItem]

@app.post("/api/batch/zip")
async def batch_zip_download(req: BatchZipRequest):
    """批量流式打包下载选中的视频/图片为 ZIP"""
    if not req.items:
        raise HTTPException(status_code=400, detail="未选中任何下载文件")

    # 限制单次打包最多 50 个文件，防止内存过载
    items = req.items[:50]
    safe_zip_name = re.sub(r'[\\/:*?"<>|\r\n]', '_', req.zip_name).strip() or "batch_media"
    if not safe_zip_name.endswith(".zip"):
        safe_zip_name += ".zip"

    proxy = os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY") or None

    async def zip_stream_generator():
        import io
        import zipfile
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            async with httpx.AsyncClient(follow_redirects=True, timeout=60.0, proxy=proxy) as client:
                for idx, it in enumerate(items):
                    try:
                        headers = {"User-Agent": DEFAULT_USER_AGENT}
                        if "douyin.com" in it.url or "iesdouyin.com" in it.url:
                            headers["Referer"] = "https://www.douyin.com/"
                        elif "xhscdn.com" in it.url:
                            headers["Referer"] = "https://www.xiaohongshu.com/"
                        elif "twimg.com" in it.url:
                            headers["Referer"] = "https://twitter.com/"
                        
                        r = await client.get(it.url, headers=headers)
                        if r.status_code == 200:
                            f_name = re.sub(r'[\\/:*?"<>|\r\n]', '_', it.filename).strip() or f"media_{idx+1}.mp4"
                            zf.writestr(f_name, r.content)
                    except Exception:
                        continue
        zip_buffer.seek(0)
        yield zip_buffer.getvalue()

    encoded_zip_name = urllib.parse.quote(safe_zip_name)
    return StreamingResponse(
        zip_stream_generator(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_zip_name}",
            "Access-Control-Allow-Origin": "*",
        },
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

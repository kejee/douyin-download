import os
import re
import urllib.parse
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
from extractors.router import UnifiedMediaRouter
from extractors.douyin import DEFAULT_USER_AGENT

APP_VERSION = "2.0.0.0"

app = FastAPI(
    title="全网多平台短视频/图集解析与下载服务",
    description="轻量高效的抖音、TikTok、小红书、快手、皮皮虾等无水印高清视频与图集解析工具",
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
    """解析抖音、小红书、快手、皮皮虾等多平台分享链接或文案"""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="请输入有效的分享链接或文案")
    
    result = await router.parse(req.url.strip())
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "解析失败")
    
    return result

@app.get("/api/download")
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

    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": referer,
    }

    async def stream_generator():
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=60.0) as client:
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

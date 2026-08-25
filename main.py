import os
import re
import urllib.parse
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
from douyin import DouyinParser, DEFAULT_USER_AGENT

APP_VERSION = "1.0.0.1002"

app = FastAPI(
    title="抖音短视频/图集解析下载服务",
    description="轻量高效的抖音短视频、无水印/带水印视频、高清图集及音频解析与下载工具",
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

parser = DouyinParser()

class ParseRequest(BaseModel):
    url: str

# 挂载静态文件
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

css_dir = os.path.join(static_dir, "css")
if os.path.exists(css_dir):
    app.mount("/css", StaticFiles(directory=css_dir), name="css")

js_dir = os.path.join(static_dir, "js")
if os.path.exists(js_dir):
    app.mount("/js", StaticFiles(directory=js_dir), name="js")

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>抖音解析服务运行中，请检查前端静态资源文件。</h1>")

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "douyin-download", "version": APP_VERSION}

@app.post("/api/parse")
async def parse_video(req: ParseRequest):
    """解析抖音分享链接或包含链接的文案"""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="请输入有效的抖音分享链接或文案")
    
    result = await parser.parse(req.url.strip())
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "解析失败"))
    
    return result

@app.get("/api/download")
async def proxy_download(
    url: str = Query(..., description="目标媒体直链"),
    filename: str = Query("media", description="保存的文件名"),
):
    """代理流式下载媒体文件，突破跨域与防盗链限制"""
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url 参数")

    # 清理并编码文件名
    safe_filename = re.sub(r'[\\/:*?"<>|\r\n]', '_', filename).strip()
    if not safe_filename:
        safe_filename = "download"

    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://www.douyin.com/",
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
    uvicorn.run("main.py:app", host="0.0.0.0", port=8000, reload=True)

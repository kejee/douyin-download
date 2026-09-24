"""视频预览缓存：把音视频双轨混流成一个**本地文件**，再由服务端以文件方式对外提供。

## 为什么必须落盘，而不是边下边播

桌面客户端用的是 WKWebView，其 `<video>` 底层是 AVFoundation。用 macOS 自带的
AVFoundation 直接探测（与实际 WebView 行为一致，实验见下）结果是：

    ffmpeg 实时管道流（chunked、无 Content-Length、不实现 Range）
        -> isPlayable=ERR(Operation Stopped)        # 黑屏 + 划掉的播放图标
    同一份码流写成文件、用 FileResponse 提供（真 206 / Content-Range）
        -> isPlayable=true, duration=721s, 1 视频轨 + 1 音频轨

对照实验还排除了一个直觉上的嫌疑：把接口里那句毫无依据的
`Accept-Ranges: bytes`（接口从不实现 Range）删掉后**依然不可播放**，
所以问题不在响应头说谎，而在「流不可寻址」本身。

Chrome 的解复用器宽容得多，同样的管道流能播 —— 这就是「浏览器里看着好好的、
客户端里必黑屏」的原因。因此预览必须先落盘缓存再提供，顺带换来：
可拖进度条、可重播、再次打开秒开、不再每按一次播放就重新拉一遍整段视频。

## 缓存策略

- 键取自两条直链的 **path**（B站签名参数每次解析都会变，用整个 URL 当键会次次未命中；
  path 里含 cid 与清晰度，足够区分）；
- 单文件落盘，LRU 清理（按 mtime），有数量与总体积双重上限；
- 混流时加 `+faststart`（moov 前置），首帧启动更快。
"""
import hashlib
import os
import urllib.parse

from .paths import app_config_dir, ensure_dir

# 预览缓存：体积上限 3GB / 最多 12 个文件（够覆盖最近几次浏览）
MAX_FILES = 12
MAX_TOTAL_BYTES = 3 * 1024 ** 3


def preview_dir() -> str:
    """预览缓存目录（惰性创建，不依赖 cwd）"""
    path = os.path.join(app_config_dir(), "preview_cache")
    ensure_dir(path)
    return path


def cache_key(video_url: str, audio_url: str = "") -> str:
    """由直链路径算缓存键（忽略会过期的签名参数）"""

    def _stable(u: str) -> str:
        try:
            parsed = urllib.parse.urlparse(u or "")
            return f"{parsed.netloc}{parsed.path}"
        except ValueError:
            return u or ""

    raw = f"{_stable(video_url)}|{_stable(audio_url)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def cache_path(key: str) -> str:
    safe = "".join(c for c in (key or "") if c.isalnum() or c in "-_")
    return os.path.join(preview_dir(), f"{safe or 'unknown'}.mp4")


def is_ready(key: str) -> bool:
    path = cache_path(key)
    try:
        return os.path.isfile(path) and os.path.getsize(path) > 0
    except OSError:
        return False


def evict_old(keep_key: str = "") -> int:
    """按 mtime 清理旧预览，返回删除数量。

    只删本目录下的 `.mp4`，且跳过正在使用/正在写的 keep_key。
    """
    directory = preview_dir()
    entries = []
    try:
        names = os.listdir(directory)
    except OSError:
        return 0

    total = 0
    for name in names:
        if not name.endswith(".mp4"):
            continue
        full = os.path.join(directory, name)
        try:
            stat = os.stat(full)
        except OSError:
            continue
        entries.append((stat.st_mtime, stat.st_size, full))
        total += stat.st_size

    if len(entries) <= MAX_FILES and total <= MAX_TOTAL_BYTES:
        return 0

    entries.sort()  # 最旧在前
    removed = 0
    while entries and (len(entries) > MAX_FILES or total > MAX_TOTAL_BYTES):
        _, size, full = entries.pop(0)
        if keep_key and os.path.basename(full) == f"{keep_key}.mp4":
            continue
        try:
            os.remove(full)
            total -= size
            removed += 1
        except OSError:
            pass
    return removed

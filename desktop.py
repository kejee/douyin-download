"""
Universal Downloader - 跨平台桌面客户端启动器 (PyWebView)
支持 Windows (WebView2)、macOS (WKWebView)、Linux (WebKit2GTK)

设计约束（均为线上事故后固化）：
1. 绝不依赖进程 cwd —— Finder / Dock 双击启动时 cwd 为 `/`，任何 os.getcwd()
   相对路径都会落到只读根目录；
2. 导入期不做任何磁盘写入，目录创建一律惰性且容错；
3. 未捕获异常（含后台线程）一律落盘到日志文件，避免窗口化模式下"闪退无提示"；
4. 内嵌 ffmpeg 并置于 PATH 首位，保证 B站 DASH 音视频混流开箱可用。
"""
import logging
import logging.handlers
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback

# 必须在导入 main 之前设置：main -> downloader 会在导入期解析下载根目录
os.environ.setdefault("APP_MODE", "desktop")

import uvicorn
import webview

from downloader.paths import app_config_dir, default_download_dir, ensure_dir
from main import APP_VERSION, app

APP_NAME = "Universal Downloader"
APP_TITLE = f"{APP_NAME} · 全网多平台视频与图集下载器 v{APP_VERSION}"

log = logging.getLogger("universal.downloader")


# ---------------------------------------------------------------------------
# 日志：窗口化模式下没有 stderr，必须落盘
# ---------------------------------------------------------------------------
def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    try:
        log_dir = os.path.join(app_config_dir(), "logs")
        os.makedirs(log_dir, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            os.path.join(log_dir, "desktop.log"),
            maxBytes=1_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError:
        pass

    # 仅终端调试时挂 StreamHandler；窗口化模式下 stderr 可能为 None
    if sys.stderr is not None:
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setFormatter(formatter)
        root.addHandler(stream_handler)


def install_excepthooks() -> None:
    def _report(prefix: str, exc_type, exc_value, exc_tb) -> None:
        detail = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        logging.getLogger("universal.downloader").critical(f"{prefix}\n{detail}")

    def main_hook(exc_type, exc_value, exc_tb):
        _report("主线程未捕获异常", exc_type, exc_value, exc_tb)

    def thread_hook(args):
        _report(
            f"后台线程 {getattr(args.thread, 'name', '?')} 未捕获异常",
            args.exc_type,
            args.exc_value,
            args.exc_traceback,
        )

    sys.excepthook = main_hook
    threading.excepthook = thread_hook


# ---------------------------------------------------------------------------
# 内嵌 ffmpeg
# ---------------------------------------------------------------------------
def register_bundled_ffmpeg() -> str:
    """把随包内嵌的 ffmpeg 目录置于 PATH 首位，返回可执行文件路径"""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    for folder in ("ffmpeg_bin", "ffmpeg", "bin"):
        candidate_dir = os.path.join(base, folder)
        for name in ("ffmpeg", "ffmpeg.exe"):
            exe = os.path.join(candidate_dir, name)
            if not os.path.isfile(exe):
                continue
            # 仅在确实缺少可执行位时才 chmod：打包时已带 +x，
            # 多余的系统调用在只读安装位置（如 /Applications）会失败或被安全软件拦截
            if not os.access(exe, os.X_OK):
                try:
                    os.chmod(exe, 0o755)
                except OSError as exc:
                    log.warning(f"无法为内嵌 ffmpeg 补可执行权限（{exe}）: {exc}")
            os.environ["PATH"] = candidate_dir + os.pathsep + os.environ.get("PATH", "")
            return exe

    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        log.info(f"未找到内嵌 ffmpeg，回退使用系统版本: {system_ffmpeg}")
    else:
        log.warning("未找到 ffmpeg，B站 DASH 音视频混流将不可用")
    return system_ffmpeg or ""


# 固定端口：WebView 的 localStorage / Cookie 按"源"(scheme://host:port) 隔离，
# 端口每次随机会导致源变化 —— 已保存的 B站 SESSDATA 等设置每次重启都会"丢失"。
PREFERRED_PORT = 18760
PORT_SCAN_RANGE = 10


def find_free_port() -> int:
    """获取本地随机空闲端口（固定端口全部被占用时的兜底）"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def probe_running_instance(port: int) -> bool:
    """探测该端口上是否已有"同版本"的本应用实例在运行"""
    import json
    import urllib.request

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.5) as resp:
            info = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return False
    return info.get("service") == "douyin-download" and info.get("version") == APP_VERSION


def acquire_port() -> tuple:
    """确定后端端口，返回 (port, reuse_existing)。

    优先使用固定端口区间，保证 WebView 同源，设置才能真正跨重启持久化：
    - 端口上已有**同版本实例** -> 直接复用其后端（等价单实例，不重复起服务）；
    - 端口被其他程序占用     -> 顺延试下一个；
    - 全区间都不可用         -> 回退随机端口（本次设置不持久化，日志里会警告）。
    """
    for offset in range(PORT_SCAN_RANGE):
        port = PREFERRED_PORT + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                if probe_running_instance(port):
                    return port, True
                continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as binder:
            binder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                binder.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port, False

    log.warning("固定端口区间均不可用，回退随机端口：本次会话的设置不会持久化")
    return find_free_port(), False


def wait_for_server(port: int, timeout_seconds: float = 20.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    return True
        except OSError:
            pass
        time.sleep(0.1)
    return False


# ---------------------------------------------------------------------------
# 暴露给前端 JS 的原生能力（window.pywebview.api.*）
# ---------------------------------------------------------------------------
class DesktopAPI:
    """提供给前端 JS 调用的桌面端原生 API"""

    def choose_folder(self, initial_dir: str = "") -> str:
        """弹出系统原生文件夹选择对话框"""
        window = webview.active_window()
        if not window:
            return ""
        # pywebview 5+ 推荐 FileDialog 枚举；FOLDER_DIALOG 已废弃，保留回退
        file_dialog = getattr(webview, "FileDialog", None)
        dialog_type = file_dialog.FOLDER if file_dialog else webview.FOLDER_DIALOG
        target = initial_dir if initial_dir and os.path.isdir(initial_dir) else ""
        result = window.create_file_dialog(dialog_type, directory=target)
        if result and len(result) > 0:
            return result[0]
        return ""

    def open_path(self, path: str = "") -> bool:
        """在系统文件管理器中打开目录"""
        target = path if path and os.path.isdir(path) else default_download_dir()
        if not ensure_dir(target):
            return False
        try:
            if sys.platform == "win32":
                os.startfile(target)  # noqa: S606
            elif sys.platform == "darwin":
                subprocess.Popen(["open", target])
            else:
                subprocess.Popen(["xdg-open", target])
            return True
        except OSError as exc:
            log.warning(f"打开目录失败 {target}: {exc}")
            return False

    def get_app_version(self) -> str:
        return APP_VERSION

    def read_clipboard(self) -> str:
        """读取系统剪贴板中的文本（供界面上的「粘贴」按钮调用）

        WKWebView 里 `navigator.clipboard.readText()` 会被 WebKit 直接拒绝，
        且系统设置中没有可授权的开关 —— 只能由原生侧代读。
        """
        try:
            from AppKit import NSPasteboard, NSPasteboardTypeString
        except ImportError:
            return ""
        try:
            pasteboard = NSPasteboard.generalPasteboard()
            return pasteboard.stringForType_(NSPasteboardTypeString) or ""
        except Exception as exc:
            log.warning(f"读取剪贴板失败: {exc}")
            return ""

    def get_download_dir(self) -> str:
        return default_download_dir()


def start_server(port: int) -> None:
    """在后台线程中启动 FastAPI 后端服务"""
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    except Exception:
        log.exception("后端服务异常退出")


ERROR_PAGE = """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>启动失败</title></head><body style="font-family:-apple-system,sans-serif;
background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0"><div style="max-width:560px;padding:32px">
<h2 style="margin:0 0 12px">本地服务启动失败</h2>
<p style="color:#8b949e;line-height:1.7">后端进程未能在超时时间内就绪，请查看日志文件后重试：</p>
<pre style="background:#161b22;padding:12px;border-radius:8px;overflow:auto;
font-size:12px;color:#79c0ff">{log_path}</pre></div></body></html>"""


def main() -> None:
    setup_logging()
    install_excepthooks()

    log.info("=" * 60)
    log.info(f"{APP_NAME} v{APP_VERSION} 启动 | frozen={getattr(sys, 'frozen', False)}")
    log.info(f"配置目录: {app_config_dir()}")
    log.info(f"下载目录: {default_download_dir()}")
    log.info(f"内嵌 ffmpeg: {register_bundled_ffmpeg() or '不可用'}")

    # 预检：创建失败不阻断启动，真正落盘时再报错
    ensure_dir(default_download_dir())

    port, reuse_existing = acquire_port()
    api = DesktopAPI()

    if reuse_existing:
        log.info(f"检测到同版本实例已在运行，复用其后端: http://127.0.0.1:{port}")
    else:
        threading.Thread(
            target=start_server, args=(port,), daemon=True, name="uvicorn"
        ).start()

        if not wait_for_server(port):
            log.error(f"后端服务未能在 127.0.0.1:{port} 就绪")
            webview.create_window(
                title=f"{APP_TITLE} · 启动失败",
                html=ERROR_PAGE.format(
                    log_path=os.path.join(app_config_dir(), "logs", "desktop.log")
                ),
                width=720,
                height=460,
            )
            webview.start(debug=False)
            return

        log.info(f"后端就绪: http://127.0.0.1:{port}")

    # 允许 <a download> 触发原生下载（macOS 默认关闭）；主下载链路由后端原生落盘承担
    webview.settings["ALLOW_DOWNLOADS"] = True

    webview.create_window(
        title=APP_TITLE,
        url=f"http://127.0.0.1:{port}",
        width=1220,
        height=840,
        min_size=(900, 600),
        js_api=api,
        text_select=True,
        zoomable=True,
    )

    # private_mode=False：否则 localStorage / Cookie 不落盘，B站 SESSDATA 每次重启都会丢
    webview.start(
        debug=False,
        private_mode=False,
        storage_path=app_config_dir(),
    )


if __name__ == "__main__":
    main()

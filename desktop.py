"""
Universal Downloader - 跨平台桌面客户端启动器 (PyWebView)
支持 Windows (WebView2)、macOS (WKWebView)、Linux (WebKit2GTK)
"""
import os
import sys
import socket
import threading
import time
import subprocess
import uvicorn
import webview
from main import app, APP_VERSION

def find_free_port() -> int:
    """自动获取本地空闲端口，彻底避免端口冲突"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

class DesktopAPI:
    """提供给前端 JS 调用的桌面端原生 API"""

    def choose_folder(self) -> str:
        """弹出系统原生文件夹选择对话框"""
        window = webview.active_window()
        if window:
            result = window.create_file_dialog(webview.FOLDER_DIALOG)
            if result and len(result) > 0:
                return result[0]
        return ""

    def open_path(self, path: str):
        """在系统文件管理器 (Finder / Explorer) 中定位/打开指定文件夹"""
        if not path or not os.path.exists(path):
            path = os.getenv("DOWNLOAD_DIR", os.path.join(os.getcwd(), "downloads"))
            os.makedirs(path, exist_ok=True)
            
        if sys.platform == 'win32':
            os.startfile(path)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', path])
        else:
            subprocess.Popen(['xdg-open', path])

    def get_app_version(self) -> str:
        return APP_VERSION

def start_server(port: int):
    """在后台线程中启动 FastAPI 后端服务"""
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def main():
    # 设置工作目录
    if getattr(sys, 'frozen', False):
        # 如果是 PyInstaller 打包后的运行环境
        os.chdir(sys._MEIPASS)

    port = find_free_port()

    # 1. 后台线程启动后端 API
    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    # 2. 等待后端端口就绪
    max_retries = 30
    ready = False
    for _ in range(max_retries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    ready = True
                    break
        except Exception:
            pass
        time.sleep(0.1)

    url = f"http://127.0.0.1:{port}"
    api = DesktopAPI()

    # 3. 启动系统原生窗口
    window = webview.create_window(
        title=f"Universal Downloader · 全网多平台视频与图集下载器 v{APP_VERSION}",
        url=url,
        width=1220,
        height=840,
        min_size=(900, 600),
        js_api=api,
        text_select=True,
        zoomable=True,
    )

    webview.start(debug=False)

if __name__ == "__main__":
    main()

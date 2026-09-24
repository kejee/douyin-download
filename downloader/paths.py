"""
统一路径解析：桌面客户端与服务端/NAS 共用。

设计要点（避免历史上"双击即崩溃"的坑）：
1. 所有路径一律基于用户目录或环境变量推导，**不依赖进程 cwd**；
2. 本模块导入时不做任何磁盘写入，目录创建一律惰性且容错；
3. 桌面端（APP_MODE=desktop 或 PyInstaller 冻结）使用稳定的用户目录。
"""
import os
import subprocess
import sys

APP_NAME = "UniversalDownloader"

# 桌面端本地保存目录的用户覆写值（持久化在这个文件里）
_SETTINGS_FILE = "settings.json"


def is_desktop_mode() -> bool:
    """是否运行在桌面客户端环境"""
    return os.getenv("APP_MODE") == "desktop" or bool(getattr(sys, "frozen", False))


def ensure_dir(path: str) -> bool:
    """尽力创建目录；失败返回 False，绝不抛异常"""
    if not path:
        return False
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except OSError:
        return False


def app_config_dir() -> str:
    """应用配置/日志目录（跨平台标准位置）"""
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    elif sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    else:
        base = os.getenv("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, APP_NAME)
    ensure_dir(path)
    return path


def default_download_dir() -> str:
    """下载归档根目录。

    - Docker / NAS：以 DOWNLOAD_DIR 环境变量为准（行为保持不变）
    - 桌面端：~/Downloads/UniversalDownloader（稳定，不受双击启动的 cwd 影响）
    - 其余（本地裸跑 python main.py）：沿用 ./downloads 旧行为
    """
    env = (os.getenv("DOWNLOAD_DIR") or "").strip()
    if env:
        return env
    if is_desktop_mode():
        return os.path.join(os.path.expanduser("~"), "Downloads", APP_NAME)
    return os.path.join(os.getcwd(), "downloads")


def _settings_path() -> str:
    return os.path.join(app_config_dir(), _SETTINGS_FILE)


def load_settings() -> dict:
    import json
    try:
        with open(_settings_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> bool:
    import json
    try:
        path = _settings_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return True
    except OSError:
        return False


def load_local_dir() -> str:
    """桌面端"存到当前设备"的保存目录，默认 ~/Downloads/UniversalDownloader"""
    value = (load_settings().get("local_dir") or "").strip()
    if value and os.path.isdir(value):
        return value
    return default_download_dir()


def save_local_dir(path: str) -> bool:
    path = (path or "").strip()
    if not path or not ensure_dir(path):
        return False
    data = load_settings()
    data["local_dir"] = path
    return save_settings(data)


def reveal_in_file_manager(path: str) -> bool:
    """在系统文件管理器中定位并高亮某个文件。

    与 open_path（单纯打开目录）的区别：这里希望文件管理器中**选中**目标文件，
    macOS 用 `open -R`，Windows 用 `explorer /select,`；Linux 各家文件管理器没有
    统一的「选中」协议，退化为打开父目录。

    调用方需自行校验路径的合法性（见 ServerDownloadManager.reveal_file）。
    """
    raw = (path or "").strip()
    if not raw:
        return False
    target = os.path.abspath(raw)
    if not os.path.exists(target):
        return False
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", target])
        elif sys.platform == "win32":
            if os.path.isdir(target):
                os.startfile(target)  # noqa: S606
            else:
                subprocess.Popen(["explorer", "/select,", target])
        else:
            parent = target if os.path.isdir(target) else os.path.dirname(target)
            subprocess.Popen(["xdg-open", parent])
        return True
    except OSError:
        return False

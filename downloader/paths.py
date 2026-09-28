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


def load_server_dir() -> str:
    """NAS/服务端归档目录的用户覆写值（为空表示沿用环境变量给的默认值）"""
    value = (load_settings().get("server_dir") or "").strip()
    if value and os.path.isdir(value):
        return value
    return ""


def save_server_dir(path: str) -> bool:
    path = (path or "").strip()
    if not path or not ensure_dir(path):
        return False
    data = load_settings()
    data["server_dir"] = path
    return save_settings(data)


# 这些文件系统即使被挂载，内容也不跨重启/重建保留 —— 不能算"持久"。
# 尤其 tmpfs：它是独立挂载点，只按"是否落在非根挂载点上"判断会误判成安全，
# 而 /tmp 恰恰是最容易被误填的地方。overlay/rootfs 是容器自己的可写层，
# 同理；真正绑进来的卷会显示宿主机的文件系统类型（ext4/xfs/btrfs…）。
_VOLATILE_FS = frozenset({
    "tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts",
    "overlay", "rootfs", "mqueue", "securityfs", "debugfs", "ramfs",
})


def _read_mount_points(mounts_file: str) -> list:
    """读「持久」挂载点列表（/proc/mounts 的第二列，已剔除易失文件系统）"""
    points = []
    with open(mounts_file, "r", encoding="utf-8") as handle:
        for line in handle:
            parts = line.split()
            if len(parts) < 2:
                continue
            if len(parts) >= 3 and parts[2].lower() in _VOLATILE_FS:
                continue
            # /proc/mounts 里空格被转义成 \040
            points.append(parts[1].replace("\\040", " "))
    return points


def is_persistent_mount(path: str, mounts_file: str = "/proc/mounts") -> bool:
    """判断路径是否落在**挂载卷**上（只有挂载卷会跨容器重建保留）。

    用途：用户在 Web 上把归档目录改到容器内的普通目录（如 /tmp/x）时，
    下载能成功、界面上一切正常，但**容器一重建文件就没了** —— 这是 NAS 部署里
    最隐蔽的一类损失。这里提前识别并让界面给出警告，而不是替用户拦下来
    （确实有人只想临时存一份）。

    mounts_file 可注入是**为了可测**：macOS 上没有 /proc/mounts，
    不注入的话这段判断在开发机上永远走不到，等于没测过。
    读不到挂载表时一律返回 True（不误报）。
    """
    try:
        mount_points = _read_mount_points(mounts_file)
    except (OSError, UnicodeDecodeError):
        return True
    if not mount_points:
        return True

    target = os.path.realpath(path)
    best = "/"
    for point in mount_points:
        real = os.path.realpath(point)
        if target == real or target.startswith(real.rstrip("/") + "/"):
            if len(real) > len(best):
                best = real
    # 命中的最长挂载点仍是根文件系统 => 落在容器可写层，重建即丢
    return best != "/"


# 同时下载数：界面可调（1~8），默认 3。
# 太小浪费带宽，太大容易触发平台限流与磁盘抖动，也给批量任务留出处理余量。
DEFAULT_MAX_CONCURRENT = 3
MIN_MAX_CONCURRENT = 1
MAX_MAX_CONCURRENT = 8


def load_max_concurrent() -> int:
    try:
        value = int(load_settings().get("max_concurrent") or DEFAULT_MAX_CONCURRENT)
    except (TypeError, ValueError):
        return DEFAULT_MAX_CONCURRENT
    return max(MIN_MAX_CONCURRENT, min(MAX_MAX_CONCURRENT, value))


def save_max_concurrent(value: int) -> bool:
    try:
        value = int(value)
    except (TypeError, ValueError):
        return False
    value = max(MIN_MAX_CONCURRENT, min(MAX_MAX_CONCURRENT, value))
    data = load_settings()
    data["max_concurrent"] = value
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

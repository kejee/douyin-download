"""
下载历史持久化（桌面端 / 服务端共用）。

任务进入**终态**（成功 / 失败 / 已取消）时落一条记录，解决两件事：
1. 客户端重启后任务列表是空的，"下载过什么、存到哪了" 无从查证；
2. 界面上的「已完成与历史」区默认折叠，需要一个不随列表生命周期消失的数据源。

刻意不用 SQLite：上限 500 条，JSON 完全够用，且出问题时用户能直接打开看、手工修。

写盘只在任务终结时发生（每个文件 1 次）。**绝不能挂在进度事件上** ——
一个 1.5GB 的文件会产生约 2.4 万条进度事件，那会把磁盘打爆。
"""
import json
import logging
import os
import threading
import time
from typing import Any, Dict, Iterable, List

from downloader.paths import app_config_dir

logger = logging.getLogger(__name__)

_HISTORY_FILE = "history.json"

# 条数上限：超出后丢弃最旧的。500 条约 0.2MB，对磁盘和加载速度都无感。
MAX_ENTRIES = 500

# 本模块可能同时被 asyncio 协程与 FastAPI 的线程池调用（同步路由），
# 因此用线程锁而不是 asyncio.Lock —— 后者跨线程无效。
_lock = threading.RLock()


def history_path() -> str:
    return os.path.join(app_config_dir(), _HISTORY_FILE)


def _read_raw() -> List[Dict[str, Any]]:
    """读原始条目列表（内部按时间正序保存，便于追加与裁剪）"""
    try:
        with open(history_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        entries = data.get("entries")
    elif isinstance(data, list):
        entries = data  # 兼容裸列表格式
    else:
        entries = None
    if not isinstance(entries, list):
        return []
    return [e for e in entries if isinstance(e, dict) and e.get("id")]


def _write_raw(entries: List[Dict[str, Any]]) -> bool:
    path = history_path()
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "entries": entries}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
        return True
    except OSError as e:
        logger.warning(f"写入下载历史失败: {e}")
        try:
            os.path.exists(tmp) and os.remove(tmp)
        except OSError:
            pass
        return False


def load_history() -> List[Dict[str, Any]]:
    """读取全部历史，**最近的在前**（界面直接按这个顺序渲染）"""
    with _lock:
        return list(reversed(_read_raw()))


def record_history(
    *,
    task_id: str,
    title: str,
    filename: str,
    save_path: str = "",
    status: str = "success",
    size_bytes: int = 0,
    platform: str = "",
    channel: str = "",
    url: str = "",
    created_at: float = 0.0,
    finished_at: float = 0.0,
    duration: float = 0.0,
    error: str = "",
) -> bool:
    """追加一条历史。同一 id 已存在时先删旧再写新（重试成功的任务只留最新一条）"""
    if not task_id:
        return False
    finished_at = finished_at or time.time()
    entry = {
        "id": task_id,
        "title": title or filename or "未命名",
        "filename": filename or "",
        "save_path": save_path or "",
        "status": status,
        "size_bytes": int(size_bytes or 0),
        "platform": platform or "",
        "channel": channel or "",
        "url": url or "",
        "created_at": float(created_at or 0),
        "finished_at": float(finished_at),
        "duration": round(float(duration or 0), 1),
        "error": error or "",
    }
    with _lock:
        entries = [e for e in _read_raw() if e.get("id") != task_id]
        entries.append(entry)
        if len(entries) > MAX_ENTRIES:
            entries = entries[-MAX_ENTRIES:]
        return _write_raw(entries)


def delete_history(ids: Iterable[str]) -> int:
    """删除指定 id 的历史条目，返回实际删除条数"""
    wanted = {str(i) for i in (ids or []) if i}
    if not wanted:
        return 0
    with _lock:
        entries = _read_raw()
        kept = [e for e in entries if e.get("id") not in wanted]
        removed = len(entries) - len(kept)
        if removed:
            _write_raw(kept)
        return removed


def clear_history() -> int:
    """清空全部历史（不影响已下载的文件），返回清掉的条数"""
    with _lock:
        removed = len(_read_raw())
        _write_raw([])
        return removed

"""
下载历史持久化（桌面端 / 服务端共用）。

任务进入**终态**（成功 / 失败 / 已取消）时落一条记录，解决两件事：
1. 客户端重启后任务列表是空的，"下载过什么、存到哪了" 无从查证；
2. 界面上的「已完成与历史」区默认折叠，需要一个不随列表生命周期消失的数据源。

刻意不用 SQLite：条数有上限，JSON 完全够用，且出问题时用户能直接打开看、手工修。

写盘只在任务终结时发生（每个文件 1 次）。**绝不能挂在进度事件上** ——
一个 1.5GB 的文件会产生约 2.4 万条进度事件，那会把磁盘打爆。

**淘汰按「组」而不是按「条」**（batch_id 相同 = 一次批量提交，是同一组）。
曾经按条淘汰（500 条上限），结果一次 500 集的合集下载就把上限打满，
并把之前所有零散记录静默挤掉 —— 用户实测踩到过。按组淘汰后，
一次合集只占一个组名额，零散记录不会再被批量任务淹没。

**条目带 `owner`（发起下载的浏览器/设备标识）**：NAS 上全家共用一份 history.json，
没有归属的话谁都能看到、还能互相清空。owner 为空 = 老记录或无标识客户端，不隔离。
"""
import json
import logging
import os
import threading
import time
from typing import Any, Dict, Iterable, List, Optional

from downloader.paths import app_config_dir

logger = logging.getLogger(__name__)

_HISTORY_FILE = "history.json"

# 组数上限：一次批量提交算一组，单次下载各成一小组。300 组约等于
# 「几百次下载行为」，对个人使用足够；超出后丢弃最旧的组。
MAX_GROUPS = 300

# 条数硬上限：只是防止单个超大批次把文件撑爆（3000 条约 1.2MB）。
# 注意这里**不是**主要淘汰手段 —— 主要淘汰走 MAX_GROUPS。
MAX_ENTRIES = 3000


def _group_key(entry: Dict[str, Any]) -> str:
    """批次内所有记录共享同一 batch_id；没有 batch_id 的单次记录自成一组。

    单次组的键必须带上 id：否则所有单次记录会挤进同一组，一起被淘汰。
    """
    batch = str(entry.get("batch_id") or "").strip()
    return batch or f"#{entry.get('id')}"


def _trim(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """按组淘汰 + 条数兜底。entries 按时间正序（旧 → 新）。"""
    if not entries:
        return entries
    # 按「最后一次出现」的位置给组排序：长批次边下边写，开始得早但可能结束得晚
    last_pos: Dict[str, int] = {}
    for i, e in enumerate(entries):
        last_pos[_group_key(e)] = i
    order = sorted(last_pos, key=lambda k: last_pos[k])
    if len(order) > MAX_GROUPS:
        keep = set(order[-MAX_GROUPS:])
        entries = [e for e in entries if _group_key(e) in keep]
    if len(entries) > MAX_ENTRIES:
        entries = entries[-MAX_ENTRIES:]
    return entries

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


def load_history(owner: Optional[str] = None) -> List[Dict[str, Any]]:
    """读取历史，**最近的在前**（界面直接按这个顺序渲染）

    owner=None → 全部条目（没有设备标识的客户端，不隔离）
    owner="x"  → 只返回「属于 x」的条目

    归属判定刻意把 **owner 为空**的条目也算作"属于 x"：那是引入设备标识之前写下的
    记录，无法判断原本属于谁。若把它们藏起来，用户升级后会发现自己几百条历史凭空
    消失，比"多看到几条老记录"糟糕得多。代价是这批老记录任何设备都能清掉 ——
    它们本来就是"共享时代"的产物。
    """
    with _lock:
        entries = _read_raw()
    if owner:
        entries = [e for e in entries if not e.get("owner") or e.get("owner") == owner]
    return list(reversed(entries))


def load_history_split(owner: Optional[str]) -> tuple:
    """一次读盘，切分成 (自己的条目, 其他设备的条目)，两个列表都「最近的在前」。

    为什么要在后端切分而不是让前端自己按 owner 过滤：前端只拿到"自己的"那份时，
    就没法告诉用户"另外还有 N 条来自其他设备" —— 而这句话恰恰是避免用户以为
    "我的记录丢了"的关键。owner 为空（无标识客户端）时不做隔离：第二项恒为空。
    """
    with _lock:
        entries = _read_raw()
    if not owner:
        return list(reversed(entries)), []
    mine: List[Dict[str, Any]] = []
    others: List[Dict[str, Any]] = []
    for e in entries:
        entry_owner = e.get("owner") or ""
        if not entry_owner or entry_owner == owner:
            mine.append(e)
        else:
            others.append(e)
    return list(reversed(mine)), list(reversed(others))


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
    batch_id: str = "",
    batch_title: str = "",
    owner: str = "",
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
        # 批次信息：一次批量提交（合集 / 多选）的记录共享同一 batch_id，
        # 界面上折叠成一行，淘汰时也只占一个组名额
        "batch_id": str(batch_id or ""),
        "batch_title": str(batch_title or ""),
        # 归属：发起这次下载的浏览器/设备标识（前端 localStorage 生成，随请求带上）。
        # 共用一台 NAS 时靠它把「历史」和「任务列表」分开，避免互相看到、互相清空。
        # 为空 = 引入该字段之前的老记录，或没有标识的客户端（不隔离）。
        "owner": str(owner or ""),
    }
    with _lock:
        entries = [e for e in _read_raw() if e.get("id") != task_id]
        entries.append(entry)
        return _write_raw(_trim(entries))


def delete_history(ids: Iterable[str], owner: Optional[str] = None) -> int:
    """删除指定 id 的历史条目，返回实际删除条数

    owner 给定时只删「自己的」（含无归属的老记录）—— 别人的记录删不动。
    界面上其他设备的条目本来就不渲染操作按钮，这里是纵深防御：
    接口能被手工调用，不该因为前端没显示按钮就认为不会有请求。
    """
    wanted = {str(i) for i in (ids or []) if i}
    if not wanted:
        return 0
    with _lock:
        entries = _read_raw()
        if owner:
            wanted = {
                e.get("id") for e in entries
                if e.get("id") in wanted
                and (not e.get("owner") or e.get("owner") == owner)
            }
        kept = [e for e in entries if e.get("id") not in wanted]
        removed = len(entries) - len(kept)
        if removed:
            _write_raw(kept)
        return removed


def clear_history(owner: Optional[str] = None) -> int:
    """清空历史（不影响已下载的文件），返回清掉的条数

    owner 给定时只清自己的（含无归属的老记录），**别人的记录保留** ——
    否则共用同一台 NAS 时，一个人点「清空」，全家历史一起归零。
    """
    with _lock:
        entries = _read_raw()
        if owner:
            kept = [e for e in entries if e.get("owner") and e.get("owner") != owner]
        else:
            kept = []
        removed = len(entries) - len(kept)
        if removed:
            _write_raw(kept)
        return removed

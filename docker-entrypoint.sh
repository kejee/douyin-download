#!/bin/sh
# 容器入口：按 PUID/PGID 降权后再启动应用。
#
# 为什么要降权：容器默认以 root 运行，写进挂载卷的文件属主就是 root，
# 于是用户在 NAS 的 File Station / 文件管理器里既删不掉也改不了 ——
# 这是 NAS 上跑 Docker 应用最常见的抱怨。
#
# 为什么用 gosu 而不是 useradd/usermod：直接切到**数字** uid:gid 不依赖
# 容器内存在同名用户，也就不会因为 passwd/group 操作失败而启动不起来。
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
CONFIG_DIR="${XDG_CONFIG_HOME:-/config}"
ARCHIVE_DIR="${DOWNLOAD_DIR:-/downloads}"

mkdir -p "$CONFIG_DIR" "$ARCHIVE_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
    # 配置目录很小，可以放心递归改属主；
    # 归档目录**只改自身**，不做递归 —— 里面可能有几百 GB 已下载文件，
    # 一次全量 chown 在 NAS 上要跑很久，而且每次启动都跑一遍毫无意义。
    chown -R "$PUID:$PGID" "$CONFIG_DIR" 2>/dev/null || true
    chown "$PUID:$PGID" "$ARCHIVE_DIR" 2>/dev/null || true

    # 归档目录下由用户在界面里新建的子目录，属主会在创建时就跟着 PUID/PGID，
    # 所以这里不需要再递归处理。
    exec gosu "$PUID:$PGID" "$@"
fi

# 已经以非 root 启动（用户在 compose 里写了 user:）：直接执行，不再降权
exec "$@"

# Universal Downloader · NAS / 服务端镜像
#
# 设计要点：
# 1. **显式 COPY，不用 `COPY . .`** —— 镜像里只放运行必需的文件：不带 .git、
#    不带开发脚本与构建产物。镜像更小，也不会把仓库里的临时文件带进去。
# 2. 配置与归档都放在**挂载点**下（/config、/downloads），并支持 PUID/PGID 降权，
#    避免 NAS 挂载卷里的文件属主变成 root（否则用户在自己的文件管理器里删不掉）。
#    /config 必须挂载，否则换镜像就丢历史记录与设置。
# 3. tini 做 PID 1，`docker stop` 能干净退出（uvicorn 收得到信号）。
# 4. ffmpeg 用 Debian 包，它是 **GPL 构建**：自用无碍；对外分发镜像时需履行
#    GPL 义务（随附许可文本，并提供对应源码或书面要约）。
FROM python:3.11-slim

# XDG_CONFIG_HOME 指到 /config：应用把 settings.json / history.json 放在这里，
# 挂上卷就能跨容器重建保留。DOWNLOAD_DIR 是归档目录的**默认值**，
# 用户在界面上改过之后以界面里的值为准（见 downloader/paths.py 的 load_server_dir）。
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai \
    XDG_CONFIG_HOME=/config \
    DOWNLOAD_DIR=/downloads \
    PUID=1000 \
    PGID=1000

# gosu：降权执行；tini：正确的信号与僵尸进程处理
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      gosu \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖单独一层：requirements 不变时可复用缓存
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 只复制运行必需的代码（注意：requirements.txt 已不含 pywebview，
# 那是桌面客户端的 GUI 依赖，服务端镜像不需要）
COPY main.py ./
COPY downloader/ ./downloader/
COPY extractors/ ./extractors/
COPY static/ ./static/
# MIT 许可要求副本中保留版权与许可声明
COPY LICENSE ./

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /config /downloads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

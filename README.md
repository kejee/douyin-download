# 🎵 抖音短视频 & 图集在线解析下载 Web 平台 (Douyin Downloader)

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.0.0.1001-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/FastAPI-0.100+-green.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED.svg" alt="Docker Ready">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/UI-Glassmorphism-purple.svg" alt="Glassmorphism UI">
</p>

一款现代化、轻量高效、开源的抖音短视频/图集在线解析与下载平台。采用 FastAPI + 现代化极简毛玻璃 UI 开发，支持无水印与带水印视频下载、原声音频分离提取、高清图集批量下载与流式防盗链代理。

---

## ✨ 核心特性

- ⚡ **智能提取**：支持粘贴 App 复制的任意包含文字的分享长文本，自动提取并追踪短链接真实 `aweme_id`。
- 🎬 **双模式下载**：同时提供 **无水印高清视频 (1080P/720P)** 与 **带水印原始视频** 两种下载选项。
- 🖼️ **高清图集支持**：自动识别图集作品，支持在线画廊预览、单张原图下载及一键批量打包下载。
- 🎵 **背景音乐提取**：一键单独提取并下载视频/图集中的高清原声 MP3 文件。
- 🛡️ **突破防盗链**：内置流式代理下载服务，解决浏览器直接访问 CDN 触发 403 防盗链或变为在线播放无法触发下载的问题。
- 🎨 **极美深色毛玻璃 UI**：暗黑科技质感、霓虹流光、平滑过渡动画、移动端自适应响应式布局。
- 🐳 **容器化与自动化 CI/CD**：提供官方 Docker 镜像，配置 GitHub Actions 自动多架构（amd64 / arm64）构建与推送至 GHCR。

---

## 🚀 快速开始

### 方式一：Docker Compose（推荐）

本项目已提供标准的 `docker-compose.yml`，执行以下命令即可在后台启动服务：

```bash
# 克隆仓库
git clone https://github.com/kejee/douyin-download.git
cd douyin-download

# 启动容器
docker compose up -d
```
启动后，在浏览器访问 `http://localhost:8000` 即可开始使用。

---

### 方式二：Docker 镜像一键运行

直接使用 Dockerfile 构建并运行：

```bash
# 1. 构建镜像
docker build -t douyin-downloader:latest .

# 2. 运行容器
docker run -d --name douyin-downloader -p 8000:8000 --restart unless-stopped douyin-downloader:latest
```

---

### 方式三：本地 Python 环境运行

**环境要求**：Python 3.10+

```bash
# 1. 创建并激活虚拟环境 (可选)
python3 -m venv venv
source venv/bin/activate  # macOS / Linux
# .\venv\Scripts\activate # Windows

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python3 main.py
# 或使用 uvicorn
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🛠️ GitHub Actions 自动化部署说明

项目包含 `.github/workflows/docker-publish.yml` 工作流：
1. 当代码推送到 `main` 分支或发布新的 Tag（如 `v1.0.0`）时，GitHub Actions 会自动触发；
2. 自动配置 QEMU 和 Docker Buildx，进行 `linux/amd64` 和 `linux/arm64` 多平台交叉编译；
3. 自动将 Docker 镜像推送到 GitHub Packages (`ghcr.io/kejee/douyin-download`)；
4. 部署时可直接拉取最新镜像：
   ```bash
   docker pull ghcr.io/kejee/douyin-download:latest
   ```

---

## 📡 RESTful API 接口文档

除了 Web 可视化页面外，本项目还提供了简洁的 HTTP API 供第三方服务调用：

### 1. 解析视频 / 图集
- **请求方式**：`POST`
- **接口路径**：`/api/parse`
- **请求头**：`Content-Type: application/json`
- **请求体**：
  ```json
  {
    "url": "7.21 H@m.IO 复制打开抖音，看看【xxx的作品】 https://v.douyin.com/xxxxxx/"
  }
  ```
- **响应示例 (视频)**：
  ```json
  {
    "success": true,
    "type": "video",
    "id": "7234567890123456789",
    "title": "作品文案标题",
    "cover": "https://p3.douyinpic.com/...",
    "author": {
      "nickname": "创作者昵称",
      "avatar": "https://p3.douyinpic.com/...",
      "unique_id": "dy123456"
    },
    "statistics": {
      "digg_count": 10520,
      "comment_count": 820,
      "share_count": 350
    },
    "music": {
      "title": "背景原声名称",
      "author": "原声创作者",
      "url": "https://sf3-cdn-tos.douyinstatic.com/..."
    },
    "video": {
      "no_watermark_url": "https://www.douyin.com/aweme/v1/play/?video_id=...",
      "watermark_url": "https://aweme.snssdk.com/..."
    }
  }
  ```

### 2. 代理流式下载
- **请求方式**：`GET`
- **接口路径**：`/api/download?url={MEDIA_URL}&filename={FILE_NAME}`
- **说明**：通过服务端带特定 Referer 与 User-Agent 代理拉取视频流并响应 `attachment`，保障下载稳定性并规避跨域阻断。

---

## ⚠️ 法律免责声明 (Disclaimer)

> **重要声明**：
> 1. 本项目仅供技术研究、网络接口分析与个人学习交流使用，**严禁用于任何商业牟利活动、非法爬取或侵权行为**。
> 2. 解析获取的所有视频、音频、图集及文字内容的完整版权与知识产权均归属于**原始创作者**及**抖音（北京微播视界科技有限公司 / 字节跳动）**平台所有。
> 3. 本项目作者与贡献者不对使用者的任何使用行为及其后果承担任何直接、间接或连带的法律责任。使用者须自行承担因下载、二次传播或使用相关媒体资产所产生的法律后果。
> 4. 如相关权利方认为本项目存在侵权或不当之处，请提交 Issue 或联系项目维护者，我们将及时处理。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。

# 🎬 全网多平台短视频 & 图集在线解析下载 Web 平台 (Universal Media Downloader)

<p align="center">
  <img src="https://img.shields.io/badge/version-v2.0.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/FastAPI-0.100+-green.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED.svg" alt="Docker Ready">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/UI-Glassmorphism-purple.svg" alt="Glassmorphism UI">
</p>

一款现代化、插件化架构、轻量高效、开源的**多平台短视频与高清图集在线解析下载平台**。采用 FastAPI + 现代化极简毛玻璃 UI 开发，支持抖音、小红书、快手、皮皮虾、TikTok 等多主流平台的视频直链提取、无水印下载、原声音频分离与高清图集一键打包。

---

## 🌐 支持平台与特性矩阵

| 平台 | 视频无水印 | 高清原图图集 | 原声 MP3 提取 | 互动数据 (赞/评/播) | 防盗链代理下载 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 🎵 **抖音 (Douyin)** | ✅ (1080P/720P) | ✅ 高清原图打包 | ✅ 纯净原声 | ✅ 赞/评/转 | ✅ 自动注入 Referer |
| 🌐 **TikTok** | ✅ 国际版无水印 | ✅ 原图提取 | ✅ 原声提取 | ✅ 完整互动数据 | ✅ 自动注入 Referer |
| 📕 **小红书 (Xiaohongshu)** | ✅ 1080P 纯净流 | ✅ 无水印原图列表 | ➖ | ✅ 点赞/评论数 | ✅ 自动注入 Referer |
| ⚡ **快手 (Kuaishou)** | ✅ 纯净原画直链 | ✅ 高清图集 | ✅ 背景音乐 MP3 | ✅ 播放量/点赞/评论 | ✅ 自动注入 Referer |
| 🦐 **皮皮虾 (Pipixia)** | ✅ 原画高清视频 | ✅ 高清图集 | ➖ | ✅ 播放量/点赞/评论 | ✅ 自动注入 Referer |

---

## ✨ 核心亮点

- ⚡ **插件化 Extractor 架构**：各平台解析引擎高度解耦，基于统一数据规范模型 (`MediaResponse`) 构建，极易横向扩展。
- 🔗 **全文本智能提取**：支持直接粘贴 App 复制的任意复杂图文分享文案，自动过滤干扰字符并精准追踪短链接。
- 🖼️ **高清图集支持**：小红书、抖音、快手、皮皮虾图集自动识别，支持单张原图下载及批量一键打包下载。
- 🎵 **背景原声分离**：一键提取并下载视频/图集内嵌的高清原声音乐（MP3/M4A 格式）。
- 🛡️ **突破 CDN 防盗链**：内置流式代理下载服务，动态注入平台鉴权 Referer，彻底解决浏览器直接访问 CDN 触发 403 或变为网页预览无法下载的问题。
- 🎨 **极美深色毛玻璃 UI**：暗黑科技质感、霓虹流光背景、自适应动态指标卡片与移动端响应式布局。
- 🐳 **容器化部署**：支持 Docker & Docker Compose 一键拉起，已配置 GitHub Actions 自动构建发布多架构镜像。

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
docker build -t universal-downloader:v2.0.0.0 .

# 2. 运行容器
docker run -d --name universal-downloader -p 8000:8000 --restart unless-stopped universal-downloader:v2.0.0.0
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

## 📁 项目结构

```text
├── extractors/            # 插件化解析引擎模块
│   ├── base.py            # 抽象基类与标准数据模型 (MediaResponse)
│   ├── router.py          # 统一 URL 提取与平台分发路由中心
│   ├── douyin.py          # 抖音 / TikTok 解析器
│   ├── xiaohongshu.py     # 小红书图集与视频解析器
│   ├── kuaishou.py        # 快手视频与图集解析器
│   └── pipixia.py         # 皮皮虾视频与图集解析器
├── static/                # 前端静态资源
│   ├── css/style.css      # 现代毛玻璃响应式样式
│   ├── js/app.js          # 前端交互与自适应渲染逻辑
│   └── index.html         # Web 操作页面
├── main.py                # FastAPI 核心入口与防盗链代理网关
├── Dockerfile             # 多架构 Docker 构建配置
├── docker-compose.yml     # 容器编排文件
└── requirements.txt       # Python 依赖清单
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
    "url": "粘贴任意抖音/小红书/快手/皮皮虾等分享文本或链接"
  }
  ```
- **响应示例 (标准化 JSON)**：
  ```json
  {
    "success": true,
    "platform": "douyin",
    "platform_name": "抖音",
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
      "share_count": 350,
      "play_count": 250000
    },
    "music": {
      "title": "背景原声名称",
      "author": "原声创作者",
      "url": "https://sf3-cdn-tos.douyinstatic.com/..."
    },
    "video": {
      "no_watermark_url": "https://...",
      "watermark_url": "https://..."
    },
    "images": []
  }
  ```

### 2. 突破防盗链流式下载
- **请求方式**：`GET`
- **接口路径**：`/api/download?url={MEDIA_URL}&filename={FILE_NAME}`
- **说明**：通过服务端智能匹配媒体源 CDN 注入合法 Referer，保障直接触发浏览器本地下载并规避跨域 403。

---

## ⚠️ 法律免责声明 (Disclaimer)

> **重要声明**：
> 1. 本项目仅供技术研究、网络接口分析与个人学习交流使用，**严禁用于任何商业牟利活动、非法爬取、批量搬运或侵犯他人知识产权之行为**。
> 2. 解析获取的所有视频、音频、图集及文字内容的完整版权均归属于**原始创作者**及**对应官方平台**所有。
> 3. 本项目作者与贡献者不对使用者的任何使用行为及其后果承担任何直接、间接或连带的法律责任。
> 4. 如相关权利方认为本项目存在不当之处，请提交 Issue 或联系维护者，我们将及时处理。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。

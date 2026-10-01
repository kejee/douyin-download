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

| 平台 | 视频无水印/高清 | 高清原图图集 | 原声音频提取 | 互动数据 (赞/评/播/弹) | 防盗链与混流下载 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 🎵 **抖音 (Douyin)** | ✅ (1080P/720P) | ✅ 高清原图 | ✅ 纯净原声 | ✅ 赞/评/转/博主作品抓取 | ✅ 自动注入 Referer |
| 🌐 **TikTok** | ✅ 国际版无水印 | ✅ 原图提取 | ✅ 原声提取 | ✅ 完整互动数据 | ✅ 自动注入 Referer |
| 📺 **哔哩哔哩 (Bilibili)** | ✅ 1080P/720P DASH | ➖ | ✅ 高音质 M4A/MP3 | ✅ 播放/弹幕/评论/UP主全量 | ✅ FFmpeg 内存实时混流 |
| 🐦 **Twitter / X** | ✅ 1080P/原画 | ✅ 4K 原图列表 | ➖ | ✅ 点赞/转发/回复 | ✅ 几何长边最高清 |
| 📕 **小红书 (Xiaohongshu)** | ✅ 1080P 纯净流 | ✅ 无水印原图列表 | ➖ | ✅ 点赞/评论数 | ✅ 自动注入 Referer |
| ⚡ **快手 (Kuaishou)** | ✅ 纯净原画直链 | ✅ 高清图集 | ✅ 背景音乐 MP3 | ✅ 播放量/点赞/评论 | ✅ 自动注入 Referer |
| 🦐 **皮皮虾 (Pipixia)** | ✅ 原画高清视频 | ✅ 高清图集 | ➖ | ✅ 播放量/点赞/评论 | ✅ 自动注入 Referer |

---

## 💡 B 站 (Bilibili) 1080P / 4K 高清画质配置说明

B 站官方对未登录访客仅开放 **480P**。配置一个 `SESSDATA` 即可解锁 **1080P 原画 / 4K 超清** ——
**普通账号即可，无需大会员**。

**怎么拿到**：浏览器登录 `bilibili.com` → 按 `F12` → `Application` → `Cookies` →
`https://www.bilibili.com` → 复制 `SESSDATA` 的值。

拿到之后，下面两种方式**任选一种**：

| | 方式 A：网页里设置 | 方式 B：容器环境变量 |
|---|---|---|
| 入口 | 界面输入 B 站链接后出现提示条 → 「⚙️ 配置 SESSDATA」 | `docker-compose.yml` 的 `environment`，或 `docker run -e` |
| 存在哪 | **各浏览器自己的 localStorage** | 容器内的环境变量 |
| 生效范围 | **只对设置过的那一个浏览器生效** | **该容器上所有设备、所有浏览器都生效** |
| 多设备时 | ⚠️ **每台设备都要各设一次** | ✅ **设一次就够**，之后新设备打开即可用 |
| 适合 | 自己用、每人想用自己的账号 | NAS / 服务器多设备共享 |

方式 B 的写法（两种任填其一）：

```yaml
environment:
  - SESSDATA=your_bilibili_sessdata_here
  # 如果你有完整 Cookie，也可以用它；优先级高于上一行
  # - BILIBILI_COOKIE=SESSDATA=xxx; bili_jct=yyy
```

> [!TIP]
> **这一项可以留空，也可以先不填。** 写成 `- SESSDATA=`（空值）与完全不写这一行
> **行为完全一致**，都是访客画质、不会报错；想用的时候填上值、重启容器即可。
> 仓库里三份 compose 都已预留这个空项，不用自己猜该加在哪。

改完重启容器生效：`docker compose up -d --force-recreate`

> [!IMPORTANT]
> **优先级：网页里设的值 > `BILIBILI_COOKIE` > `SESSDATA`。**
> 所以如果某个浏览器里**曾经设过**自己的（哪怕是旧账号），它会**覆盖**你在 compose 里配的环境变量。
> 想让环境变量在那一台设备上也生效，去那个浏览器点「清除」再刷新即可。
>
> 反过来这也很方便：多人共用的 NAS 上，环境变量提供一个公共账号，
> **谁想用自己的账号，就在自己的浏览器里单独设一次**，互不影响。

---

## ✨ 核心亮点

- ⚡ **插件化 Extractor 架构**：各平台解析引擎高度解耦，基于统一数据规范模型 (`MediaResponse`) 构建，极易横向扩展。
- 🔗 **全文本智能提取**：支持直接粘贴 App 复制的任意复杂图文分享文案，自动过滤干扰字符并精准追踪短链接。
- 🖼️ **高清图集支持**：小红书、抖音、快手、皮皮虾图集自动识别，支持单张原图下载及批量一键打包下载。
- 🎵 **背景原声分离**：一键提取并下载视频/图集内嵌的高清原声音乐（MP3/M4A 格式）。
- 🛡️ **突破 CDN 防盗链**：内置流式代理下载服务，动态注入平台鉴权 Referer，彻底解决浏览器直接访问 CDN 触发 403 或变为网页预览无法下载的问题。
- 🎨 **极美深色毛玻璃 UI**：暗黑科技质感、霓虹流光背景、自适应动态指标卡片与移动端响应式布局。
- 🐳 **容器化部署**：支持 Docker & Docker Compose 一键拉起，已配置 GitHub Actions 自动构建发布多架构镜像。
- 👨‍👩‍👧 **多设备互不打扰**：同一台 NAS 上多人共用时，任务列表与下载历史按浏览器自动隔离，互相看不到、也无法清空对方的记录；已下载的文件与「重复下载检测」仍是全设备共享的。

---

## 🖥️ 桌面客户端（macOS）

不想折腾 Docker？直接从 [Releases](https://github.com/kejee/douyin-download/releases) 下载 `UniversalDownloader-macOS-arm64.zip`，解压后把 `UniversalDownloader.app` 拖进「应用程序」即可。功能与 Web 版一致，且不需要联网环境也能正常显示界面（字体与图标已内嵌）。

**系统要求：macOS 12.0（Monterey）及以上，且必须是 Apple Silicon（M 系列芯片）。**
目前不提供 Intel 构建产物；在 Intel Mac 上打开会提示「此应用不支持此架构」。

### 首次打开会被系统拦住，这是正常的

客户端使用临时签名（ad-hoc），没有购买 Apple 开发者证书做公证，因此 Gatekeeper 会拦截首次启动。任选一种方式放行，**只需做一次**：

**方式 1：右键打开（最简单）**

1. 在「应用程序」里**右键点击**（或按住 Control 点击）`UniversalDownloader.app`，选择「打开」
2. 弹窗里再点一次「打开」
3. 之后双击就能正常启动了

**方式 2：系统设置里放行**

打开「系统设置 → 隐私与安全性」，在底部找到“已阻止使用 UniversalDownloader”的提示，点击「仍要打开」。

**方式 3：命令行移除隔离标记**

```bash
xattr -dr com.apple.quarantine /Applications/UniversalDownloader.app
```

如果双击时提示「无法验证开发者」或「Apple 无法检查其是否包含恶意软件」，都是同一个原因，用上面任一方式即可解决。

### 应用数据位置

| 内容 | 路径 |
| --- | --- |
| 下载的文件 | `~/Downloads/UniversalDownloader`（可在界面里更改） |
| 配置 | `~/Library/Application Support/UniversalDownloader/settings.json` |
| 运行日志 | `~/Library/Application Support/UniversalDownloader/logs/desktop.log` |

应用固定在 `127.0.0.1:18760` 提供服务，同一时刻只运行一个实例（重复启动会复用已有实例，这是 B 站 SESSDATA 等设置能跨重启保留的前提）。遇到问题请附上 `desktop.log`，未捕获的异常都会记录在那里。

---

## 🚀 快速开始

### 方式一：Docker Compose（推荐）

**适用于任何能跑 Linux 容器的 Docker 主机**：Linux 服务器、群晖、威联通、Docker Desktop（macOS / Windows）都可以。
镜像里已自带 ffmpeg，**宿主机什么都不用装**。只有 NAS 需要额外注意挂载路径，见方式四。

执行以下命令即可后台启动服务：

```bash
# 克隆仓库
git clone https://github.com/kejee/douyin-download.git
cd douyin-download

# 启动容器
docker compose up -d
```
启动后，在浏览器访问 `http://localhost:8000` 即可开始使用。

**换一台主机部署时，需要检查下面几项**（都不是障碍，改配置即可）：

| # | 项目 | 说明 |
|---|---|---|
| 1 | **端口** | 容器内恒为 8000，宿主端口随意映射；被占用就改 `"8000:8000"` 左边的数字 |
| 2 | **持久化目录** | `./config`（设置 / 下载历史 / 预览缓存）与 `./downloads` **必须保留**，丢了等于「换个镜像历史全没」；也可改用命名卷 |
| 3 | **PUID / PGID** | 决定下载文件的属主。填成你自己的 `id -u` / `id -g`，否则文件在宿主上可能不好管理 |
| 4 | **目标架构** | 在 arm64 机器上**原生构建即可**（不用 `--platform`）；只有「在 Apple 芯片上给 x86 机器构建」才需要 `--platform linux/amd64` |
| 5 | **代理** | 大陆环境解析 **YouTube / Twitter 需要代理**，且要填**局域网 IP**（容器里的 `127.0.0.1` 是容器自己）。抖音 / B站 / 小红书 / 快手 不需要。**优先用 config 目录里的 `proxy.env`**，改完刷新网页即生效，见下一节 |
| 6 | **时间** | 时区默认 `TZ=Asia/Shanghai`，影响下载历史里的时间显示 |

---

#### 代理配置：改文件即可，不用重建容器

容器首次启动时会在挂载的 config 目录里生成 **`config/proxy.env`** 注释模板。

**只想让某些平台走代理**（例如只让 Twitter 走、其余直连）：

```ini
PROXY_PLATFORMS=twitter
http://192.168.1.2:7890
```

可用名字：`twitter`(或 `x`) / `bilibili` / `douyin` / `xhs` / `kuaishou` / `pipixia` / `youtube`；
逗号或空格分隔多个；也认中文（`推特` / `B站` / `抖音` / `小红书` / `快手` / `皮皮虾`）。
不写这一行（或写 `*` / `all`）就是**所有平台都走代理**。

**全平台都走代理**就是一行地址（http 与 https 都会用它）：

```ini
http://192.168.1.2:7890
```

或者逐项写：

```ini
HTTP_PROXY=http://192.168.1.2:7890
HTTPS_PROXY=http://192.168.1.2:7890
NO_PROXY=localhost,127.0.0.1,192.168.0.0/16
```

| 规则 | 说明 |
|---|---|
| **优先级** | `proxy.env` **高于** compose 里的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` |
| **作用范围** | `PROXY_PLATFORMS` 把代理**收窄到指定平台**：未被点名的平台一律直连（解析与下载都是）。不写 = 全部平台 |
| **生效时机** | 保存文件后**刷新网页**即可（网页每次加载都会让后端重读该文件），**不用重建容器**，也不会打断正在排队的任务 |
| **不写 / 留空** | 该键**不覆盖**，继续沿用 compose 的值 |
| **删掉文件** | 完全回落到 compose 的设置（试错不留副作用） |
| **容错** | 支持 `#` / `;` 注释、`export` 前缀、值两侧引号、CRLF；不带 `http://` 会自动补 |
| **配对** | 只写了 `HTTP_PROXY` 或只写了 `HTTPS_PROXY` 时，会自动镜像到另一个（避免一半请求没走代理） |
| **查看** | 网页「归档目录」弹窗底部会显示**生效的代理、来源与作用范围**（来自配置文件 / 来自 compose / 未配置） |

> [!IMPORTANT]
> 必须填**局域网**地址（如 `http://192.168.1.2:7890`），不能写 `127.0.0.1` ——
> 容器里的 `127.0.0.1` 指的是容器自己。另外，代理地址里若带了账号密码，
> 界面上会显示成 `http://user:***@host:port`。

> [!NOTE]
> `PROXY_PLATFORMS` 这种"只代理部分平台"的能力，靠的是**不把代理写进环境变量**：
> 环境变量是全局的，一旦设置所有请求都会走它，做不到只代理一个平台。
> 代价是——被点名平台的**解析与下载**都由程序显式带上代理，
> 因此覆盖范围是：解析（各平台 extractor）、服务端归档下载、桌面端落盘、
> 浏览器直连下载网关、以及 B站双轨混流的 ffmpeg。
> 如果你还用了本项目之外的方式去取这些 CDN 直链（例如自己写脚本），那边不受影响。


---

### 方式二：Docker 镜像一键运行

直接使用 Dockerfile 构建并运行：

```bash
# 1. 构建镜像（tag 要与下面 run 用的一致）
docker build -t universal-downloader:latest .

# 2. 运行容器
#    -v 两个卷都不要省：config 存设置/下载历史/预览缓存，downloads 存下载文件
#    少了它们，容器一重建数据就没了
docker run -d --name universal-downloader \
  -p 8000:8000 \
  -e PUID=1000 -e PGID=1000 \
  -v "$(pwd)/config:/config" \
  -v "$(pwd)/downloads:/downloads" \
  --restart unless-stopped \
  universal-downloader:latest
```

---

### 方式三：本地 Python 环境运行

**环境要求**：Python 3.10+，以及 **ffmpeg** —— B站音视频双轨混流、视频预览准备都要用它。
Docker 镜像里已内置，本地直接跑需要自己装好并确保在 `PATH` 里
（macOS `brew install ffmpeg`，Ubuntu `apt install ffmpeg`）。
缺它不影响普通单轨下载，但双轨与预览会失败并给出明确提示。

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

### 方式四：NAS 部署（威联通 / 群晖）

> **这一节只针对 NAS。** 普通 Docker 主机（Linux 服务器 / Docker Desktop / 群晖的普通容器）
> 直接用方式一即可，不需要看这里。

威联通（Container Station）上挂载点必须写**绝对路径**，相对路径会落到应用程序自己的目录，
看起来挂上了其实没有。按 NAS 上有没有构建环境选一条路：

#### 路线 A｜NAS 上有源码 / 能构建 → 用 `docker-compose.qnap.yml`

仓库里已提供，直接用即可。动手前只需改两处，文件里都有注释：

1. `CACHEDEVn_DATA` 的编号 —— SSH 里 `ls /share` 查看；若有同名软链，
   改用 `/share/<共享文件夹名>/...` 更稳（存储池编号变了也不用改 compose）。
2. `PUID` / `PGID` —— 决定下载下来的文件属于谁。填错的话文件在 File Station 里
   会显示成别的用户，你删不掉也改不了。

> [!IMPORTANT]
> **`/config` 这个卷必须挂**（三个 compose 文件里都已写好）。
> 设置、下载历史、预览缓存都放在容器内的 `$XDG_CONFIG_HOME` 下，
> 不挂卷就是容器可写层 —— 换个镜像版本，历史记录和 SESSDATA 全部丢失。

部署后是**通过浏览器访问** `http://<NAS 的 IP>:<映射的端口>`，与 Web 版功能一致。
归档目录可以在界面里随时修改（任务抽屉 → 存储目的地 → 点路径标签），
不必改 compose 重建容器；改动只对**后续**任务生效。

#### 路线 B｜NAS 上没有源码 / 不装构建环境 → 在开发机构建好再导入 tar

```bash
# ① 在 Apple 芯片的 Mac 上构建 —— --platform 不能省！
#    M 系列 Mac 不加它构建出的是 arm64 镜像，导到 Intel NAS 上容器会
#    「exec format error」起不来。
docker build --platform linux/amd64 -t universal-downloader:latest .

# ② 导出前核对架构，必须是 linux/amd64
docker image inspect universal-downloader:latest --format '{{.Os}}/{{.Architecture}}'

# ③ 导出（体积 ≈ 镜像体积，不压缩）
docker save -o universal-downloader-amd64.tar universal-downloader:latest
```

```bash
# ④ 传到 NAS 后导入
docker load -i /share/Webs/universal-downloader/universal-downloader-amd64.tar

# ⑤ 用专用 compose 启动 —— 这份**不含 build:**，不会去就地重新构建
docker compose -f docker-compose.qnap-tar.yml up -d
```

`docker-compose.qnap-tar.yml` 同样是威联通专用，改 `PUID`/`PGID`（SSH 执行 `id` 查）
与端口即可，无需再改其它。

> [!IMPORTANT]
> 启动导入的镜像时**别用带 `build:` 的那份 compose** —— `docker compose up -d`
> 会尝试在 NAS 上就地重新构建，而 NAS 上没有源码 → 直接报错起不来。
> 这正是单独提供 `docker-compose.qnap-tar.yml` 的原因。

### 多设备共用一台 NAS 时，什么共享、什么隔离

服务端只有一份 `history.json` 和一份任务表。为了让家人共用时互不打扰，
每个浏览器首次访问会生成一个设备标识（存在 `localStorage`），请求与事件流都带上它：

| 项目 | 行为 |
| --- | --- |
| 正在下载的任务 | **隔离**。别人看不到你的卡片，也就无法暂停/取消你的任务 |
| 下载历史（往期记录） | **隔离**。默认只显示自己的；别人的折叠在「其他设备的记录」里，**只读** |
| 清空历史 / 移除记录 | **只影响自己**。共用时一个人清空不会把全家的记录带走 |
| 已下载的文件、归档目录 | **共享**（就是同一份，这是 NAS 的意义） |
| 重复下载检测 | **共享且准确**。它查的是归档目录里的同名文件，与历史无关 |
| 视频预览缓存 | 共享（按直链路径做键，两个人预览同一个视频不会下两遍） |
| 同时下载数（并发槽位） | **共享一份设置**，但会为"一个槽位都没拿到"的设备**让位**（见下） |

**并发是怎么分的**：同时下载数是服务端的一份设置（默认 3，范围 1~8），所有设备共用 ——
NAS 的带宽和磁盘是同一个，所以它必须全局限制。先提交的一方先用满；当另一台设备提交任务时
若一个槽位都没拿到，会请占满的一方**让出一个**：

- **只挑能无损让位的任务**：源支持断点续传（或还没写盘、让了也没损失）。抢一个"下了半天
  又不支持续传"的任务等于让它从头下 —— 那种情况宁可不抢，排队等。
- 被让位的任务**保留已下载分片**，槽位一空就自动续传，界面上显示「已让位 · 排队续传」，
  不需要手动点「继续」。
- **60 秒冷却**：同一个任务不会被反复打断；冷却窗口内后到的一方正常排队。
- 结果大致是 `先到的一方 2 个 + 后到的一方 1 个`，而不是"后到的一个都跑不了"。

两点需要注意：

- 标识的粒度是**浏览器**而不是设备 —— 同一台电脑的 Safari 与 Chrome 各算一台，
  这与 B 站 `SESSDATA` 的粒度一致。清掉浏览器数据就换了新身份，旧记录不会消失，
  只是变成「其他设备的记录」仍可查看。
- 这是**防误伤，不是防人**：服务端没有登录，知道地址的人可以伪造标识。
  家庭内网够用；要把它暴露到公网请自行加一层访问控制（反向代理认证等）。
- 不带设备标识的客户端（自己写的脚本、未升级的旧页面缓存）创建的任务**不会**出现在你的
  列表里；反过来，你的任务也不会出现在它那里 —— 它那一侧的行为是"看得到全部"，
  这是为了升级后端不让旧前端变成空白页。

同一个文件不会被两个设备同时下载：去重是**跨设备**判定的 ——
否则两个任务会写同一个临时文件，造成内容交错甚至文件损坏，这是数据安全底线。

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

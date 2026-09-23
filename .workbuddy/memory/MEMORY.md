# douyin-download 项目长期笔记

## B站直链下载：PCDN 节点会 403（v2.3.1.1 已修）

- B站 `playurl` API 会把部分码率变体调度到第三方 PCDN 边缘节点
  （`*.mcdn.bilivideo.cn:8082` / `*.edge.mountaintoys.cn:4483`，返回体里 `os=mcdn`）。
  这类节点按 IP + 会话授权，稳定性差，**实测会直接返回 403**。
- **判断依据**：失败请求全落在上述主机；同一视频其它变体的官方 `upos-*` 主机正常。
- **干扰项**：失败 URL 都带 `lrs=79`，极易被误判为原因；实测官方 CDN 成功请求同为
  `lrs=79`，故 lrs 只是与 PCDN 主机伴生的调度参数。
- **修复要点**（见 `extractors/media_urls.py`）：
  1. 解析时汇总 `baseUrl` + `backupUrl`，**官方 CDN 优先、PCDN 垫底**；
     原实现只取 `baseUrl`、完全忽略 `backupUrl`，是必然失败的根因。
  2. 下载被拒时按「原地址 → 备份 → 官方镜像改写」换源重试；
     **官方 `upos-*` 镜像接受 PCDN 的同一份签名路径（实测 6/6）**，主机改写即可救活。
  3. 下载阶段必须透传 SESSDATA（解析带 Cookie、下载不带会让登录态高码率流被判未授权）。
- 官方镜像候选（实测可用）：`upos-sz-mirrorcos` / `mirrorhw` / `estghw` / `estgcos` /
  `estgoss` / `mirrorali` + `upos-sz-mirrorcoso1` / `mirrorhwo1`。

## 已知未处理项（供后续排期）

- `extractors/bilibili.py` 注释写"优先保留 AVC (H.264)"，但 `seen_qids` 只做去重，
  实际保留了 dash 返回的第一个变体，可能是 HEVC（如 id=16 首项为 hvc1）。
  未改动（超出当次修复范围），需要的话按 qid 分组内优先 avc 即可。
- 客户端仍为 arm64 单架构、PyInstaller 默认图标、adhoc 签名未公证、
  onefile + .app（PyInstaller v7 将变 error）、前端图标走外网 CDN、首页含第三方广告脚本。

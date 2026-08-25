# ☁️ Cloudflare Pages & Workers 部署指南

本项目已原生支持 **Cloudflare Pages（全栈托管）** 与 **Cloudflare Workers（独立 API）** 两种部署方案。

借助 Cloudflare 全球边缘计算网络，你可以**零服务器成本（每天 10 万次免费请求）、零运维、免去跨域与防盗链限制**，快速部署属于自己的抖音解析下载网站。

---

## 🌟 方案一：Cloudflare Pages 全栈一键部署（最推荐）

> **优势**：静态前端 + 后端 API 位于同一个域名下，无需配置跨域，免维护，支持 GitHub 自动持续部署（Git Push 自动发布）。

### 部署步骤：

1. **推送代码到 GitHub**：
   确保你的仓库中包含 `static/` 目录和 `functions/` 目录。

2. **登录 Cloudflare 控制台**：
   * 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
   * 点击左侧菜单 **Compute (Workers) > Workers & Pages**。
   * 点击 **Create** 按钮，选择 **Pages** 标签页，点击 **Connect to Git**。

3. **配置项目**：
   * 选择你的 GitHub 仓库 `douyin-download`。
   * **Framework preset (框架预设)**: 选择 `None`。
   * **Build output directory (构建输出目录)**: 填写 `static`（⚠️ 必填，代表前端静态资源所在目录）。
   * **Root directory (根目录)**: 留空即可。

4. **完成部署**：
   * 点击 **Save and Deploy**。
   * 几十秒后构建完成，Cloudflare 会自动为你分配一个免费二级域名（如 `https://douyin-download.pages.dev`）。
   * 直接打开该网址即可使用完整功能（解析、下载、音乐提取、图集预览全支持）。

---

## ⚡ 方案二：Cloudflare Workers 独立 API 部署

> **适用场景**：前端托管在 GitHub Pages / 自己的个人博客 / 独立域名，而后端 API 单独运行在 Cloudflare Workers 上。

### 方式 A：通过 Cloudflare 网页控制台部署（最简单）

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages** -> **Create application** -> **Create Worker**。
2. 设置名称（如 `douyin-api`），点击 **Deploy**。
3. 点击 **Edit code**，将本项目根目录下 `cloudflare/worker.js` 中的全部代码复制并粘贴覆盖到编辑器中。
4. 点击右上角 **Save and deploy**。
5. 你将获得一个 Worker 访问地址（例如 `https://douyin-api.your-name.workers.dev`）。

### 方式 B：使用 Wrangler CLI 命令行部署

在项目本地终端执行：

```bash
# 1. 进入 cloudflare 目录
cd cloudflare

# 2. 登录 Cloudflare（首次需要）
npx wrangler login

# 3. 发布 Worker
npx wrangler deploy
```

### 关联前端（例如 GitHub Pages）

如果你的前端托管在 GitHub Pages 或其他静态主机，可以通过以下任意一种方式指定 Worker API 地址：

- **方法 1（HTML 全局变量）**：在 `static/index.html` 的 `<head>` 中添加：
  ```html
  <script>
    window.API_BASE_URL = "https://douyin-api.your-name.workers.dev";
  </script>
  ```
- **方法 2（浏览器控制台持久化）**：在浏览器开发者工具控制台中执行：
  ```javascript
  localStorage.setItem("API_BASE_URL", "https://douyin-api.your-name.workers.dev");
  ```

---

## 🔍 接口测试与验证

部署成功后，可使用 `curl` 或 Postman 进行健康检查与接口测试：

### 1. 健康检查
```bash
curl https://<你的域名>/health
```
**返回示例**：
```json
{
  "status": "ok",
  "service": "douyin-download-pages",
  "runtime": "Cloudflare Pages Functions",
  "version": "1.0.0"
}
```

### 2. 解析视频 / 图集
```bash
curl -X POST "https://<你的域名>/api/parse" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/xxxxxx/"}'
```

---

## ❓ 常见问题

1. **每天免费额度是多少？**
   * Cloudflare Workers / Pages Functions 免费版提供 **100,000 次请求/天**，个人和小型团队使用完全充裕。
2. **遇到个别视频解析超时或报错怎么办？**
   * 脚本内置了多组官方 Feed API 备用轮询与 H5 SSR HTML 兜底提取策略，最大程度保障解析成功率。

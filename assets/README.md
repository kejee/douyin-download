# 应用图标资产

UniversalDownloader 的图标源与产物。改图标只需动 `icon.svg`，其余全部重新生成。

## 文件

| 文件 | 作用 | 是否入库 |
|---|---|---|
| `icon.svg` | **唯一真源**。1024 画布的生产级可编辑矢量 | 是 |
| `icon.png` | 1024×1024 位图，供不支持 SVG 的场景使用 | 是 |
| `icon.icns` | macOS 图标包，打包时由 `desktop.spec` 自动拾取 | 是 |
| `icon.ico` | Windows 图标（需 Pillow，本地生成） | 否 |

## 重新生成

```bash
# 1) 矢量 → 1024 位图
python3 scripts/render_svg.py --svg assets/icon.svg --out assets/icon.png --size 1024

# 2) 位图/矢量 → icns（每一档尺寸独立栅格化，16/32px 更锐利）
python3 scripts/build_app_icon.py --svg assets/icon.svg

# 3) 重新打包
PYINSTALLER_CONFIG_DIR=/tmp/pyi_cfg pyinstaller desktop.spec --noconfirm
```

## 设计规范

**画布与安全区**：1024×1024 画布；底板 824×824 居中，四周留 100 的安全边距（macOS 图标约定）；底板圆角 185。

**颜色**：底板主渐变直接取自前端 UI 的 `--primary-gradient`，保证 Dock 里的图标与界面同源同调。

| 用途 | 色值 |
|---|---|
| 渐变起点（左上） | `#6366F1` |
| 渐变 46% | `#8B5CF6` |
| 渐变 78% | `#A855F7` |
| 渐变终点（右下） | `#D946EF` |
| 符号 | `#FFFFFF`（纯白） |
| 底板投影 | `#1E1B4B` 38% |
| 符号投影 | `#2E1065` 28% |

**符号**：下落箭头 + 承接托盘，笔画 62（≈ 1024 的 6%），圆头端点、圆角拐点。符号整体包围盒 316×534，在底板内水平垂直居中。

**尺寸档位**：`icon.svg` 是主图标（≥128px 使用）。若需要在界面内做品牌标记，建议从同一套几何关系派生 24×24 的线性版本，笔画取 2px。

## 踩过的坑

- **SVG 注释里不能出现双连字符**。写 `--primary-gradient` 这类 CSS 变量名会让 WebKit（QuickLook / Safari / 应用自身的 WKWebView）直接拒绝渲染，而 Chrome 的 HTML 解析器不会报错，问题很难发现。`render_svg.py` 已加 XML 预校验。
- **渲染后端优先用 `qlmanage`**。它调用系统 QuickLook，不受「用户正开着浏览器」影响。Chrome headless 在浏览器已打开时会被单例机制挂住（无论是否指定 `--user-data-dir`）。

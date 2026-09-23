#!/usr/bin/env python3
"""把 SVG 渲染成 PNG（保留透明背景），用于生成应用图标。

用法：
    python3 scripts/render_svg.py --svg assets/icon.svg --out assets/icon.png
    python3 scripts/render_svg.py --svg assets/icon.svg --out /tmp/preview.png --size 512

渲染后端（按顺序尝试，第一个成功的胜出）：
  1. **qlmanage** —— macOS 自带 QuickLook，纯系统组件。不受「用户正开着浏览器」影响，
     实测最稳；输出带 alpha 通道。
  2. **Chrome headless** —— 兜底。注意两点坑：必须是旧的 `--headless`（新模式截图会挂住），
     且**不要**指定 `--user-data-dir`（指向新目录时 Chrome 会卡在初始化上）。

渲染前会做 XML 合法性校验：SVG 是 XML 方言，注释里出现双连字符等写法会让
WebKit / QuickLook / WKWebView 直接拒绝渲染（Chrome 的 HTML 解析器反而宽容，
容易漏掉这类问题）。
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
)

HTML_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{ margin: 0; padding: 0; background: transparent; }}
  #stage {{ width: {size}px; height: {size}px; }}
  #stage svg {{ display: block; width: {size}px; height: {size}px; }}
</style>
</head>
<body><div id="stage">{svg}</div></body>
</html>
"""


def fail(message: str, hint: str = "") -> "None":
    print(f"[错误] {message}", file=sys.stderr)
    if hint:
        print(f"       {hint}", file=sys.stderr)
    raise SystemExit(1)


def probe_png_size(path: pathlib.Path) -> tuple:
    """不依赖第三方库读取 PNG 宽高（IHDR 在第 16..24 字节）"""
    with path.open("rb") as f:
        head = f.read(26)
    if len(head) < 26 or head[:8] != b"\x89PNG\r\n\x1a\n":
        return 0, 0
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def probe_png_alpha(path: pathlib.Path) -> str:
    """读取 PNG 的 color type，判断是否带 alpha 通道（6=RGBA, 4=灰度+A）"""
    with path.open("rb") as f:
        head = f.read(26)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return "不是 PNG"
    return {
        0: "灰度无透明",
        2: "RGB 无透明（背景不透明，图标会出现白底方块）",
        3: "索引色",
        4: "灰度+透明",
        6: "RGBA 带透明通道",
    }.get(head[25], f"未知({head[25]})")


def validate_xml(svg_path: pathlib.Path) -> None:
    """SVG 必须先是合法 XML —— WebKit 系渲染器对此零容忍"""
    try:
        ET.parse(svg_path)
    except ET.ParseError as exc:
        fail(
            f"SVG 不是合法的 XML：{exc}",
            "常见原因：注释里出现了双连字符（XML 注释内禁止 '--'，"
            "例如写 CSS 变量名 primary-gradient 时带上两个短横线）；"
            "或标签/属性未闭合。WebKit（Safari / QuickLook / WKWebView）会直接拒绝渲染。",
        )


def normalise_size(path: pathlib.Path, size: int) -> None:
    """把渲染结果归一到精确的 size×size（渲染器可能给出略有偏差的缩略图）"""
    width, height = probe_png_size(path)
    if (width, height) != (size, size):
        subprocess.run(
            ["sips", "-z", str(size), str(size), str(path), "--out", str(path)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )


def render_with_qlmanage(svg_path: pathlib.Path, out_path: pathlib.Path, size: int) -> bool:
    """macOS QuickLook：系统自带，最稳定"""
    qlmanage = shutil.which("qlmanage") or "/usr/bin/qlmanage"
    if not pathlib.Path(qlmanage).is_file():
        return False
    with tempfile.TemporaryDirectory(prefix="ud_ql_") as tmp:
        work = pathlib.Path(tmp)
        staged = work / "icon.svg"
        shutil.copy2(svg_path, staged)
        try:
            subprocess.run(
                [qlmanage, "-t", "-s", str(size), "-o", str(work), str(staged)],
                check=False, capture_output=True, timeout=90,
            )
        except subprocess.TimeoutExpired:
            return False
        produced = work / "icon.svg.png"
        if not produced.is_file() or produced.stat().st_size == 0:
            return False
        shutil.move(str(produced), str(out_path))
    normalise_size(out_path, size)
    return True


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if pathlib.Path(path).is_file():
            return path
    return shutil.which("google-chrome") or shutil.which("chromium") or ""


def render_with_chrome(svg_path: pathlib.Path, out_path: pathlib.Path, size: int) -> bool:
    chrome = find_chrome()
    if not chrome:
        return False
    with tempfile.TemporaryDirectory(prefix="ud_svg_") as tmp:
        page = pathlib.Path(tmp) / "stage.html"
        page.write_text(
            HTML_TEMPLATE.format(size=size, svg=svg_path.read_text(encoding="utf-8")),
            encoding="utf-8",
        )
        cmd = [
            chrome,
            "--headless",           # 不能换成 --headless=new：截图模式会长时间不返回
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={size},{size}",
            f"--screenshot={out_path}",
            page.as_uri(),
        ]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired:
            return False
    return out_path.is_file() and out_path.stat().st_size > 0


def render(svg_path: pathlib.Path, out_path: pathlib.Path, size: int) -> str:
    """渲染并返回实际使用的后端名"""
    validate_xml(svg_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.unlink(missing_ok=True)

    for name, fn in (("qlmanage", render_with_qlmanage), ("chrome", render_with_chrome)):
        if fn(svg_path, out_path, size):
            return name
    fail(f"渲染失败：qlmanage 与 Chrome 都没能产出 {size}px 图"
         "（Chrome 在浏览器已打开时容易卡住，qlmanage 是首选）")


def main() -> None:
    parser = argparse.ArgumentParser(description="渲染 SVG 为透明背景 PNG")
    parser.add_argument("--svg", required=True, help="输入 SVG 路径")
    parser.add_argument("--out", required=True, help="输出 PNG 路径")
    parser.add_argument("--size", type=int, default=1024, help="输出边长，默认 1024")
    args = parser.parse_args()

    svg_path = pathlib.Path(args.svg).expanduser().resolve()
    if not svg_path.is_file():
        fail(f"找不到 {svg_path}")

    out_path = pathlib.Path(args.out).expanduser().resolve()
    backend = render(svg_path, out_path, args.size)
    print(f"[输出] {out_path}  {out_path.stat().st_size / 1024:.0f} KB  "
          f"{args.size}x{args.size}  后端={backend}")
    print(f"[通道] {probe_png_alpha(out_path)}")


if __name__ == "__main__":
    main()

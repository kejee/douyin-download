#!/usr/bin/env python3
"""把应用图标源文件转成各平台图标（macOS .icns / Windows .ico）。

两种用法：

    # 推荐：直接从矢量源生成（每一档尺寸独立栅格化，小尺寸更锐利）
    python3 scripts/build_app_icon.py --svg assets/icon.svg

    # 也可以用位图源
    python3 scripts/build_app_icon.py --source ~/Desktop/logo.png

默认源：存在 assets/icon.svg 就用它，否则用 assets/icon.png。

生成后重新打包即可生效，desktop.spec 会自动拾取 assets/ 下的图标：
    PYINSTALLER_CONFIG_DIR=/tmp/pyi_cfg pyinstaller desktop.spec --noconfirm

说明：
- 走 SVG 时，每一档尺寸都按 4 倍超采样（内部先渲染 4×，再用 sips 缩到目标），
  比「从 1024 一路缩到 16」锐利得多 —— 16/32px 档位差别最明显。
- macOS 的 .icns 依赖系统自带的 sips + iconutil，无需第三方库；
  SVG 栅格化依赖本机 Chrome（见 scripts/render_svg.py）。
- Windows 的 .ico 需要 Pillow（pip install pillow），缺失时只生成 .icns。
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from render_svg import render as render_svg_png  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent

# macOS iconset 需要的全部尺寸（name, 像素边长）
ICONSET_SIZES = (
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
)

# 超采样倍数与上限（上限即源矢量栅格化的最高分辨率）
SUPERSAMPLE = 4
MAX_RENDER = 1024


def fail(message: str) -> "None":
    print(f"[错误] {message}", file=sys.stderr)
    raise SystemExit(1)


def probe_png_size(path: pathlib.Path) -> tuple:
    """不依赖第三方库读取 PNG 宽高（IHDR 在第 16..24 字节）"""
    with path.open("rb") as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"{path} 不是有效的 PNG 文件")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def have_icns_tools() -> bool:
    if sys.platform != "darwin":
        print("[跳过] .icns 只能在 macOS 上生成（依赖 sips / iconutil）")
        return False
    for tool in ("sips", "iconutil"):
        if shutil.which(tool) is None:
            print(f"[跳过] 未找到系统工具 {tool}")
            return False
    return True


def make_iconset_dir(target: pathlib.Path) -> pathlib.Path:
    iconset = target.parent / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    return iconset


def resize(src: pathlib.Path, dst: pathlib.Path, size: int) -> None:
    subprocess.run(
        ["sips", "-z", str(size), str(size), str(src), "--out", str(dst)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def pack_iconset(iconset: pathlib.Path, target: pathlib.Path) -> None:
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(target)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    shutil.rmtree(iconset, ignore_errors=True)


def build_icns_from_svg(svg: pathlib.Path, target: pathlib.Path) -> bool:
    """按每个目标尺寸独立栅格化（4× 超采样），而不是从 1024 一路缩小"""
    if not have_icns_tools():
        return False

    iconset = make_iconset_dir(target)
    # 同一档位会被多个条目复用（如 32 同时是 16@2x 与 32x32），先算出去重后的渲染尺寸
    render_sizes = sorted({min(size * SUPERSAMPLE, MAX_RENDER) for _, size in ICONSET_SIZES})
    print(f"[渲染] {svg.name} → {len(render_sizes)} 档超采样 "
          f"({', '.join(str(s) for s in render_sizes)})")

    staged: dict[int, pathlib.Path] = {}
    for render_size in render_sizes:
        out = iconset / f"_ss{render_size}.png"
        render_svg_png(svg, out, render_size)
        staged[render_size] = out

    for name, size in ICONSET_SIZES:
        resize(staged[min(size * SUPERSAMPLE, MAX_RENDER)], iconset / name, size)

    pack_iconset(iconset, target)
    return True


def build_icns_from_png(source: pathlib.Path, target: pathlib.Path) -> bool:
    if not have_icns_tools():
        return False
    iconset = make_iconset_dir(target)
    for name, size in ICONSET_SIZES:
        resize(source, iconset / name, size)
    pack_iconset(iconset, target)
    return True


def build_ico(source: pathlib.Path, target: pathlib.Path) -> bool:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        print("[跳过] .ico 需要 Pillow：pip install pillow")
        return False
    image = Image.open(source).convert("RGBA")
    image.save(target, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="生成应用图标 (.icns / .ico)")
    parser.add_argument("--svg", default="", help="矢量源，推荐：assets/icon.svg")
    parser.add_argument("--source", default="", help="位图源 PNG，例如 assets/icon.png")
    parser.add_argument("--out-dir", default="", help="输出目录，默认与源文件同目录")
    args = parser.parse_args()

    # 默认策略：优先矢量源
    svg = pathlib.Path(args.svg).expanduser().resolve() if args.svg else ROOT / "assets" / "icon.svg"
    png_arg = pathlib.Path(args.source).expanduser().resolve() if args.source else None

    use_svg = svg.is_file() and png_arg is None
    if not use_svg and png_arg is None:
        fallback_png = ROOT / "assets" / "icon.png"
        if fallback_png.is_file():
            png_arg = fallback_png
        else:
            fail("既没有 assets/icon.svg，也没有 assets/icon.png\n"
                 "      请用 --svg 或 --source 指定图标源文件")

    out_dir = (pathlib.Path(args.out_dir).expanduser().resolve() if args.out_dir
               else (svg if use_svg else png_arg).parent)
    out_dir.mkdir(parents=True, exist_ok=True)

    if use_svg:
        print(f"[输入] {svg}（矢量，按尺寸独立栅格化）")
    else:
        width, height = probe_png_size(png_arg)
        print(f"[输入] {png_arg}  {width}x{height}")
        if width != height:
            fail("源图必须是正方形（宽高相等）")
        if width < 512:
            print(f"[提示] 源图仅 {width}px，建议至少 1024px，否则大尺寸图标会模糊")

    made = []
    icns_ok = (build_icns_from_svg(svg, out_dir / "icon.icns") if use_svg
               else build_icns_from_png(png_arg, out_dir / "icon.icns"))
    if icns_ok:
        made.append(out_dir / "icon.icns")

    # .ico 从一张 256 位图派生（矢量源时先落到临时 PNG）
    ico_src = png_arg
    if use_svg:
        ico_src = out_dir / "_ico_src.png"
        render_svg_png(svg, ico_src, 256)
    if build_ico(ico_src, out_dir / "icon.ico"):
        made.append(out_dir / "icon.ico")
    if use_svg and ico_src and ico_src.name == "_ico_src.png":
        ico_src.unlink(missing_ok=True)

    if not made:
        fail("没有生成任何图标文件，请检查上方的跳过原因")
    for path in made:
        print(f"[输出] {path}  {path.stat().st_size / 1024:.0f} KB")
    print("\n完成。重新打包即可生效："
          "\n  PYINSTALLER_CONFIG_DIR=/tmp/pyi_cfg pyinstaller desktop.spec --noconfirm")


if __name__ == "__main__":
    main()

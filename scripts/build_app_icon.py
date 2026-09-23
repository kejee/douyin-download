#!/usr/bin/env python3
"""把一张方形 PNG 转成各平台的应用图标（macOS .icns / Windows .ico）。

用法：
    # 1) 准备一张 1024x1024 的方形 PNG，放到 assets/icon.png
    # 2) 执行本脚本，会就地生成 assets/icon.icns（Windows 上生成 icon.ico）
    python3 scripts/build_app_icon.py

    # 也可以指定源图与输出
    python3 scripts/build_app_icon.py --source ~/Desktop/logo.png

生成后重新打包即可，desktop.spec 会自动拾取 assets/ 下的图标；
图标缺失时回落到 PyInstaller 默认图标并在构建日志里给出提示。

说明：
- macOS 的 .icns 依赖系统自带的 sips + iconutil，无需装任何第三方库；
- Windows 的 .ico 需要 Pillow（pip install pillow），缺失时只生成 .icns；
- 源图建议 1024x1024、圆角留白自备（macOS 不会自动加圆角遮罩）。
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys

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


def build_icns(source: pathlib.Path, target: pathlib.Path) -> bool:
    if sys.platform != "darwin":
        print("[跳过] .icns 只能在 macOS 上生成（依赖 sips / iconutil）")
        return False
    for tool in ("sips", "iconutil"):
        if shutil.which(tool) is None:
            print(f"[跳过] 未找到系统工具 {tool}")
            return False

    iconset = target.parent / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)

    for name, size in ICONSET_SIZES:
        subprocess.run(
            ["sips", "-z", str(size), str(size), str(source), "--out", str(iconset / name)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(target)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    shutil.rmtree(iconset, ignore_errors=True)
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
    parser.add_argument("--source", default=str(pathlib.Path(__file__).resolve().parent.parent
                                                / "assets" / "icon.png"),
                        help="源 PNG 路径，默认 assets/icon.png")
    parser.add_argument("--out-dir", default="",
                        help="输出目录，默认与源文件同目录")
    args = parser.parse_args()

    source = pathlib.Path(args.source).expanduser().resolve()
    if not source.is_file():
        fail(f"未找到源图 {source}\n"
             f"      请放一张 1024x1024 的方形 PNG 到 assets/icon.png，或用 --source 指定路径")

    width, height = probe_png_size(source)
    print(f"[输入] {source}  {width}x{height}")
    if width != height:
        fail("源图必须是正方形（宽高相等）")
    if width < 512:
        print(f"[提示] 源图仅 {width}px，建议至少 1024px，否则大尺寸图标会模糊")

    out_dir = pathlib.Path(args.out_dir).expanduser().resolve() if args.out_dir else source.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    made = []
    if build_icns(source, out_dir / "icon.icns"):
        made.append(out_dir / "icon.icns")
    if build_ico(source, out_dir / "icon.ico"):
        made.append(out_dir / "icon.ico")

    if not made:
        fail("没有生成任何图标文件，请检查上方的跳过原因")
    for path in made:
        print(f"[输出] {path}  {path.stat().st_size / 1024:.0f} KB")
    print("\n完成。重新打包即可生效："
          "\n  PYINSTALLER_CONFIG_DIR=/tmp/pyi_cfg pyinstaller desktop.spec --noconfirm")


if __name__ == "__main__":
    main()

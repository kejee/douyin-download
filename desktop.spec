# -*- mode: python ; coding: utf-8 -*-
"""桌面客户端打包配置（onedir 模式）。

关键点：
1. **onedir**：PyInstaller 6.x 已明确警告「onefile 与 macOS .app 组合不合理」
   （单一文件不可能同时是一个 bundle），并声明 v7 会变成硬错误；且 onefile
   每次启动都要解压 ~70MB（内嵌 ffmpeg 占大头），冷启动明显更慢。改为 onedir。
2. 内嵌静态 ffmpeg（imageio-ffmpeg 提供）到 ffmpeg_bin/，B站 DASH 混流开箱可用。
3. upx 必须为 False —— UPX 在 macOS 不受支持，且会破坏内嵌二进制。
4. 图标从 assets/ 自动拾取；缺失时回落到 PyInstaller 默认图标并打印提示。
   用 scripts/build_app_icon.py 从一张 1024x1024 PNG 生成 icon.icns。
"""

import os
import shutil
import sys
import tempfile

block_cipher = None

APP_VERSION = "2.5.9.0"

FFMPEG_EXE_NAME = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"


def _asset(*candidates: str) -> str:
    """按顺序在 assets/ 下找第一个存在的资源，找不到返回 None"""
    for name in candidates:
        path = os.path.join(SPECPATH, "assets", name)
        if os.path.isfile(path):
            return path
    return None


def stage_ffmpeg() -> str:
    """把 imageio-ffmpeg 提供的静态二进制改名成 ffmpeg 后返回暂存路径"""
    import imageio_ffmpeg

    stage_dir = os.path.join(tempfile.gettempdir(), "ud_ffmpeg_stage")
    os.makedirs(stage_dir, exist_ok=True)
    dst = os.path.join(stage_dir, FFMPEG_EXE_NAME)
    shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), dst)
    os.chmod(dst, 0o755)
    print(f"[spec] 内嵌 ffmpeg: {dst} ({os.path.getsize(dst) / 1024 / 1024:.1f} MB)")
    return dst


if sys.platform == "darwin":
    ICON = _asset("icon.icns", "icon.png")
elif sys.platform == "win32":
    ICON = _asset("icon.ico", "icon.png")
else:
    ICON = _asset("icon.png")

if ICON:
    print(f"[spec] 应用图标: {ICON}")
else:
    print("[spec] assets/ 下没有图标，将使用 PyInstaller 默认图标"
          "（可执行 scripts/build_app_icon.py 从一张 1024x1024 PNG 生成 icon.icns）")

added_files = [
    ('static', 'static'),
    ('extractors', 'extractors'),
    ('downloader', 'downloader'),
]

added_binaries = [(stage_ffmpeg(), 'ffmpeg_bin')]

a = Analysis(
    ['desktop.py'],
    pathex=[],
    binaries=added_binaries,
    datas=added_files,
    hiddenimports=[
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
        'httpx',
        'webview',
        'yt_dlp',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# onedir：EXE 只负责引导，依赖与数据交由 COLLECT 收集
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='UniversalDownloader',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None if sys.platform == 'darwin' else ICON,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='UniversalDownloader',
)

if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='UniversalDownloader.app',
        icon=ICON,
        bundle_identifier='com.universal.downloader',
        version=APP_VERSION,
        info_plist={
            'CFBundleShortVersionString': APP_VERSION,
            'CFBundleVersion': APP_VERSION,
            # 最低系统版本取包内二进制的实际 minos：内嵌 ffmpeg 为 12.0
            # （主程序与 libpython 是 11.0，ffmpeg 最高，故取 12.0）。
            # 显式声明后，低版本系统会给出版本提示，而不是启动时莫名失败。
            'LSMinimumSystemVersion': '12.0',
            'NSHighResolutionCapable': 'True',
            'LSBackgroundOnly': 'False',
            'NSRequiresAquaSystemAppearance': 'False',
        }
    )

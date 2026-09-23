# -*- mode: python ; coding: utf-8 -*-
"""桌面客户端打包配置。

关键点：
1. 内嵌静态 ffmpeg（由 imageio-ffmpeg 提供）到 ffmpeg_bin/，客户端开箱即用
   B站 DASH 音视频混流，不再依赖用户本机是否装了 ffmpeg；
2. upx 必须为 False —— UPX 在 macOS 不受支持，且会破坏内嵌二进制；
3. 版本号写入 Info.plist 的 CFBundleShortVersionString（否则 Finder 显示 0.0.0）。
"""

import os
import shutil
import sys
import tempfile

block_cipher = None

APP_VERSION = "2.3.1.1"

FFMPEG_EXE_NAME = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"


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

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='UniversalDownloader',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='UniversalDownloader.app',
        icon=None,
        bundle_identifier='com.universal.downloader',
        version=APP_VERSION,
        info_plist={
            'CFBundleShortVersionString': APP_VERSION,
            'CFBundleVersion': APP_VERSION,
            'NSHighResolutionCapable': 'True',
            'LSBackgroundOnly': 'False',
            'NSRequiresAquaSystemAppearance': 'False',
        }
    )

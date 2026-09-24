// 全局状态与 DOM 元素
const urlInput = document.getElementById("urlInput");
const pasteBtn = document.getElementById("pasteBtn");
const clearBtn = document.getElementById("clearBtn");
const parseBtn = document.getElementById("parseBtn");
const skeletonLoading = document.getElementById("skeletonLoading");
const resultContainer = document.getElementById("resultContainer");
const toastContainer = document.getElementById("toastContainer");

// 免责声明弹窗
const disclaimerModal = document.getElementById("disclaimerModal");
const openDisclaimerBtn = document.getElementById("openDisclaimerBtn");
const closeDisclaimerBtn = document.getElementById("closeDisclaimerBtn");
const acceptDisclaimerBtn = document.getElementById("acceptDisclaimerBtn");
const footerDisclaimerLink = document.getElementById("footerDisclaimerLink");

// Toast 提示函数
function showToast(message, type = "info", duration = 3000) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// B站 SESSDATA 凭证管理
function getBiliSessdata() {
    return (localStorage.getItem("bili_sessdata") || "").trim();
}

function setBiliSessdata(val) {
    if (val && val.trim()) {
        localStorage.setItem("bili_sessdata", val.trim());
    } else {
        localStorage.removeItem("bili_sessdata");
    }
    updateBiliHelperBars();
}

function clearBiliSessdata() {
    localStorage.removeItem("bili_sessdata");
    updateBiliHelperBars();
}

// 检查输入是否为 B站链接并更新专属胶囊提示栏 (方案 1)
function checkBiliInput(text, barElement) {
    if (!barElement) return;
    const isBili = text && (text.includes("bilibili.com") || text.includes("b23.tv") || text.includes("bili2233.cn") || /BV[a-zA-Z0-9]{10}/i.test(text));
    if (isBili) {
        barElement.style.display = "flex";
        const hasSess = !!getBiliSessdata();
        if (hasSess) {
            barElement.innerHTML = `
                <div class="bili-helper-left">
                    <i class="fa-solid fa-tv" style="color: #10b981;"></i>
                    <span style="color: #10b981; font-weight: 500;">B站画质通道：🟢 已解锁 1080P/4K 高清</span>
                </div>
                <button type="button" class="btn-text-muted" onclick="openBiliModal()">修改/清除</button>
            `;
        } else {
            barElement.innerHTML = `
                <div class="bili-helper-left">
                    <i class="fa-solid fa-tv text-gradient"></i>
                    <span>B站画质提示：当前为访客画质 (最高480P)</span>
                </div>
                <button type="button" class="btn-text-cyan" onclick="openBiliModal()">⚙️ 配置 SESSDATA 解锁 1080P/4K</button>
            `;
        }
    } else {
        barElement.style.display = "none";
    }
}

function updateBiliHelperBars() {
    const biliHelperBar = document.getElementById("biliHelperBar");
    const biliCreatorHelperBar = document.getElementById("biliCreatorHelperBar");
    if (urlInput) checkBiliInput(urlInput.value, biliHelperBar);
    if (creatorUrlInput) checkBiliInput(creatorUrlInput.value, biliCreatorHelperBar);
}

// 监听单作品与博主输入框变化
urlInput.addEventListener("input", () => {
    if (urlInput.value.trim().length > 0) {
        clearBtn.style.display = "inline-flex";
    } else {
        clearBtn.style.display = "none";
    }
    checkBiliInput(urlInput.value, document.getElementById("biliHelperBar"));
});

// 清空按钮
clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.style.display = "none";
    checkBiliInput("", document.getElementById("biliHelperBar"));
    urlInput.focus();
});

// ==========================================================================
// 剪贴板读取
// 桌面端的 WKWebView 会直接拒绝 navigator.clipboard.readText()，而且系统设置里
// 没有可以授权的开关 —— 只能由 Python 侧读系统剪贴板。浏览器环境再回退到
// 标准 Clipboard API。
// ==========================================================================
async function readClipboardText() {
    if (hasNativeApi() && window.pywebview.api.read_clipboard) {
        try {
            const text = await window.pywebview.api.read_clipboard();
            if (text) return text;
        } catch (e) {
            console.warn("原生剪贴板读取失败，回退浏览器 API:", e);
        }
    }
    return await navigator.clipboard.readText();
}

// 粘贴按钮
pasteBtn.addEventListener("click", async () => {
    try {
        const text = await readClipboardText();
        if (text) {
            urlInput.value = text;
            clearBtn.style.display = "inline-flex";
            checkBiliInput(text, document.getElementById("biliHelperBar"));
            showToast("已从剪贴板粘贴内容", "success");
        } else {
            showToast("剪贴板为空", "info");
        }
    } catch (err) {
        showToast("无法访问剪贴板，请手动粘贴", "error");
    }
});

// B站配置弹窗逻辑
const biliConfigModal = document.getElementById("biliConfigModal");
const biliSessdataInput = document.getElementById("biliSessdataInput");
const toggleBiliGuideBtn = document.getElementById("toggleBiliGuideBtn");
const biliGuideBox = document.getElementById("biliGuideBox");
const toggleSessdataEyeBtn = document.getElementById("toggleSessdataEyeBtn");
const closeBiliModalBtn = document.getElementById("closeBiliModalBtn");
const cancelBiliModalBtn = document.getElementById("cancelBiliModalBtn");
const saveBiliModalBtn = document.getElementById("saveBiliModalBtn");
const clearBiliModalBtn = document.getElementById("clearBiliModalBtn");

function openBiliModal() {
    if (!biliConfigModal) return;
    biliSessdataInput.value = getBiliSessdata();
    biliConfigModal.classList.add("active");
}

function closeBiliModal() {
    if (!biliConfigModal) return;
    biliConfigModal.classList.remove("active");
}

if (closeBiliModalBtn) closeBiliModalBtn.addEventListener("click", closeBiliModal);
if (cancelBiliModalBtn) cancelBiliModalBtn.addEventListener("click", closeBiliModal);
if (biliConfigModal) {
    biliConfigModal.addEventListener("click", (e) => {
        if (e.target === biliConfigModal) closeBiliModal();
    });
}

if (toggleBiliGuideBtn && biliGuideBox) {
    toggleBiliGuideBtn.addEventListener("click", () => {
        const isHidden = biliGuideBox.style.display === "none";
        biliGuideBox.style.display = isHidden ? "block" : "none";
        toggleBiliGuideBtn.textContent = isHidden ? "收起教程" : "如何获取？";
    });
}

if (toggleSessdataEyeBtn && biliSessdataInput) {
    toggleSessdataEyeBtn.addEventListener("click", () => {
        const isPwd = biliSessdataInput.type === "password";
        biliSessdataInput.type = isPwd ? "text" : "password";
        toggleSessdataEyeBtn.innerHTML = isPwd ? `<i class="fa-regular fa-eye-slash"></i>` : `<i class="fa-regular fa-eye"></i>`;
    });
}

if (saveBiliModalBtn) {
    saveBiliModalBtn.addEventListener("click", () => {
        const val = biliSessdataInput.value.trim();
        setBiliSessdata(val);
        closeBiliModal();
        if (val) {
            showToast("B站 SESSDATA 凭证保存成功！已启用 1080P/4K 高清画质通道", "success");
            // 如果当前已有单作品解析输入且为 B站，自动刷新重新解析
            if (urlInput && urlInput.value && (urlInput.value.includes("bilibili.com") || urlInput.value.includes("b23.tv"))) {
                parseBtn.click();
            }
        } else {
            showToast("已清空 SESSDATA 凭证，恢复为默认访客画质", "info");
        }
    });
}

if (clearBiliModalBtn) {
    clearBiliModalBtn.addEventListener("click", () => {
        biliSessdataInput.value = "";
        clearBiliSessdata();
        closeBiliModal();
        showToast("已清除 B站 SESSDATA 凭证", "info");
    });
}

// 弹窗逻辑
function openDisclaimer() {
    disclaimerModal.classList.add("active");
}
function closeDisclaimer() {
    disclaimerModal.classList.remove("active");
}

if (openDisclaimerBtn) openDisclaimerBtn.addEventListener("click", openDisclaimer);
if (footerDisclaimerLink) footerDisclaimerLink.addEventListener("click", openDisclaimer);
if (closeDisclaimerBtn) closeDisclaimerBtn.addEventListener("click", closeDisclaimer);
if (acceptDisclaimerBtn) {
    acceptDisclaimerBtn.addEventListener("click", () => {
        closeDisclaimer();
        showToast("已确认免责声明", "success");
    });
}
if (disclaimerModal) {
    disclaimerModal.addEventListener("click", (e) => {
        if (e.target === disclaimerModal) closeDisclaimer();
    });
}

// 移动端下拉菜单交互
const menuToggleBtn = document.getElementById("menuToggleBtn");
const headerDropdownMenu = document.getElementById("headerDropdownMenu");
const menuDisclaimerBtn = document.getElementById("menuDisclaimerBtn");

if (menuToggleBtn && headerDropdownMenu) {
    menuToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        headerDropdownMenu.classList.toggle("active");
    });

    if (menuDisclaimerBtn) {
        menuDisclaimerBtn.addEventListener("click", () => {
            headerDropdownMenu.classList.remove("active");
            openDisclaimer();
        });
    }

    document.addEventListener("click", (e) => {
        if (!headerDropdownMenu.contains(e.target) && !menuToggleBtn.contains(e.target)) {
            headerDropdownMenu.classList.remove("active");
        }
    });
}

// 格式化数字 (如点赞数)
function formatNumber(num) {
    if (!num) return "0";
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + "w";
    }
    return num.toLocaleString();
}

// 格式化时长 (秒 -> mm:ss 或 hh:mm:ss)
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "";
    const sec = Math.round(seconds);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 格式化体积（用于任务卡片的"已下载/总量"与缓存占用）
function formatBytes(bytes) {
    const num = Number(bytes) || 0;
    if (num < 1024) return `${num}B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = num / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)}${units[i]}`;
}

// 转义 HTML 属性/文本：视频标题来自各平台，可能含 < > " ' ，直接拼进模板会破坏结构
function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// 复制到剪贴板
async function copyToClipboard(text, label = "链接") {
    try {
        await navigator.clipboard.writeText(text);
        showToast(`已复制${label}到剪贴板`, "success");
    } catch (e) {
        const input = document.createElement("input");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        showToast(`已复制${label}到剪贴板`, "success");
    }
}

// ==========================================================================
// 媒体地址备用直链注册表
// 解析结果里每个地址（各档画质、音轨）都带有备用 CDN 直链。下载时按 URL 查表，
// 好处是无需把地址数组序列化进 onclick 字符串（转义易错、还会撑大 DOM）。
// ==========================================================================
window.urlBackups = {};

function registerUrlBackups(url, backups) {
    if (!url || !Array.isArray(backups) || backups.length === 0) return;
    const list = backups.filter(u => typeof u === "string" && u && u !== url);
    if (list.length) window.urlBackups[url] = list;
}

function backupsForUrl(url) {
    return (url && window.urlBackups[url]) || [];
}

// 队列里是否已有指向同一目标文件的活动任务
// （两个任务写同一个 save_path 会并发写同一临时文件，导致内容交错甚至丢文件）
// 目标路径 = 子目录 + 文件名，所以两者都要比，否则不同图集里的同名图片会被误判为重复。
function findActiveTaskByFilename(filename, subdir = null) {
    if (!filename) return null;
    return window.taskQueue.find(
        t => t.filename === filename
            && (t.subdir || null) === (subdir || null)
            && ['waiting', 'running', 'paused'].includes(t.status)
    ) || null;
}

// 触发下载 (统一接入任务管理器与真实流式进度)
// options.subdir: 目标子目录（同一作品产生多个文件时归到一个文件夹，如图集/合集）
function triggerDownload(url, filename, options = {}) {
    if (!url) return;
    const safeFilename = filename || "download_media.mp4";

    const dup = findActiveTaskByFilename(safeFilename, options.subdir || null);
    if (dup) {
        showToast(`「${safeFilename}」已在下载队列中，未重复添加`, "info");
        toggleTaskManager(true);
        return;
    }

    const taskId = `dl_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    window.taskQueue.push({
        id: taskId,
        title: safeFilename,
        filename: safeFilename,
        directUrl: url,
        directBackups: backupsForUrl(url),
        subdir: options.subdir || null,
        status: 'waiting',
        progress: 0,
        errorMsg: null,
    });

    window.isTaskQueuePaused = false;
    toggleTaskManager(true);
    scheduleTaskQueue();
}

// 解析主逻辑
parseBtn.addEventListener("click", async () => {
    const text = urlInput.value.trim();
    if (!text) {
        showToast("请输入或粘贴分享文案或链接", "error");
        urlInput.focus();
        return;
    }

    // 切换 Loading 状态
    parseBtn.disabled = true;
    parseBtn.querySelector(".btn-text").style.display = "none";
    parseBtn.querySelector(".btn-loader").style.display = "inline-block";
    resultContainer.style.display = "none";
    skeletonLoading.style.display = "grid";

    try {
        const sessdata = getBiliSessdata();
        const payload = { url: text };
        if (sessdata) payload.sessdata = sessdata;

        const response = await fetch("/api/parse", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.detail || data.error || "解析失败，请检查链接或稍后再试");
        }

        renderResult(data);
        showToast(`[${data.platform_name || '解析'}] 成功！`, "success");
    } catch (err) {
        showToast(err.message || "请求发生异常", "error");
    } finally {
        parseBtn.disabled = false;
        parseBtn.querySelector(".btn-text").style.display = "inline-block";
        parseBtn.querySelector(".btn-loader").style.display = "none";
        skeletonLoading.style.display = "none";
    }
});

// 模式切换
function switchMode(mode) {
    const singleTab = document.getElementById("tabSingleMode");
    const creatorTab = document.getElementById("tabCreatorMode");
    const singleInput = document.getElementById("singleInputCard");
    const creatorInput = document.getElementById("creatorInputCard");
    const resultCard = document.getElementById("resultContainer");
    const creatorResultCard = document.getElementById("creatorResultCard");

    if (mode === "single") {
        singleTab.classList.add("active");
        creatorTab.classList.remove("active");
        singleInput.style.display = "flex";
        creatorInput.style.display = "none";
        creatorResultCard.style.display = "none";
        if (window.currentMediaData && resultCard) {
            resultCard.style.display = "block";
        }
    } else {
        creatorTab.classList.add("active");
        singleTab.classList.remove("active");
        creatorInput.style.display = "flex";
        singleInput.style.display = "none";
        if (resultCard) resultCard.style.display = "none";
        if (window.currentCreatorData && creatorResultCard) {
            creatorResultCard.style.display = "flex";
        }
    }
    updateBiliHelperBars();
}

// 渲染单作品结果
function renderResult(data) {
    const resultCard = document.getElementById("resultContainer");
    if (resultCard) resultCard.style.display = "block";
    const { platform, platform_name, type, title, author, statistics, music, cover, video, images, id } = data;
    window.currentMediaData = data;
    // 每次解析都重置图集上下文，避免旧作品的标题/图片地址被新页面误用
    window.pendingGallery = null;
    const cleanTitle = title ? title.replace(/[\r\n]+/g, " ").slice(0, 60) : `${platform || 'media'}_${id}`;

    let mediaHtml = "";
    let actionsHtml = "";

    if (type === "video") {
        const noWmUrl = video.no_watermark_url;
        const wmUrl = video.watermark_url;

        const isPipixia = platform === 'pipixia';
        const isBilibili = platform === 'bilibili';
        const isTwitter = platform === 'twitter';
        const isSingleStream = platform === 'pipixia' || platform === 'kuaishou' || platform === 'xhs' || isBilibili || isTwitter;

        const audioUrl = video.audio_url || (music && music.url ? music.url : "");

        // 视频播放源
        // B站是 DASH 双轨（音视频分离），必须由后端混流后才能播。
        // 注意：**不能**把 ffmpeg 实时管道流直接喂给 <video> —— 桌面端是 WKWebView，
        // 其播放内核 AVFoundation 只接受可寻址（Range/206）资源，管道流一律判为
        // 不可播放（实测 isPlayable=ERR(Operation Stopped)，表现就是预览区黑屏）。
        // 所以改为「点击 -> 后端混流成缓存文件 -> 以文件方式播放」，详见 preview.py。
        const isBiliStream = isBilibili && audioUrl;
        const previewSrc = isBiliStream ? "" : noWmUrl;

        const durStr = video.duration ? formatDuration(video.duration) : "";

        const isLandscape = (platform === 'bilibili' || platform === 'youtube') || (video && video.width && video.height && video.width > video.height) || (video && video.ratio && !video.ratio.toLowerCase().includes('portrait'));

        // 视频播放器
        mediaHtml = `
            <div class="media-preview-container ${isLandscape ? 'is-landscape' : ''}">
                <div class="stream-badge-group">
                    ${isBiliStream ? `
                    <div class="stream-live-badge">
                        <i class="fa-solid fa-bolt text-gradient"></i> 实时双轨混流
                    </div>` : ''}
                    ${durStr ? `
                    <div class="stream-duration-badge">
                        <i class="fa-regular fa-clock"></i> 总长 ${durStr}
                    </div>` : ''}
                </div>
                <video 
                    id="mainVideoPlayer"
                    src="${previewSrc}" 
                    poster="${cover}" 
                    controls 
                    playsinline
                    preload="metadata"
                    referrerpolicy="no-referrer"
                    onloadedmetadata="onVideoMetadataLoaded(this)"
                ></video>
                ${isBiliStream ? `
                <button type="button" class="preview-prepare-overlay" id="previewOverlay" onclick="startPreviewPrepare()">
                    <span class="preview-play-btn"><i class="fa-solid fa-play"></i></span>
                    <span class="preview-prepare-text" id="previewPrepareText">点击准备预览</span>
                    <span class="preview-prepare-hint">B站是音视频分离的，会先在本机完整缓存这段视频再播放（之后可拖动进度、可重播，缓存可清理）</span>
                    <span class="preview-prepare-track"><span class="preview-prepare-bar" id="previewPrepareBar"></span></span>
                </button>` : ''}
            </div>
        `;

        const hasQualities = video.qualities && video.qualities.length > 0;
        const defaultQ = hasQualities ? video.qualities[0] : null;
        const defaultQName = defaultQ ? defaultQ.label.split("(")[0].trim() : (video.ratio || '高清');

        // 把各档画质与音轨的备用直链登记好，后续任一地址被拒都能自动换源
        registerUrlBackups(noWmUrl, video.video_backup_urls);
        registerUrlBackups(audioUrl, video.audio_backup_urls);
        (video.qualities || []).forEach(q => {
            registerUrlBackups(q.video_url, q.video_backup_urls);
            registerUrlBackups(q.audio_url, q.audio_backup_urls);
        });

        // B站双轨预览的入口参数（点击「准备预览」时才真正开始混流）
        // 令牌自增用于作废上一次解析遗留的轮询，避免切视频后旧任务把新播放器改掉
        window.pendingPreview = isBiliStream
            ? { videoUrl: noWmUrl, audioUrl: audioUrl, title: cleanTitle }
            : null;
        window.previewJobToken = (window.previewJobToken || 0) + 1;

        const primaryBtnClick = isBilibili && audioUrl
            ? `triggerMuxDownload('${defaultQ ? defaultQ.video_url : noWmUrl}', '${defaultQ ? defaultQ.audio_url : audioUrl}', '${cleanTitle}_${defaultQName}.mp4')`
            : `triggerDownload('${defaultQ ? defaultQ.video_url : noWmUrl}', '${cleanTitle}_${defaultQName}.mp4')`;

        const primaryBtnTitle = isBilibili 
            ? `下载高清视频 (${defaultQName} 带声音 MP4)` 
            : `下载高清视频 (${defaultQName} MP4)`;

        // 多画质下拉选择器 (支持 B站 与 Twitter 等)
        let qualitySelectorHtml = "";
        if (video.qualities && video.qualities.length > 0) {
            let optionsHtml = video.qualities.map((q, idx) => `
                <option value="${idx}" ${idx === 0 ? 'selected' : ''}>
                    ${q.label}
                </option>
            `).join("");

            // 方案 2: 若为 B站 且未配置 SESSDATA，在画质下拉框引导解锁
            if (isBilibili && !getBiliSessdata()) {
                optionsHtml += `<option value="__unlock_1080p__" style="color: #38bdf8; font-weight: 600;">🔒 解锁 1080P/4K 原画画质...</option>`;
            }

            qualitySelectorHtml = `
                <div class="quality-selector-box">
                    <span class="quality-selector-label"><i class="fa-solid fa-sliders"></i> 画质选择:</span>
                    <select class="quality-select" id="qualitySelect" onchange="onQualitySelectChange(this.value)">
                        ${optionsHtml}
                    </select>
                </div>
            `;
        }

        actionsHtml = `
            ${qualitySelectorHtml}
            <div class="download-action-grid">
                <button id="mainDownloadBtn" class="btn-primary grid-span-2" onclick="${primaryBtnClick}">
                    <i class="fa-solid fa-download"></i> ${primaryBtnTitle}
                </button>
                ${!isSingleStream && wmUrl ? `
                <button class="btn-secondary" onclick="triggerDownload('${wmUrl}', '${cleanTitle}_带水印.mp4')">
                    <i class="fa-solid fa-water"></i> 下载带水印视频
                </button>` : ''}
                ${audioUrl ? `
                <button class="btn-secondary ${isSingleStream ? 'grid-span-2' : ''} btn-outline-cyan" onclick="triggerDownload('${audioUrl}', '${cleanTitle}_原声.${isBilibili ? 'm4a' : 'mp3'}')">
                    <i class="fa-solid fa-music"></i> 提取视频音频 (${isBilibili ? '原声 M4A/MP3' : '原声 MP3'})
                </button>` : ''}
                <button class="btn-secondary ${isSingleStream && (!cover) ? 'grid-span-2' : ''}" onclick="copyToClipboard('${noWmUrl}', '${isPipixia || isBilibili ? '视频直链' : '无水印直链'}')">
                    <i class="fa-regular fa-copy"></i> 复制${isPipixia || isBilibili ? '视频直链' : '无水印直链'}
                </button>
                ${!isSingleStream && wmUrl ? `
                <button class="btn-secondary" onclick="copyToClipboard('${wmUrl}', '带水印直链')">
                    <i class="fa-regular fa-copy"></i> 复制带水印直链
                </button>` : ''}
                ${cover ? `
                <button class="btn-secondary ${isSingleStream ? '' : 'grid-span-2'}" onclick="triggerDownload('${cover}', '${cleanTitle}_封面.jpg')">
                    <i class="fa-regular fa-image"></i> 下载高清视频封面
                </button>` : ''}
                <a href="https://www.profitableratecpmnetwork.com/zndd9uqj?key=1ab6b3b6171a2adbf6a554152428783d" target="_blank" rel="noopener noreferrer" class="btn-sponsor-cta grid-span-2" title="赞助推荐">
                    <div class="sponsor-cta-content">
                        <i class="fa-solid fa-fire text-gradient"></i>
                        <div class="sponsor-cta-text">
                            <span class="sponsor-cta-title">热门推荐</span>
                            <span class="sponsor-cta-desc">探索精选实用好物与工具</span>
                        </div>
                    </div>
                    <span class="sponsor-cta-btn">立即查看 <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
                </a>
            </div>
        `;
    } else if (type === "images") {
        // 图集展示 (优雅平铺网格，绝不重叠)
        // 图片地址与标题存到 JS 变量里，按钮只传下标 —— 标题里的引号/尖括号
        // 会直接破坏 onclick 属性（中文标题里很常见），这样彻底避开该隐患。
        // 每张图带勾选框：默认全选，可只下其中几张。
        window.pendingGallery = {
            images: images,
            title: cleanTitle,
            selected: new Set(images.map((_, i) => i)),
        };
        const galleryItems = images.map((imgUrl, idx) => `
            <div class="gallery-item" title="点击查看高清原图" onclick="openGalleryImage(${idx})">
                <label class="gallery-check" title="勾选后可批量下载" onclick="event.stopPropagation()">
                    <input type="checkbox" data-gallery-check="${idx}" checked onchange="onGallerySelectChange()">
                </label>
                <img src="${imgUrl}" alt="图片 ${idx + 1}" loading="lazy" referrerpolicy="no-referrer">
                <div class="gallery-item-action" onclick="event.stopPropagation()">
                    <span class="gallery-idx">#${idx + 1}</span>
                    <button class="btn-gallery-dl" onclick="downloadSingleImage(${idx})" title="下载此图">
                        <i class="fa-solid fa-download"></i> 保存
                    </button>
                </div>
            </div>
        `).join("");

        mediaHtml = `
            <div class="images-gallery-container">
                <div class="gallery-header">
                    <span class="gallery-count-badge" id="galleryCountBadge"><i class="fa-regular fa-images"></i> 已选 ${images.length} / 共 ${images.length} 张</span>
                    <span style="font-size: 11px; color: var(--text-dim);">点击图片预览原图，勾选可批量下载</span>
                </div>
                <div class="gallery-grid">
                    ${galleryItems}
                </div>
            </div>
        `;

        actionsHtml = `
            <div class="download-action-grid">
                <button class="btn-secondary" onclick="toggleGallerySelectAll()" id="gallerySelectAllBtn">
                    <i class="fa-regular fa-square-check"></i> 取消全选
                </button>
                <button class="btn-primary" id="galleryBatchBtn" onclick="downloadAllImages()">
                    <i class="fa-solid fa-download"></i> 下载选中 ${images.length} 张
                </button>
                ${music && music.url ? `
                <button class="btn-secondary grid-span-2 btn-outline-cyan" onclick="triggerDownload('${music.url}', '${cleanTitle}_原声.mp3')">
                    <i class="fa-solid fa-music"></i> 提取背景音乐 MP3
                </button>` : ''}
                <a href="https://www.profitableratecpmnetwork.com/zndd9uqj?key=1ab6b3b6171a2adbf6a554152428783d" target="_blank" rel="noopener noreferrer" class="btn-sponsor-cta grid-span-2" title="赞助推荐">
                    <div class="sponsor-cta-content">
                        <i class="fa-solid fa-fire text-gradient"></i>
                        <div class="sponsor-cta-text">
                            <span class="sponsor-cta-title">热门推荐</span>
                            <span class="sponsor-cta-desc">探索精选实用好物与工具</span>
                        </div>
                    </div>
                    <span class="sponsor-cta-btn">立即查看 <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
                </a>
            </div>
        `;
    } else if (type === "text") {
        mediaHtml = `
            <div class="media-preview-container" style="aspect-ratio: auto; height: 160px; padding: 20px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
                <i class="fa-brands fa-x-twitter" style="font-size: 36px; color: #38bdf8; margin-bottom: 10px;"></i>
                <span style="font-size: 13px; color: var(--text-muted);">推文纯文本内容已解析</span>
            </div>
        `;
        actionsHtml = `
            <div class="download-action-grid">
                <button class="btn-primary grid-span-2" onclick="copyToClipboard('${cleanTitle}', '推文正文')">
                    <i class="fa-regular fa-copy"></i> 复制推文完整正文
                </button>
            </div>
        `;
    }

    // 继承保护：若本次单分P解析返回的 episodes 为空或只有1集，但之前已存在多P列表，则完整继承保留
    if ((!data.episodes || data.episodes.length <= 1) && window.currentMediaData && window.currentMediaData.episodes && window.currentMediaData.episodes.length > 1) {
        data.episodes = window.currentMediaData.episodes;
        data.season_title = data.season_title || window.currentMediaData.season_title;
    }

    // 选集 / 分P合集面板渲染 (只要存在分P列表或属于合集就 100% 渲染展示)
    let episodesHtml = "";
    if (data.episodes && data.episodes.length > 0 && (data.episodes.length > 1 || Boolean(data.season_title))) {
        const curP = data.current_page || 1;
        const epItems = data.episodes.map(ep => {
            const isActive = ep.page === curP;
            const durStr = ep.duration ? formatDuration(ep.duration) : "";
            const safeTitle = (ep.title || `第${ep.page}集`).replace(/"/g, '&quot;');
            return `
                <div class="episode-item ${isActive ? 'active' : ''}" 
                     data-page="${ep.page}" 
                     data-title="${safeTitle}" 
                     onclick="switchEpisode('${ep.share_url || ''}', ${ep.page})" 
                     title="点击播放 P${ep.page}: ${safeTitle}">
                    <div class="episode-info">
                        <div class="episode-main">
                            <span class="episode-tag">P${ep.page}</span>
                            <span class="episode-title">${ep.title || `第${ep.page}集`}</span>
                        </div>
                        <div class="episode-meta">
                            ${durStr ? `<span><i class="fa-regular fa-clock"></i> ${durStr}</span>` : ''}
                            ${isActive ? `<span style="color: #818cf8; font-weight: 600;"><i class="fa-solid fa-play"></i> 播放中</span>` : ''}
                        </div>
                    </div>
                    <div class="episode-actions" onclick="event.stopPropagation()">
                        <button class="btn-ep-action" onclick="copyToClipboard('${ep.share_url}', 'P${ep.page} 分集链接')" title="复制此集链接">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                        <button class="btn-ep-action btn-ep-download" onclick="downloadSingleEpisode('${ep.share_url}', ${ep.page}, '${safeTitle}')" title="下载本集 (MP4)">
                            <i class="fa-solid fa-download"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        const displaySeasonTitle = data.season_title || (data.episodes && data.episodes.length > 1 ? data.title : "");

        episodesHtml = `
            <div class="episodes-section" id="episodesSection">
                <div class="episodes-header-row">
                    <div class="episodes-title-group">
                        <span class="episodes-title"><i class="fa-solid fa-layer-group text-gradient"></i> 视频选集 / 分P合集</span>
                        <span class="episodes-count-badge">共 ${data.episodes.length} 集</span>
                        ${displaySeasonTitle ? `<span class="episodes-season-badge" title="${displaySeasonTitle}"><i class="fa-solid fa-layer-group"></i> ${displaySeasonTitle}</span>` : ''}
                    </div>
                    <div class="episodes-tools">
                        <input type="text" class="episodes-search-input" name="search_${Date.now()}" id="episodeSearchInput" placeholder="🔍 搜索分集/序号..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="" oninput="onEpisodeSearch(this.value)">
                        <div class="episodes-btn-group">
                            <button class="btn-episodes-tool" onclick="refreshCurrentEpisodes()" title="重新检测并刷新分P列表">
                                <i class="fa-solid fa-arrows-rotate"></i> 刷新分P
                            </button>
                            <button class="btn-episodes-tool" onclick="copyAllEpisodesLinks()" title="一键复制全部分P链接">
                                <i class="fa-regular fa-copy"></i> 复制全部
                            </button>
                            <button class="btn-episodes-tool btn-episodes-dl" onclick="downloadAllEpisodes('direct')" title="依次触发全部选集下载" style="background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8;">
                                <i class="fa-solid fa-download"></i> 批量下载
                            </button>
                        </div>
                    </div>
                </div>
                ${displaySeasonTitle ? `
                <div class="episodes-season-info-bar">
                    <span class="season-info-tag"><i class="fa-solid fa-folder-open"></i> 所属合集</span>
                    <span class="season-info-title" title="${displaySeasonTitle}">${displaySeasonTitle}</span>
                </div>` : ''}
                <div class="episodes-grid" id="episodesGrid">
                    ${epItems}
                </div>
            </div>
        `;
    }

    const isLandscape = (platform === 'bilibili' || platform === 'youtube') || (video && video.width && video.height && video.width > video.height) || (video && video.ratio && !video.ratio.toLowerCase().includes('portrait'));

    resultContainer.innerHTML = `
        <div class="result-layout ${type === 'images' ? 'is-images-layout' : ''} ${isLandscape ? 'is-landscape-layout' : ''}">
            <div class="media-column">
                ${mediaHtml}
            </div>
            <div class="info-panel">
                <div class="author-box">
                    <img class="author-avatar" src="${author.avatar || '/static/avatar-placeholder.png'}" alt="${author.nickname}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="author-meta">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span class="author-name">${author.nickname}</span>
                            <span class="badge badge-version" style="font-size: 9px; padding: 1px 6px;">${platform_name || '短视频'}</span>
                        </div>
                        <span class="author-id">ID: ${author.unique_id}</span>
                    </div>
                </div>

                <div class="video-desc">
                    ${title || '无作品描述'}
                </div>

                <div class="stats-grid">
                    ${(() => {
                        const statsList = [];
                        // 1. 获赞
                        statsList.push({ label: "获赞", val: formatNumber(statistics.digg_count) });
                        // 2. 评论
                        statsList.push({ label: "评论", val: formatNumber(statistics.comment_count) });
                        // 3. 播放量 (如快手/B站)
                        if (statistics.play_count && statistics.play_count > 0) {
                            statsList.push({ label: "播放量", val: formatNumber(statistics.play_count) });
                        }
                        // 4. 弹幕数 (B站)
                        if (statistics.danmaku_count && statistics.danmaku_count > 0) {
                            statsList.push({ label: "弹幕", val: formatNumber(statistics.danmaku_count) });
                        }
                        // 5. 分享数 (若大于0则展示)
                        if (statistics.share_count && statistics.share_count > 0) {
                            statsList.push({ label: "分享", val: formatNumber(statistics.share_count) });
                        }
                        // 6. 类型
                        const typeVal = type === 'images' ? `图集(${images ? images.length : 0}张)` : (video && video.ratio ? video.ratio : '视频');
                        statsList.push({ label: "规格", val: typeVal });

                        return statsList.map(item => `
                            <div class="stat-item">
                                <div class="stat-val">${item.val}</div>
                                <div class="stat-label">${item.label}</div>
                            </div>
                        `).join("");
                    })()}
                </div>

                ${actionsHtml}
            </div>
            ${episodesHtml}
        </div>
    `;

    resultContainer.style.display = "block";
    const searchInput = document.getElementById("episodeSearchInput");
    if (searchInput) searchInput.value = "";
    onEpisodeSearch("");
    resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 切换选集分P
async function switchEpisode(shareUrl, pageNum) {
    if (!shareUrl) return;
    showToast(`正在切换至 P${pageNum}...`, "info");

    try {
        const sessdata = getBiliSessdata();
        const response = await fetch("/api/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: shareUrl, sessdata: sessdata || null }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
            renderResult(data);
            showToast(`已成功切换至 P${pageNum}`, "success");
            // 自动开始播放
            setTimeout(() => {
                const player = document.getElementById("mainVideoPlayer");
                if (player) {
                    player.play().catch(() => {});
                }
            }, 300);
        } else {
            showToast(data.detail || data.error || "分集切换失败", "error");
        }
    } catch (err) {
        showToast("网络请求异常: " + err.message, "error");
    }
}

// ==========================================================================
// B站双轨预览：点击后由后端把音视频混流成**本地缓存文件**，再交给 <video> 播放
//
// 为什么不能边下边播：桌面端是 WKWebView，播放内核 AVFoundation 只接受可寻址
// （Range/206）的媒体资源；ffmpeg 实时管道流（chunked、无 Content-Length、不实现
// Range）会被直接判为不可播放，表现就是预览区黑屏 + 划掉的播放图标。
// 详见 downloader/preview.py 里的实测数据。
// 改为落盘缓存后顺带的好处：可拖动进度条、可重播、第二次打开秒开。
// ==========================================================================
function nextFrame() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
            setTimeout(resolve, 16);
        }
    });
}

async function startPreviewPrepare() {
    const pending = window.pendingPreview;
    const overlay = document.getElementById("previewOverlay");
    const player = document.getElementById("mainVideoPlayer");
    if (!pending || !overlay || !player) return;
    if (overlay.classList.contains("is-busy")) return;   // 防重复点击

    const token = ++window.previewJobToken;
    const textEl = document.getElementById("previewPrepareText");
    const barEl = document.getElementById("previewPrepareBar");
    const iconEl = overlay.querySelector(".preview-play-btn i");
    const hintEl = overlay.querySelector(".preview-prepare-hint");
    const setText = s => { if (textEl) textEl.textContent = s; };
    const setBar = p => { if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, p))}%`; };

    // 先把「准备中」画出来，否则请求期间用户看不到任何反馈
    overlay.classList.add("is-busy");
    overlay.classList.remove("is-error");
    if (iconEl) iconEl.className = "fa-solid fa-spinner fa-spin";
    setText("正在本机准备预览…");
    setBar(0);
    await nextFrame();

    const attach = (key) => {
        if (token !== window.previewJobToken) return;    // 已切换到别的视频
        player.src = `/api/preview/${encodeURIComponent(key)}/stream`;
        player.load();
        overlay.style.display = "none";
        player.play().catch(() => {});                    // 点击即手势，通常允许播放
        refreshPreviewCacheInfo();                        // 缓存体积变了，同步到界面
    };

    try {
        const resp = await fetch("/api/preview/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                video_url: pending.videoUrl,
                audio_url: pending.audioUrl || null,
                title: pending.title || "",
            }),
        });
        if (!resp.ok) throw new Error(`预览准备请求失败 (${resp.status})`);
        const info = await resp.json();
        if (info.ready) { attach(info.key); return; }

        const key = info.key;
        const deadline = Date.now() + 8 * 60 * 1000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 800));
            if (token !== window.previewJobToken) return;
            const st = await (await fetch(`/api/preview/${encodeURIComponent(key)}/status`)).json();
            if (token !== window.previewJobToken) return;   // 取状态期间可能已切换视频
            if (st.ready) { attach(key); return; }
            if (st.status === "error") throw new Error(st.error || "混流失败");
            setBar(st.progress || 0);
            // 预览是"完整缓存后才播放"，把体积进度显示出来，避免误以为是卡住了
            if (st.total_bytes) {
                setText(`正在本机缓存 ${formatBytes(st.downloaded_bytes || 0)} / ${formatBytes(st.total_bytes)}（${st.progress || 0}%）`);
            } else {
                setText(`正在本机准备预览… ${st.progress || 0}%`);
            }
        }
        throw new Error("准备超时");
    } catch (e) {
        if (token !== window.previewJobToken) return;
        console.warn("准备预览失败:", e);
        overlay.classList.remove("is-busy");
        overlay.classList.add("is-error");
        if (iconEl) iconEl.className = "fa-solid fa-triangle-exclamation";
        setText("预览准备失败");
        if (hintEl) hintEl.textContent = `${e.message || "未知原因"}；可直接点击下方按钮下载`;
    }
}

// 视频元数据加载完成后自适应比例
function onVideoMetadataLoaded(videoEl) {    if (!videoEl) return;
    const container = videoEl.closest('.media-preview-container');
    const layout = videoEl.closest('.result-layout');
    if (!container) return;
    
    // 如果视频实际宽度 >= 高度 (横屏 16:9 / 4:3)
    if (videoEl.videoWidth && videoEl.videoHeight && videoEl.videoWidth >= videoEl.videoHeight) {
        container.classList.add('is-landscape');
        if (layout) layout.classList.add('is-landscape-layout');
    }
}

// 选集实时搜索过滤
function onEpisodeSearch(keyword) {
    const grid = document.getElementById("episodesGrid");
    if (!grid) return;
    const items = grid.querySelectorAll(".episode-item");
    const term = (keyword || "").trim().toLowerCase();

    items.forEach(item => {
        const title = (item.getAttribute("data-title") || "").toLowerCase();
        const page = (item.getAttribute("data-page") || "").toLowerCase();
        if (!term || title.includes(term) || page === term || `p${page}` === term) {
            item.style.display = "flex";
        } else {
            item.style.display = "none";
        }
    });
}

// 下载单个指定分P集 (接入任务管理器)
function downloadSingleEpisode(shareUrl, pageNum, epTitle) {
    if (!shareUrl) return;
    const seasonTitle = (window.currentMediaData && (window.currentMediaData.season_title || window.currentMediaData.title)) || "视频合集";
    const safeSeasonTitle = seasonTitle.replace(/[\r\n\\/:*?"<>|]+/g, '_').slice(0, 30);
    const pageStr = String(pageNum).padStart(2, '0');
    const safeEpTitle = `${safeSeasonTitle}_P${pageStr}_${(epTitle || `第${pageNum}集`).replace(/[\r\n\\/:*?"<>|]+/g, '_').slice(0, 30)}.mp4`;

    const dup = findActiveTaskByFilename(safeEpTitle);
    if (dup) {
        showToast(`该分集已在下载队列中，未重复添加`, "info");
        toggleTaskManager(true);
        return;
    }

    const taskId = `single_p${pageNum}_${Date.now()}`;
    window.taskQueue.push({
        id: taskId,
        title: `P${pageNum}: ${epTitle || `第${pageNum}集`}`,
        filename: safeEpTitle,
        share_url: shareUrl,
        seasonTitle: seasonTitle,
        status: 'waiting',
        progress: 0,
        errorMsg: null,
    });

    toggleTaskManager(true);
    showToast(`已将 P${pageNum} 加入下载任务队列`, "info");
    processTaskQueue();
}

// 一键复制全部分P链接
function copyAllEpisodesLinks() {
    if (!window.currentMediaData || !window.currentMediaData.episodes) return;
    const episodes = window.currentMediaData.episodes;
    const mainTitle = window.currentMediaData.title || "视频合集";

    const textList = [
        `# ${mainTitle}`,
        `总计 ${episodes.length} 集：\n`,
    ];

    episodes.forEach(ep => {
        textList.push(`P${ep.page} ${ep.title}：${ep.share_url}`);
    });

    const fullText = textList.join("\n");
    copyToClipboard(fullText, `全部 ${episodes.length} 个分集链接`);
}

// ==========================================================================
// 批量下载任务队列与任务管理器 (Task Manager)
// ==========================================================================
window.taskQueue = [];
window.maxConcurrentTasks = 2; // 最大并发下载数
window.isTaskQueuePaused = false;
window.taskTargetFolder = null; // 本地文件夹 Handle
window.downloadDestination = localStorage.getItem("download_destination") || "local";
window.serverConfig = null;
window.isDesktop = false;      // 后端判定为桌面客户端
window.localDir = "";          // 桌面端本地保存目录

// 设置下载目的地 (local: 本地浏览器, server: NAS/服务端归档)
function setDownloadDestination(mode) {
    window.downloadDestination = mode;
    localStorage.setItem("download_destination", mode);

    const localBtn = document.getElementById("destLocalBtn");
    const serverBtn = document.getElementById("destServerBtn");
    const tipEl = document.getElementById("destPathTip");

    if (localBtn && serverBtn) {
        if (mode === "server") {
            serverBtn.classList.add("active");
            localBtn.classList.remove("active");
            if (tipEl) {
                tipEl.style.display = "inline-block";
                tipEl.textContent = (window.serverConfig && window.serverConfig.download_dir) || "/downloads";
            }
        } else {
            localBtn.classList.add("active");
            serverBtn.classList.remove("active");
            if (tipEl) tipEl.style.display = "none";
        }
    }
}

// ==========================================================================
// 桌面客户端：原生保存位置（选择目录 / 打开目录 / 持久化）
// ==========================================================================
function hasNativeApi() {
    return !!(window.pywebview && window.pywebview.api);
}

window.addEventListener("pywebviewready", () => {
    applyDesktopMode();
    refreshLocalDir();
});

async function refreshLocalDir() {
    try {
        const resp = await fetch("/api/local/config");
        if (!resp.ok) return;
        const cfg = await resp.json();
        window.localDir = cfg.download_dir || "";
        updateLocalDirLabel();
    } catch (e) {
        console.warn("获取本地保存目录失败:", e);
    }
}

function updateLocalDirLabel() {
    const pathEl = document.getElementById("desktopSavePath");
    if (pathEl) pathEl.textContent = window.localDir || "未设置";
    const navBtn = document.getElementById("openSaveDirBtn");
    if (navBtn) navBtn.title = `保存位置：${window.localDir || "未设置"}（点击更改）`;
}

function applyDesktopMode() {
    if (!window.isDesktop) return;
    // 桌面端恒为"存到当前设备"（由 Python 直接落盘到用户选定目录）
    window.downloadDestination = "local";
    localStorage.setItem("download_destination", "local");

    const bar = document.getElementById("desktopSaveBar");
    if (bar) bar.style.display = "flex";
    refreshPreviewCacheInfo();
    syncConcurrencySelect();
    const destRow = document.getElementById("taskDestinationRow");
    if (destRow) destRow.style.display = "none";
    const navBtn = document.getElementById("openSaveDirBtn");
    if (navBtn) navBtn.style.display = "inline-flex";
    updateLocalDirLabel();
}

async function chooseDownloadFolder() {
    if (!hasNativeApi()) {
        showToast("目录选择仅在桌面客户端中可用", "error");
        return;
    }
    let picked = "";
    try {
        picked = await window.pywebview.api.choose_folder(window.localDir || "");
    } catch (e) {
        showToast("打开目录选择器失败: " + e.message, "error");
        return;
    }
    if (!picked) return;
    try {
        const resp = await fetch("/api/local/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ download_dir: picked }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            showToast(data.detail || "保存目录设置失败", "error");
            return;
        }
        window.localDir = data.download_dir;
        updateLocalDirLabel();
        showToast("保存位置已更新：" + data.download_dir, "success");
    } catch (e) {
        showToast("网络请求异常: " + e.message, "error");
    }
}

async function openDownloadFolder() {
    if (!hasNativeApi()) {
        showToast("请在桌面客户端中使用此功能", "error");
        return;
    }
    await window.pywebview.api.open_path(window.localDir || "");
}

// ==========================================================================
// 赞助广告：桌面客户端不加载第三方广告脚本
// 说明：广告网络脚本改为动态注入（原先写死在 HTML 里，桌面端无法屏蔽），
//       网页版行为与之前一致；桌面端则整块隐藏，避免无场景的第三方请求。
// ==========================================================================
const SPONSOR_AD_SCRIPT_ID = "sponsorAdScript";
const SPONSOR_AD_SRC =
    "https://pl31021771.profitableratecpmnetwork.com/8cf9c301fd152cb4c0ab0b55a66d8166/invoke.js";

function initSponsorAd() {
    const inDesktop = window.isDesktop || !!(window.pywebview && window.pywebview.api);
    if (inDesktop) {
        const card = document.getElementById("sponsorAdCard");
        if (card) card.style.display = "none";
        return;
    }
    if (document.getElementById(SPONSOR_AD_SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SPONSOR_AD_SCRIPT_ID;
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = SPONSOR_AD_SRC;
    document.body.appendChild(script);
}

// ==========================================================================
// 同名文件确认
// 目标文件已存在时，让用户决定「覆盖重下」还是「保留两者」（自动改名）。
// 判定依据是最终落盘的文件名，路径规则与后端 add_task 保持一致。
// ==========================================================================
function askDuplicateFile(info) {
    return new Promise((resolve) => {
        const modal = document.getElementById("dupFileModal");
        const desc = document.getElementById("dupFileDesc");
        const hint = document.getElementById("dupKeepHint");
        if (!modal || !desc) { resolve("overwrite"); return; }

        const meta = [info.size_text || "未知大小", info.mtime_text || ""]
            .filter(Boolean).join("，");
        desc.textContent = `「${info.filename}」已存在于保存目录（${meta}）。`;
        hint.textContent = info.suggested
            ? `选择「保留两者」将另存为：${info.suggested}`
            : "";

        const btnOverwrite = document.getElementById("dupOverwriteBtn");
        const btnKeep = document.getElementById("dupKeepBothBtn");
        const btnCancel = document.getElementById("dupCancelBtn");
        const btnClose = document.getElementById("closeDupModalBtn");

        const cleanup = () => {
            modal.classList.remove("active");
            [btnOverwrite, btnKeep, btnCancel, btnClose].forEach(b => { if (b) b.onclick = null; });
            modal.onclick = null;
        };
        const pick = (choice) => { cleanup(); resolve(choice); };

        btnOverwrite.onclick = () => pick("overwrite");
        btnKeep.onclick = () => pick("keep");
        btnCancel.onclick = () => pick("cancel");
        btnClose.onclick = () => pick("cancel");
        // 点击遮罩等同取消（默认行为，避免误触覆盖）
        modal.onclick = (e) => { if (e.target === modal) pick("cancel"); };

        modal.classList.add("active");
    });
}

// 返回 "proceed"（直接下）/ {filename}（改名后下）/ "cancel"
async function resolveFilenameConflict(task) {
    if (!window.isDesktop || !task.filename) return "proceed";
    try {
        const resp = await fetch("/api/local/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: task.filename,
                subdir: task.seasonTitle || null,
            }),
        });
        if (!resp.ok) return "proceed";
        const info = await resp.json();
        if (!info.exists) return "proceed";

        const choice = await askDuplicateFile(info);
        if (choice === "overwrite") return "proceed";
        if (choice === "keep") return { filename: info.suggested };
        return "cancel";
    } catch (e) {
        // 检查失败不该阻塞下载，按覆盖继续
        console.warn("检查本地同名文件失败，按覆盖继续:", e);
        return "proceed";
    }
}

// 初始化服务端/NAS配置与SSE
async function initServerArchiving() {
    try {
        const resp = await fetch("/api/server/config");
        if (resp.ok) {
            const cfg = await resp.json();
            window.serverConfig = cfg;
            window.isDesktop = !!cfg.is_desktop;
            const tipEl = document.getElementById("destPathTip");
            if (tipEl && cfg.download_dir) {
                tipEl.textContent = cfg.download_dir;
            }
            if (cfg.is_desktop) {
                applyDesktopMode();
            } else if (cfg.is_nas_mode && !localStorage.getItem("download_destination")) {
                setDownloadDestination("server");
            } else {
                setDownloadDestination(window.downloadDestination);
            }
        }
    } catch (e) {
        console.warn("探测服务端归档配置失败:", e);
    }

    // 此时 window.isDesktop 已确定（或退化为检测 pywebview 桥）
    initSponsorAd();

    try {
        const evtSource = new EventSource("/api/server/events");
        evtSource.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                const { event, data } = msg;
                // 预览缓存任务（channel=preview）只在预览区呈现，不进任务列表
                if (data && data.channel === "preview") return;
                if (data && data.id) {
                    const localTask = window.taskQueue.find(t => t.id === data.id);
                    if (localTask) {
                        // 前端刚发起暂停时，后端的 running 事件不应该把状态改回去，
                        // 否则表现成"点了暂停但还在下"。等收到非 running 的状态再解除保持。
                        const holdingPause = localTask.pendingPause && data.status === "running";
                        if (!holdingPause) {
                            localTask.status = data.status;
                            localTask.errorMsg = data.error;
                            if (data.status !== "running") localTask.pendingPause = false;
                        }
                        localTask.progress = data.progress;
                        // 体积进度（后端逐块统计，用来判断"是不是卡住了"）
                        if (typeof data.total_bytes === "number") {
                            localTask.totalBytes = data.total_bytes;
                            localTask.downloadedBytes = data.downloaded_bytes;
                        }
                        // 落盘绝对路径（供「在访达中显示」定位文件）
                        if (data.save_path) localTask.savePath = data.save_path;
                        renderTaskManagerUI();
                        notifyTasksSettled();
                    } else if (event === "task_added" || data.status === "running") {
                        window.taskQueue.push({
                            id: data.id,
                            title: `[NAS] ${data.title}`,
                            filename: data.filename,
                            status: data.status,
                            progress: data.progress,
                            errorMsg: data.error,
                            savePath: data.save_path || '',
                            isServerTask: true,
                        });
                        renderTaskManagerUI();
                    }
                }
            } catch (err) {}
        };
    } catch (err) {}
}

// 切换任务管理器显示/隐藏/最小化
function toggleTaskManager(show = true) {
    const drawer = document.getElementById("taskManagerDrawer");
    const bubble = document.getElementById("taskManagerBubble");
    if (!drawer || !bubble) return;

    if (show) {
        drawer.style.display = "flex";
        bubble.style.display = "none";
        renderTaskManagerUI();
        refreshPreviewCacheInfo();
    } else {
        drawer.style.display = "none";
        // 只要队列中有任务，关闭时常驻显示悬浮气泡，方便随时再次展开
        if (window.taskQueue.length > 0) {
            bubble.style.display = "flex";
            const successCount = window.taskQueue.filter(t => t.status === 'success').length;
            const runningCount = window.taskQueue.filter(t => t.status === 'running').length;
            const bubbleText = document.getElementById("tmBubbleText");
            if (bubbleText) {
                bubbleText.textContent = runningCount > 0 
                    ? `下载中 (${successCount}/${window.taskQueue.length})` 
                    : `任务列表 (${successCount}/${window.taskQueue.length})`;
            }
        } else {
            bubble.style.display = "none";
        }
    }
}

// ==========================================================================
// 任务列表渲染
//
// 进度事件是**逐数据块**推送的（后端每读到 64KB 发一条，1.5GB 的文件约 2.4 万条），
// 早期实现每来一条就整表重建 innerHTML。重建会销毁并新建卡片上的按钮节点，而
// 浏览器要求 mousedown 与 mouseup 落在**同一个**节点上才会派发 click —— 只要重渲染
// 卡在按下与松开之间，click 就彻底不派发，表现成「点单条任务的暂停没反应」
// （批量暂停按钮在抽屉头部、不参与重建，所以一直是好的）。
//
// 隔离实验（headless Chrome + CDP 真实鼠标手势，40ms 按压窗口内重建 179 次）：
//   整表重建 + onclick     -> click 0 次
//   节点稳定 + onclick     -> click 1 次
//   整表重建 + pointerdown -> click 1 次
//
// 因此这里上双保险：
//   1. 结构（任务集合与状态）没变时**不重建 DOM**，只原地刷进度条与状态文字；
//   2. 任务卡片上的操作按钮一律走 pointerdown（按下即触发，不依赖 mouseup）。
// ==========================================================================
window._tmStructureSignature = null;

function _tmSignature() {
    return window.taskQueue
        .map(t => [t.id, t.status, t.title, t.filename || '', t.savePath || ''].join('|'))
        .join('\n');
}

function _tmSelector(taskId, attr) {
    const key = (window.CSS && window.CSS.escape) ? window.CSS.escape(taskId) : taskId;
    return `[data-${attr}="${key}"]`;
}

function _tmPatchProgress() {
    window.taskQueue.forEach(t => {
        const bar = document.querySelector(_tmSelector(t.id, "task-bar"));
        if (bar) bar.style.width = `${t.progress || 0}%`;
        const sizeEl = document.querySelector(_tmSelector(t.id, "task-size"));
        if (sizeEl) {
            sizeEl.textContent = t.totalBytes
                ? `${formatBytes(t.downloadedBytes || 0)} / ${formatBytes(t.totalBytes)}`
                : "";
        }
        if (t.status !== 'running') return;
        const badge = document.querySelector(_tmSelector(t.id, "task-badge"));
        if (badge) badge.textContent = `下载中 ${t.progress || 0}%`;
    });
}

// 同一帧内的多次进度更新只刷一次，避免逐块事件把主线程占满
let _tmPatchQueued = false;
function _tmScheduleProgressPatch() {
    if (_tmPatchQueued) return;
    _tmPatchQueued = true;
    const run = () => { _tmPatchQueued = false; _tmPatchProgress(); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
}

// 渲染任务管理器界面
function renderTaskManagerUI() {
    const listEl = document.getElementById("taskManagerList");
    if (!listEl) return;

    const total = window.taskQueue.length;
    const running = window.taskQueue.filter(t => t.status === 'running').length;
    const waiting = window.taskQueue.filter(t => t.status === 'waiting').length;
    const paused = window.taskQueue.filter(t => t.status === 'paused').length;
    const success = window.taskQueue.filter(t => t.status === 'success').length;
    const error = window.taskQueue.filter(t => t.status === 'error').length;

    const totalBadge = document.getElementById("taskTotalBadge");
    if (totalBadge) totalBadge.textContent = `${total} 项`;
    const navBadge = document.getElementById("navTaskBadge");
    if (navBadge) {
        if (total > 0) {
            navBadge.style.display = "inline-block";
            navBadge.textContent = total;
        } else {
            navBadge.style.display = "none";
        }
    }
    const rEl = document.getElementById("statRunning"); if (rEl) rEl.textContent = running;
    const wEl = document.getElementById("statWaiting"); if (wEl) wEl.textContent = waiting;
    const pEl = document.getElementById("statPaused"); if (pEl) pEl.textContent = paused;
    const sEl = document.getElementById("statSuccess"); if (sEl) sEl.textContent = success;
    const eEl = document.getElementById("statError"); if (eEl) eEl.textContent = error;

    // 有失败任务时才出现「重试失败」，并带上数量
    const retryAllBtn = document.getElementById("btnRetryFailed");
    if (retryAllBtn) {
        retryAllBtn.style.display = error > 0 ? "inline-flex" : "none";
        retryAllBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> 重试失败 (${error})`;
    }

    // 总进度条
    const overallBar = document.getElementById("overallProgressBar");
    if (overallBar) {
        const percent = total > 0 ? Math.round((success / total) * 100) : 0;
        overallBar.style.width = `${percent}%`;
    }

    // 最小化气泡文字同步
    const bubbleText = document.getElementById("tmBubbleText");
    if (bubbleText) bubbleText.textContent = `下载管理 (${success}/${total})`;

    // 结构未变（只是进度在走）：绝不重建 DOM，只原地刷进度，保证节点稳定可点
    const signature = _tmSignature();
    if (signature === window._tmStructureSignature) {
        _tmScheduleProgressPatch();
        return;
    }
    window._tmStructureSignature = signature;

    if (total === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 30px 10px; font-size: 12px;">
                <i class="fa-solid fa-list-check" style="font-size: 24px; margin-bottom: 8px; color: var(--text-muted);"></i>
                <div>暂无正在进行的批量任务</div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = window.taskQueue.map(t => {
        let statusLabel = "等待中";
        let statusClass = "status-waiting";
        if (t.status === "running") { statusLabel = `下载中 ${t.progress}%`; statusClass = "status-running"; }
        else if (t.status === "paused") { statusLabel = "已暂停"; statusClass = "status-paused"; }
        else if (t.status === "success") { statusLabel = "已完成"; statusClass = "status-success"; }
        else if (t.status === "error") { statusLabel = "失败"; statusClass = "status-error"; }
        else if (t.status === "canceled") { statusLabel = "已取消"; statusClass = "status-canceled"; }

        // 终止态（完成/失败/已取消）的任务只保留「移除」，不再出现暂停/继续
        const isActive = t.status === 'running' || t.status === 'waiting' || t.status === 'paused';
        const canRemove = t.status !== 'running';

        const sizeText = t.totalBytes
            ? `${formatBytes(t.downloadedBytes || 0)} / ${formatBytes(t.totalBytes)}`
            : "";
        const titleTip = t.savePath ? `${t.title} → ${t.savePath}` : t.title;

        return `
            <div class="task-item-card is-${t.status}" id="task_card_${t.id}">
                <div class="task-item-main">
                    <span class="task-item-title" title="${escapeHtml(titleTip)}">${escapeHtml(t.title)}</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="task-item-size" data-task-size="${t.id}">${sizeText}</span>
                        <span class="task-status-badge ${statusClass}" data-task-badge="${t.id}">${statusLabel}</span>
                        <div class="task-item-actions">
                            ${t.status === 'running' ? `
                            <button class="btn-task-action" data-task-action="pause" data-task-id="${t.id}" title="暂停此任务">
                                <i class="fa-solid fa-pause"></i>
                            </button>` : ''}
                            ${t.status === 'paused' || t.status === 'waiting' ? `
                            <button class="btn-task-action" data-task-action="resume" data-task-id="${t.id}" title="开始/继续此任务">
                                <i class="fa-solid fa-play"></i>
                            </button>` : ''}
                            ${t.status === 'error' ? `
                            <button class="btn-task-action" data-task-action="retry" data-task-id="${t.id}" title="重试此任务">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>` : ''}
                            ${t.status === 'success' && t.savePath ? `
                            <button class="btn-task-action" data-task-action="reveal" data-task-id="${t.id}" title="在访达中显示此文件">
                                <i class="fa-solid fa-folder-open"></i>
                            </button>` : ''}
                            ${isActive ? `
                            <button class="btn-task-action is-danger" data-task-action="cancel" data-task-id="${t.id}" title="取消此任务（已下载的分片会丢弃）">
                                <i class="fa-solid fa-xmark"></i>
                            </button>` : ''}
                            ${!isActive && canRemove ? `
                            <button class="btn-task-action" data-task-action="remove" data-task-id="${t.id}" title="从列表移除">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>` : ''}
                        </div>
                    </div>
                </div>
                <div class="task-item-progress-track">
                    <div class="task-item-progress-bar" data-task-bar="${t.id}" style="width: ${t.progress || 0}%;"></div>
                </div>
                ${t.status === 'error' && t.errorMsg ? `
                <div class="task-item-error" title="${escapeHtml(t.errorMsg)}">${escapeHtml(t.errorMsg)}</div>` : ''}
            </div>
        `;
    }).join("");
}

// 任务卡片上的操作按钮：事件委派。
// 1) 主路径 pointerdown：按下瞬间触发，不要求 mouseup 落在同一节点，天然免疫重渲染；
// 2) click 只作兜底（键盘 Enter / 不派发指针事件的旧内核）—— 用 WeakSet 记住同一次
//    按压已由 pointerdown 处理过的按钮，避免一次点击执行两次；
// 3) 监听器绑在永不重建的 #taskManagerList 上，一次注册永久有效。
(function bindTaskActionDelegation() {
    const listEl = document.getElementById("taskManagerList");
    if (!listEl) return;
    const handledByPointer = new WeakSet();

    const runAction = (btn) => {
        const action = btn.dataset.taskAction;
        const taskId = btn.dataset.taskId;
        if (action === "pause") pauseTask(taskId);
        else if (action === "resume") resumeTask(taskId);
        else if (action === "retry") retryTask(taskId);
        else if (action === "reveal") revealTaskFile(taskId);
        else if (action === "cancel") cancelTask(taskId);
        else if (action === "remove") removeTask(taskId);
    };

    listEl.addEventListener("pointerdown", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-task-action]") : null;
        if (!btn) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.stopPropagation();
        handledByPointer.add(btn);
        runAction(btn);
    });

    listEl.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-task-action]") : null;
        if (!btn || handledByPointer.has(btn)) return;
        e.stopPropagation();
        runAction(btn);
    });
})();

// 调度任务队列并发
function scheduleTaskQueue() {
    if (window.isTaskQueuePaused) return;

    // 桌面端：并发与排队统一由后端 Python 调度，前端只负责提交
    if (window.isDesktop) {
        window.taskQueue
            .filter(t => t.status === 'waiting' && !t.submitted)
            .forEach(t => runSingleTask(t));
        return;
    }

    const runningTasks = window.taskQueue.filter(t => t.status === 'running');
    if (runningTasks.length >= window.maxConcurrentTasks) return;

    const availableSlots = window.maxConcurrentTasks - runningTasks.length;
    const waitingTasks = window.taskQueue.filter(t => t.status === 'waiting').slice(0, availableSlots);

    waitingTasks.forEach(task => {
        runSingleTask(task);
    });
}
window.processTaskQueue = scheduleTaskQueue;

// 桌面端：把任务交给后端原生落盘（进度由 SSE 回填）
async function submitTaskToBackend(task) {
    task.submitted = true;
    try {
        // 目标文件已存在时先问用户：覆盖重下，还是保留两者
        const decision = await resolveFilenameConflict(task);
        if (decision === "cancel") {
            window.taskQueue = window.taskQueue.filter(t => t.id !== task.id);
            renderTaskManagerUI();
            showToast("已取消本次下载", "info");
            return;
        }
        if (decision && decision.filename) {
            task.filename = decision.filename;
            task.title = decision.filename;
        }

        const payload = {
            tasks: [{
                task_id: task.id,
                title: task.title || task.filename || "视频",
                filename: task.filename || null,
                direct_url: task.directUrl || task.videoUrl || null,
                audio_url: task.audioUrl || null,
                direct_backup_urls: task.directBackups || task.videoBackups || [],
                audio_backup_urls: task.audioBackups || [],
                url: task.share_url || null,
                season_title: task.seasonTitle || null,
                subdir: task.subdir || null,
                platform: task.platform || "media",
                page_num: task.pageNum || null,
                sessdata: getBiliSessdata() || null,
            }],
        };
        const resp = await fetch("/api/local/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.detail || "本地保存任务提交失败");
        }
        // 后端判定目标路径上已有活动任务：说明本条是重复入队，直接移除即可
        if (data.skipped && data.skipped.length) {
            window.taskQueue = window.taskQueue.filter(t => t.id !== task.id);
            showToast(data.skipped[0].reason || "该文件已在下载队列中", "info");
            renderTaskManagerUI();
            return;
        }
        if (!data.tasks || !data.tasks.length) {
            throw new Error("本地保存任务提交失败");
        }
        task.serverSide = true;
        task.status = "waiting";
        task.progress = 2;
        // 记下后端算好的落盘绝对路径，任务完成后可一键在访达中定位
        if (data.tasks[0].save_path) task.savePath = data.tasks[0].save_path;
    } catch (err) {
        task.submitted = false;
        task.status = "error";
        task.errorMsg = err.message || "提交失败";
    } finally {
        renderTaskManagerUI();
    }
}

// 执行单个下载任务
async function runSingleTask(task) {
    if (!task || task.status !== 'waiting') return;
    if (task.submitted) return;

    // 桌面客户端：交由后端 Python 原生落盘，杜绝 WebView 下载把界面顶掉
    if (window.isDesktop) {
        await submitTaskToBackend(task);
        return;
    }

    task.status = 'running';
    task.progress = 10;
    renderTaskManagerUI();

    const abortCtrl = new AbortController();
    task.abortCtrl = abortCtrl;

    try {
        let vUrl = task.directUrl || task.videoUrl;
        let aUrl = task.audioUrl;

        // 如果需要先解析分享链接 (如分P单集或博主作品)
        if (!vUrl && task.share_url) {
            const sessdata = getBiliSessdata();
            const parseResp = await fetch("/api/parse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: task.share_url, sessdata: sessdata || null }),
                signal: abortCtrl.signal,
            });
            const parseData = await parseResp.json();
            
            if (!parseResp.ok || !parseData.success || !parseData.video) {
                throw new Error(parseData.detail || parseData.error || "提取视频流失败");
            }

            vUrl = parseData.video.no_watermark_url;
            aUrl = parseData.video.audio_url;
        }

        if (!vUrl) {
            throw new Error("无效的媒体下载地址");
        }

        task.progress = 15;
        renderTaskManagerUI();

        const streamUrl = aUrl 
            ? `/api/stream/mux?video_url=${encodeURIComponent(vUrl)}&audio_url=${encodeURIComponent(aUrl)}&filename=${encodeURIComponent(task.filename)}`
            : `/api/download?url=${encodeURIComponent(vUrl)}&filename=${encodeURIComponent(task.filename)}`;

        const fileResp = await fetch(streamUrl, { signal: abortCtrl.signal });
        if (!fileResp.ok) throw new Error("下载数据流响应异常 (" + fileResp.status + ")");

        const contentLength = +fileResp.headers.get('Content-Length') || 0;
        const reader = fileResp.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (contentLength > 0) {
                task.progress = 15 + Math.min(82, Math.round((received / contentLength) * 82));
            } else {
                task.progress = Math.min(95, 15 + Math.round(received / (1024 * 1024 * 2)));
            }
            renderTaskManagerUI();
        }

        // 数据流全部接收完毕，真正触发保存到本地
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = task.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

        task.status = 'success';
        task.progress = 100;
        renderTaskManagerUI();
    } catch (err) {
        if (err.name === 'AbortError') {
            // 主动取消是终止态，不能被中断异常改回「已暂停」
            if (task.status !== 'canceled') task.status = 'paused';
        } else {
            task.status = 'error';
            task.errorMsg = err.message || "下载失败";
        }
    } finally {
        task.abortCtrl = null;
        renderTaskManagerUI();
        // 继续调度队列中的下一个任务
        scheduleTaskQueue();
        notifyTasksSettled();
    }
}

// 单任务控制
//
// 桌面端任务的真身在 Python 侧，前端只是镜像。这里先乐观切一下给即时反馈，
// 再用后端返回值校正：后端会拒绝对「已完成/已取消」的任务暂停，若前端不回退，
// 界面就会卡在「已暂停」而实际早已成功，连点「继续」都救不回来。
async function syncTaskStatusFromServer(taskId) {
    try {
        const resp = await fetch("/api/server/tasks");
        if (!resp.ok) return;
        const data = await resp.json();
        const remote = (data.tasks || []).find(t => t.id === taskId);
        const local = window.taskQueue.find(t => t.id === taskId);
        if (!remote || !local) return;
        local.status = remote.status;
        local.progress = remote.progress;
        local.errorMsg = remote.error || null;
        if (remote.save_path) local.savePath = remote.save_path;
        renderTaskManagerUI();
    } catch (e) {
        console.warn("与服务端对齐任务状态失败:", e);
    }
}

async function pauseTask(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    if (!task) return;
    if (task.serverSide) {
        task.status = 'paused';
        task.pendingPause = true;
        renderTaskManagerUI();
        try {
            const resp = await fetch(`/api/server/tasks/${encodeURIComponent(taskId)}/pause`, { method: "POST" });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                task.pendingPause = false;
                await syncTaskStatusFromServer(taskId);
                showToast("该任务已结束，无需暂停", "info");
            }
        } catch (e) {
            task.pendingPause = false;
            console.warn("暂停请求失败:", e);
            showToast("暂停请求失败，请重试", "error");
        }
        return;
    }
    if (task.status === 'running' && task.abortCtrl) {
        task.abortCtrl.abort();
    }
    task.status = 'paused';
    renderTaskManagerUI();
    scheduleTaskQueue();
}

async function resumeTask(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    if (!task) return;
    if (task.serverSide) {
        task.status = 'waiting';
        task.pendingPause = false;
        renderTaskManagerUI();
        try {
            const resp = await fetch(`/api/server/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) await syncTaskStatusFromServer(taskId);
        } catch (e) {
            console.warn("继续请求失败:", e);
            showToast("继续请求失败，请重试", "error");
        }
        return;
    }
    task.status = 'waiting';
    renderTaskManagerUI();
    scheduleTaskQueue();
}

async function retryTask(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    if (!task) return;
    if (task.serverSide) {
        task.status = 'waiting';
        task.progress = 0;
        task.pendingPause = false;
        renderTaskManagerUI();
        try {
            const resp = await fetch(`/api/server/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) await syncTaskStatusFromServer(taskId);
        } catch (e) {
            console.warn("重试请求失败:", e);
            showToast("重试请求失败，请稍后再试", "error");
        }
        return;
    }
    task.status = 'waiting';
    task.progress = 0;
    renderTaskManagerUI();
    scheduleTaskQueue();
}

// 取消单个任务。
// 与「暂停」的区别：取消是终止态，后端会**丢弃已下载的分片**（暂停则保留分片可续传），
// 所以这里在 toast 里说明清楚，避免误以为还能续。
async function cancelTask(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    if (!task) return;
    if (!['running', 'waiting', 'paused'].includes(task.status)) return;

    if (task.serverSide) {
        const wasActive = task.status !== 'waiting';
        task.status = 'canceled';
        task.pendingPause = false;
        renderTaskManagerUI();
        try {
            const resp = await fetch(`/api/server/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) await syncTaskStatusFromServer(taskId);
        } catch (e) {
            console.warn("取消失败:", e);
            showToast("取消请求失败，请重试", "error");
            return;
        }
        showToast(wasActive ? "已取消，已下载的分片已丢弃" : "已取消该任务", "info");
        return;
    }

    // 浏览器直连下载的任务：中断请求并清理
    if (task.abortCtrl) {
        task.abortCtrl.abort();
        task.abortCtrl = null;
    }
    task.status = 'canceled';
    renderTaskManagerUI();
    showToast("已取消该任务", "info");
}

// 从列表移除一个终止态任务（不影响后端已完成任务的记录，仅前端清理）
function removeTask(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    if (!task) return;
    if (task.status === 'running') return;          // 运行中的任务请先取消
    window.taskQueue = window.taskQueue.filter(t => t.id !== taskId);
    renderTaskManagerUI();
}

// 取消全部：把所有活动任务（等待/下载中/已暂停）一次性取消
async function cancelAllTasks() {
    const targets = window.taskQueue.filter(t => ['running', 'waiting', 'paused'].includes(t.status));
    if (!targets.length) {
        showToast("当前没有进行中的任务", "info");
        return;
    }
    window.isTaskQueuePaused = false;

    const jobs = targets.map(t => {
        if (t.serverSide) {
            t.status = 'canceled';
            t.pendingPause = false;
            return fetch(`/api/server/tasks/${encodeURIComponent(t.id)}/cancel`, { method: "POST" })
                .then(r => r.json().catch(() => ({})))
                .then(d => { if (!d || d.success === false) return syncTaskStatusFromServer(t.id); })
                .catch(() => {});
        }
        if (t.abortCtrl) {
            t.abortCtrl.abort();
            t.abortCtrl = null;
        }
        t.status = 'canceled';
        return Promise.resolve();
    });

    renderTaskManagerUI();
    await Promise.all(jobs);
    showToast(`已取消 ${targets.length} 个任务`, "info");
}

// 在访达/资源管理器中定位已下载的文件（只对原生落盘的任务有意义）
async function revealTaskFile(taskId) {
    const task = window.taskQueue.find(t => t.id === taskId);
    const path = task && task.savePath;
    if (!path) {
        showToast("该任务没有可定位的本地文件", "error");
        return;
    }
    try {
        const resp = await fetch("/api/local/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: path }),
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.detail || "定位文件失败");
        }
        showToast("已在访达中定位该文件", "success");
    } catch (e) {
        showToast(e.message || "定位文件失败", "error");
    }
}

// 批量全局控制
function pauseAllTasks() {
    window.isTaskQueuePaused = true;
    window.taskQueue.forEach(t => {
        if (t.serverSide) {
            if (t.status === 'running' || t.status === 'waiting') {
                fetch(`/api/server/tasks/${encodeURIComponent(t.id)}/pause`, { method: "POST" }).catch(() => {});
                t.status = 'paused';
                t.pendingPause = true;
            }
            return;
        }
        if (t.status === 'running' && t.abortCtrl) {
            t.abortCtrl.abort();
        }
        if (t.status === 'running' || t.status === 'waiting') {
            t.status = 'paused';
        }
    });
    renderTaskManagerUI();
    showToast("已暂停全部批量下载任务", "info");
}

function resumeAllTasks() {
    window.isTaskQueuePaused = false;
    window.taskQueue.forEach(t => {
        if (t.status !== 'paused') return;
        if (t.serverSide) {
            fetch(`/api/server/tasks/${encodeURIComponent(t.id)}/resume`, { method: "POST" }).catch(() => {});
            t.pendingPause = false;
        }
        t.status = 'waiting';
    });
    renderTaskManagerUI();
    scheduleTaskQueue();
    showToast("已继续全部批量下载任务", "success");
}

// 任务全部结束时的汇总提示。
// 只在"曾经有活动任务"且"现在全部结束"这一个转折点提示一次，避免刷屏。
function notifyTasksSettled() {
    const active = window.taskQueue.filter(t => ['running', 'waiting', 'paused'].includes(t.status)).length;
    if (active > 0) {
        window._hasSeenActiveTask = true;
        return;
    }
    if (!window._hasSeenActiveTask) return;
    window._hasSeenActiveTask = false;

    const done = window.taskQueue.filter(t => t.status === 'success').length;
    const failed = window.taskQueue.filter(t => t.status === 'error').length;
    const canceled = window.taskQueue.filter(t => t.status === 'canceled').length;

    if (failed > 0) {
        showToast(`下载结束：成功 ${done} 个，失败 ${failed} 个（卡片上有失败原因，可重试）`, "error");
    } else if (done > 0) {
        showToast(`全部下载完成，共 ${done} 个文件`, "success");
    } else if (canceled > 0) {
        showToast("已取消全部任务", "info");
    }
}

// ==========================================================================
// 预览缓存：预览是"先把整段视频缓存在本机再播放"，因此需要让占用可见、可一键清理
// （缓存目录不在下载目录里，用户平时看不到它）
// ==========================================================================
async function refreshPreviewCacheInfo() {
    const label = document.getElementById("previewCacheSize");
    if (!label || !window.isDesktop) return;
    try {
        const resp = await fetch("/api/preview/cache");
        if (!resp.ok) return;
        const info = await resp.json();
        label.textContent = info.file_count
            ? `${formatBytes(info.total_bytes)} · ${info.file_count} 个`
            : "空";
    } catch (e) {
        console.warn("读取预览缓存占用失败:", e);
    }
}

async function clearPreviewCache() {
    const label = document.getElementById("previewCacheSize");
    const btn = document.getElementById("btnPreviewCache");
    if (btn) btn.disabled = true;
    try {
        const resp = await fetch("/api/preview/cache/clear", { method: "POST" });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.detail || "清理失败");
        if (data.removed) {
            showToast(`已清理预览缓存：${data.removed} 个文件，释放 ${formatBytes(data.freed_bytes)}`, "success");
        } else {
            showToast("预览缓存本来就是空的", "info");
        }
        if (label) label.textContent = "空";
    } catch (e) {
        showToast(e.message || "清理预览缓存失败", "error");
    } finally {
        if (btn) btn.disabled = false;
        refreshPreviewCacheInfo();
    }
}

// 一键重试全部失败任务（失败原因已显示在卡片上，重试会从断点续传）
async function retryAllFailedTasks() {
    const failed = window.taskQueue.filter(t => t.status === 'error');
    if (!failed.length) {
        showToast("当前没有失败的任务", "info");
        return;
    }
    window.isTaskQueuePaused = false;
    await Promise.all(failed.map(t => retryTask(t.id)));
    showToast(`已重新提交 ${failed.length} 个失败任务`, "success");
}

// 同时下载数：改后端立即生效（含排队中的任务），并持久化到用户配置
async function applyConcurrency(value) {
    const n = parseInt(value, 10);
    const sel = document.getElementById("concurrencySelect");
    if (!n) return;
    if (sel) sel.disabled = true;
    try {
        const resp = await fetch("/api/server/concurrency", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_concurrent: n }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.detail || "设置失败");
        window.maxConcurrentTasks = data.max_concurrent;
        if (window.serverConfig) window.serverConfig.max_concurrent = data.max_concurrent;
        if (sel) sel.value = String(data.max_concurrent);
        showToast(`同时下载数已设为 ${data.max_concurrent}`, "success");
    } catch (e) {
        showToast(e.message || "设置同时下载数失败", "error");
        syncConcurrencySelect();
    } finally {
        if (sel) sel.disabled = false;
    }
}

function syncConcurrencySelect() {
    const sel = document.getElementById("concurrencySelect");
    const n = (window.serverConfig && window.serverConfig.max_concurrent) || 3;
    if (sel) sel.value = String(n);
    window.maxConcurrentTasks = n;
}

function clearCompletedTasks() {
    fetch("/api/server/tasks/clear", { method: "POST" }).catch(() => {});
    // 与后端 clear_completed 的范围保持一致（success / canceled / error）。
    // 否则前端会残留后端已不存在的任务，点「重试」会直接 404。
    window.taskQueue = window.taskQueue.filter(
        t => !['success', 'canceled', 'error'].includes(t.status)
    );
    renderTaskManagerUI();
    showToast("已清空全部已完成任务", "info");
}

// 批量下载当前选集所有分集入口
async function downloadAllEpisodes(mode = 'direct') {
    if (!window.currentMediaData || !window.currentMediaData.episodes) return;
    const episodes = window.currentMediaData.episodes;
    const seasonTitle = window.currentMediaData.season_title || window.currentMediaData.title || "合集视频";
    const safeSeasonTitle = seasonTitle.replace(/[\r\n\\/:*?"<>|]+/g, '_').slice(0, 40);

    // 如果用户当前选择了 NAS/服务端归档模式
    if (window.downloadDestination === 'server') {
        const sessdata = getBiliSessdata();
        const payload = {
            tasks: episodes.map(ep => ({
                url: ep.share_url,
                title: ep.title || `第${ep.page}集`,
                season_title: seasonTitle,
                platform: "bilibili",
                page_num: ep.page,
                sessdata: sessdata || null,
            }))
        };

        try {
            showToast(`正在向 NAS/服务端 提交 ${episodes.length} 个合集分P归档任务...`, "info");
            const resp = await fetch("/api/server/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const res = await resp.json();
            if (resp.ok && res.success) {
                toggleTaskManager(true);
                showToast(`🎉 成功提交！NAS 正在自动在 /downloads/${safeSeasonTitle} 下建目录归档下载！`, "success");
            } else {
                showToast(res.detail || "提交服务端归档失败", "error");
            }
        } catch (e) {
            showToast("网络请求异常: " + e.message, "error");
        }
        return;
    }

    // 构建任务列表并加入全局队列
    const newTasks = episodes.map(ep => {
        const pageStr = String(ep.page).padStart(2, '0');
        const epCleanTitle = (ep.title || `第${ep.page}集`).replace(/[\r\n\\/:*?"<>|]+/g, '_').slice(0, 30);
        return {
            id: `task_${ep.page}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            title: `P${pageStr} ${ep.title || `第${ep.page}集`}`,
            filename: `${safeSeasonTitle}_P${pageStr}_${epCleanTitle}.mp4`,
            share_url: ep.share_url,
            seasonTitle: seasonTitle,
            status: 'waiting',
            progress: 0,
            errorMsg: '',
            mode: mode,
        };
    });

    // 跳过已在队列中或已下载到本地的集数，避免重复拉取
    const { kept, skipped } = await filterDownloadableTasks(newTasks, safeSeasonTitle);
    toggleTaskManager(true);
    if (!kept.length) {
        showToast(`这 ${newTasks.length} 集都已在队列中或本地已存在，无需重复下载`, "info");
        return;
    }

    window.taskQueue.push(...kept);
    window.isTaskQueuePaused = false;
    if (skipped.length) {
        showToast(`已跳过 ${skipped.length} 集（本地已存在或已在队列），加入 ${kept.length} 集`, "info");
    } else {
        showToast(`已成功将 ${kept.length} 集加入下载任务管理器！`, "success");
    }

    // 开始调度
    scheduleTaskQueue();
}

// ==========================================================================
// 批量下载前的过滤
// 判重依据是「最终落盘的文件名」，与后端 save_path 的最后一段一致：
//   1) 队列中已有同名的活动任务 -> 跳过
//   2) 本地目录里已存在同名文件 -> 跳过
// ==========================================================================
async function filterDownloadableTasks(tasks, subdir) {
    const queued = new Set(
        window.taskQueue
            .filter(t => ['waiting', 'running', 'paused'].includes(t.status))
            .map(t => t.filename)
    );

    let onDisk = new Set();
    if (window.isDesktop) {
        try {
            const resp = await fetch(`/api/local/files?subdir=${encodeURIComponent(subdir || "")}`);
            if (resp.ok) {
                const data = await resp.json();
                onDisk = new Set(data.files || []);
            }
        } catch (e) {
            console.warn("读取本地文件列表失败，本次不做本地去重:", e);
        }
    }

    const kept = [];
    const skipped = [];
    tasks.forEach(t => {
        if (queued.has(t.filename)) skipped.push({ task: t, why: "已在队列中" });
        else if (onDisk.has(t.filename)) skipped.push({ task: t, why: "本地已存在" });
        else kept.push(t);
    });
    return { kept, skipped };
}

// 重新检测/刷新当前视频的分P列表与合集
async function refreshCurrentEpisodes() {
    if (!window.currentMediaData) return;
    const url = window.currentMediaData.share_url || document.getElementById("urlInput")?.value;
    if (!url) return;

    showToast("🔄 正在强制重新探测全部分P列表与合集数据...", "info");
    
    try {
        const sessdata = getBiliSessdata();
        const response = await fetch("/api/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, sessdata: sessdata || null }),
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            renderResult(data);
            const epCount = (data.episodes && data.episodes.length) || 0;
            if (epCount > 0) {
                showToast(`🎉 刷新成功！共探测到 ${epCount} 集分P/合集！`, "success");
            } else {
                showToast("该视频经多通道校验为单集视频", "info");
            }
        } else {
            showToast(data.detail || data.error || "刷新分P失败", "error");
        }
    } catch (err) {
        showToast("网络请求异常: " + err.message, "error");
    }
}

// 内存混流下载 (统一接入任务管理器与真实流式进度)
// options.subdir: 目标子目录（博主主页批量下载按博主名归档）
function triggerMuxDownload(videoUrl, audioUrl, filename, options = {}) {
    if (!videoUrl) {
        showToast("视频链接无效", "error");
        return;
    }
    const safeFilename = filename || "bilibili_video.mp4";
    const taskId = `mux_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    window.taskQueue.push({
        id: taskId,
        title: safeFilename,
        filename: safeFilename,
        videoUrl: videoUrl,
        audioUrl: audioUrl,
        videoBackups: backupsForUrl(videoUrl),
        audioBackups: backupsForUrl(audioUrl),
        subdir: options.subdir || null,
        status: 'waiting',
        progress: 0,
        errorMsg: null,
    });

    window.isTaskQueuePaused = false;
    toggleTaskManager(true);
    scheduleTaskQueue();
}

// 响应画质下拉框切换
function onQualitySelectChange(index) {
    if (index === "__unlock_1080p__") {
        openBiliModal();
        const sel = document.getElementById("qualitySelect");
        if (sel) sel.value = "0";
        return;
    }

    if (!window.currentMediaData || !window.currentMediaData.video || !window.currentMediaData.video.qualities) return;
    const data = window.currentMediaData;
    const q = data.video.qualities[index];
    if (!q) return;
    
    const isBilibili = data.platform === 'bilibili';
    const isTwitter = data.platform === 'twitter';
    const cleanTitle = data.title ? data.title.replace(/[\r\n]+/g, " ").slice(0, 60) : `${data.platform || 'media'}_${data.id}`;
    
    // 更新主下载按钮
    const mainBtn = document.getElementById("mainDownloadBtn");
    if (mainBtn) {
        const qName = q.label.split("(")[0].trim();
        mainBtn.innerHTML = `<i class="fa-solid fa-download"></i> 下载视频 (${qName}${isBilibili ? ' 带声音' : ''} MP4)`;
        mainBtn.onclick = function() {
            if (isBilibili && q.audio_url) {
                triggerMuxDownload(q.video_url, q.audio_url, `${cleanTitle}_${qName}.mp4`);
            } else {
                triggerDownload(q.video_url, `${cleanTitle}_${qName}.mp4`);
            }
        };
    }

    // 同步更新网页播放器：切画质等于换了另一组直链，预览缓存要跟着换
    // （B站双轨必须重新走「落盘混流 -> 文件播放」，不能直接喂管道流）
    const player = document.getElementById("mainVideoPlayer");
    if (player && q.video_url) {
        const bilisTream = isBilibili && q.audio_url;
        window.pendingPreview = bilisTream
            ? { videoUrl: q.video_url, audioUrl: q.audio_url, title: cleanTitle }
            : null;
        window.previewJobToken = (window.previewJobToken || 0) + 1;   // 作废上一次轮询

        const overlay = document.getElementById("previewOverlay");
        const iconEl = overlay ? overlay.querySelector(".preview-play-btn i") : null;
        const textEl = document.getElementById("previewPrepareText");
        const barEl = document.getElementById("previewPrepareBar");
        const hintEl = overlay ? overlay.querySelector(".preview-prepare-hint") : null;

        if (bilisTream) {
            player.removeAttribute("src");
            player.load();
            if (overlay) {
                overlay.style.display = "flex";
                overlay.classList.remove("is-busy", "is-error");
                if (iconEl) iconEl.className = "fa-solid fa-play";
                if (textEl) textEl.textContent = "点击准备预览";
                if (hintEl) hintEl.textContent = "B站是音视频分离的，会先在本机完整缓存这段视频再播放（之后可拖动进度、可重播，缓存可清理）";
                if (barEl) barEl.style.width = "0%";
            }
        } else {
            if (overlay) overlay.style.display = "none";
            player.src = q.video_url;
        }
    }
}

/* ==========================================================================
   博主主页全量抓取与批量下载逻辑
   ========================================================================== */
const creatorUrlInput = document.getElementById("creatorUrlInput");
const creatorPasteBtn = document.getElementById("creatorPasteBtn");
const creatorClearBtn = document.getElementById("creatorClearBtn");
const creatorParseBtn = document.getElementById("creatorParseBtn") || document.getElementById("creatorFetchBtn");
const creatorResultCard = document.getElementById("creatorResultCard");
const creatorProfileContainer = document.getElementById("creatorProfileContainer");
const creatorBatchActionBar = document.getElementById("creatorBatchActionBar");
const creatorPostsContainer = document.getElementById("creatorPostsContainer");
const creatorLoadMoreContainer = document.getElementById("creatorLoadMoreContainer");
const creatorLoadMoreBtn = document.getElementById("creatorLoadMoreBtn");

window.currentCreatorData = null;
window.selectedPostIds = new Set();

// 博主模式输入框事件
if (creatorUrlInput) {
    creatorUrlInput.addEventListener("input", () => {
        if (creatorUrlInput.value.trim().length > 0) {
            creatorClearBtn.style.display = "inline-flex";
        } else {
            creatorClearBtn.style.display = "none";
        }
        checkBiliInput(creatorUrlInput.value, document.getElementById("biliCreatorHelperBar"));
    });
}

if (creatorClearBtn) {
    creatorClearBtn.addEventListener("click", () => {
        creatorUrlInput.value = "";
        creatorClearBtn.style.display = "none";
        checkBiliInput("", document.getElementById("biliCreatorHelperBar"));
        creatorUrlInput.focus();
    });
}

if (creatorPasteBtn) {
    creatorPasteBtn.addEventListener("click", async () => {
        try {
            const text = await readClipboardText();
            if (text) {
                creatorUrlInput.value = text;
                creatorClearBtn.style.display = "inline-flex";
                checkBiliInput(text, document.getElementById("biliCreatorHelperBar"));
                showToast("已从剪贴板粘贴主页链接", "success");
            }
        } catch (err) {
            showToast("无法访问剪贴板，请手动粘贴", "error");
        }
    });
}

// 提交博主主页解析
if (creatorParseBtn) {
    creatorParseBtn.addEventListener("click", async () => {
        const url = creatorUrlInput.value.trim();
        if (!url) {
            showToast("请先粘贴博主主页链接", "error");
            creatorUrlInput.focus();
            return;
        }

        creatorParseBtn.disabled = true;
        creatorParseBtn.querySelector(".btn-text").style.display = "none";
        creatorParseBtn.querySelector(".btn-loader").style.display = "inline-block";
        creatorResultCard.style.display = "none";
        skeletonLoading.style.display = "grid";

        try {
            const sessdata = getBiliSessdata();
            const payload = { url, cursor: 0, count: 20 };
            if (sessdata) payload.sessdata = sessdata;

            const response = await fetch("/api/user/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.detail || data.error || "获取博主作品失败");
            }

            window.currentCreatorData = data;
            window.selectedPostIds.clear();
            
            // 默认全选第一页作品
            if (data.posts && data.posts.length > 0) {
                data.posts.forEach(p => window.selectedPostIds.add(p.id));
            }

            renderCreatorView(data);
            showToast(`成功获取博主 [${data.user ? data.user.nickname : '主页'}] 的作品！`, "success");
        } catch (err) {
            showToast(err.message || "抓取博主作品异常", "error");
        } finally {
            creatorParseBtn.disabled = false;
            creatorParseBtn.querySelector(".btn-text").style.display = "inline-block";
            creatorParseBtn.querySelector(".btn-loader").style.display = "none";
            skeletonLoading.style.display = "none";
        }
    });
}

// 渲染博主主页完整视图
function renderCreatorView(data) {
    if (!data || !data.user) return;
    const { user, platform_name, posts, has_more } = data;

    // 1. 博主画像卡片
    creatorProfileContainer.innerHTML = `
        <div class="creator-profile-card">
            <div class="creator-avatar-wrap">
                <img class="creator-avatar" src="${user.avatar || '/static/avatar-placeholder.png'}" alt="${user.nickname}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
            </div>
            <div class="creator-details">
                <div class="creator-header-row">
                    <span class="creator-name">${user.nickname}</span>
                    <span class="badge badge-version" style="font-size: 10px; padding: 2px 8px;">${platform_name || '平台'}</span>
                    ${user.unique_id ? `<span class="author-id" style="font-size: 11px;">ID: ${user.unique_id}</span>` : ''}
                </div>
                ${user.signature ? `<div class="creator-signature">${user.signature}</div>` : ''}
                <div class="creator-stats-row">
                    <div class="creator-stat-box">
                        <div class="creator-stat-num">${formatNumber(user.aweme_count || (posts ? posts.length : 0))}</div>
                        <div class="creator-stat-title">作品总数</div>
                    </div>
                    <div class="creator-stat-box">
                        <div class="creator-stat-num">${formatNumber(user.total_favorited)}</div>
                        <div class="creator-stat-title">获赞总计</div>
                    </div>
                    <div class="creator-stat-box">
                        <div class="creator-stat-num">${formatNumber(user.follower_count)}</div>
                        <div class="creator-stat-title">粉丝数量</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 2. 批量操作工具栏
    renderCreatorActionBar();

    // 3. 作品列表网格
    renderCreatorPosts(posts, false);

    // 4. 加载更多按钮
    if (has_more) {
        creatorLoadMoreContainer.style.display = "block";
    } else {
        creatorLoadMoreContainer.style.display = "none";
    }

    creatorResultCard.style.display = "flex";
    creatorResultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

window.currentBatchQuality = "highest";

// 渲染批量操作工具条 (保持用户选择的画质锁定)
function renderCreatorActionBar() {
    const totalCount = window.currentCreatorData && window.currentCreatorData.posts ? window.currentCreatorData.posts.length : 0;
    const selCount = window.selectedPostIds.size;

    // 获取当前已有下拉框的值，避免被重置
    const existingSelect = document.getElementById("batchQualitySelect");
    if (existingSelect && existingSelect.value) {
        window.currentBatchQuality = existingSelect.value;
    }
    const currentQ = window.currentBatchQuality || "highest";

    creatorBatchActionBar.innerHTML = `
        <div class="batch-action-bar">
            <div class="batch-controls-left">
                <button class="btn-secondary-sm" onclick="selectAllPosts(true)" title="全部勾选">
                    <i class="fa-solid fa-check-double"></i> 全选 (${totalCount})
                </button>
                <button class="btn-secondary-sm" onclick="selectAllPosts(false)" title="全部取消">
                    <i class="fa-regular fa-square"></i> 取消全选
                </button>
                <span class="selected-count-badge">已勾选 ${selCount} 项</span>
            </div>
            <div class="batch-btn-group">
                <div class="batch-quality-wrapper" title="选择批量保存时的期望画质">
                    <i class="fa-solid fa-sliders"></i>
                    <select id="batchQualitySelect" class="select-quality-sm" onchange="window.currentBatchQuality = this.value">
                        <option value="highest" ${currentQ === 'highest' ? 'selected' : ''}>🔥 最高画质 (1080P/原画)</option>
                        <option value="720p" ${currentQ === '720p' ? 'selected' : ''}>🎬 720P 高清</option>
                        <option value="480p" ${currentQ === '480p' ? 'selected' : ''}>📱 480P 清晰 (省流)</option>
                    </select>
                </div>
                <button class="btn-primary btn-sm" onclick="batchDownloadDirect()" title="依次调用浏览器下载选中的作品" style="padding: 7px 18px; font-size: 13px;">
                    <i class="fa-solid fa-bolt"></i> 批量极速保存
                </button>
            </div>
        </div>
    `;
}

// 渲染作品矩阵
function renderCreatorPosts(posts, isAppend = false) {
    if (!posts || posts.length === 0) {
        if (!isAppend) {
            creatorPostsContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 36px 16px; background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
                    <i class="fa-solid fa-layer-group" style="font-size: 32px; color: var(--text-dim); margin-bottom: 12px;"></i>
                    <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">已成功获取该博主画像与粉丝获赞数据</div>
                    <div style="font-size: 12px; color: var(--text-dim);">抖音近期对全量作品列表接口实施了防爬风控限制，您可以切换至「单作品解析」复制该博主任意单个视频链接进行秒级无水印解析与高清原图下载。</div>
                </div>
            `;
        }
        return;
    }

    const cardsHtml = posts.map(post => {
        const isSelected = window.selectedPostIds.has(post.id);
        const isImages = post.type === "images";
        const dateStr = post.create_time ? new Date(post.create_time * 1000).toLocaleDateString() : "";
        const durStr = post.duration ? formatDuration(post.duration) : "";

        const isSeason = post.is_season || Boolean(post.season_label);
        const seasonLabel = post.season_label || '合集';

        return `
            <div class="post-card ${isSelected ? 'is-selected' : ''}" id="post_card_${post.id}" onclick="togglePostSelect('${post.id}')">
                <div class="post-thumb-wrap">
                    <img class="post-thumb" src="${post.cover || '/static/avatar-placeholder.png'}" alt="${post.title}" loading="lazy" referrerpolicy="no-referrer">
                    <div class="post-checkbox">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    ${isSeason ? `
                    <div class="post-season-badge" title="这是一个合集/多P作品">
                        <i class="fa-solid fa-layer-group"></i> ${seasonLabel}
                    </div>` : `
                    <div class="post-type-badge">
                        ${isImages ? `<i class="fa-regular fa-images"></i> 图集` : `<i class="fa-solid fa-play"></i> 视频`}
                    </div>`}
                    <div class="post-stat-bottom">
                        <span><i class="fa-regular fa-heart"></i> ${formatNumber(post.digg_count)}</span>
                        ${durStr ? `<span>${durStr}</span>` : ''}
                    </div>
                </div>
                <div class="post-info-meta">
                    <div class="post-title-text" title="${post.title || '无标题'}">
                        ${post.title || '精选作品'}
                    </div>
                    <div class="post-action-row">
                        <span class="post-date-tag">${dateStr}</span>
                        ${isSeason ? `
                        <button class="btn-post-dl" onclick="event.stopPropagation(); parseAndOpenMedia('${post.share_url || post.id}')" title="进入合集解析与下载" style="background: rgba(236, 72, 153, 0.2); border-color: #ec4899; color: #f472b6;">
                            <i class="fa-solid fa-layer-group"></i> 解析合集
                        </button>` : `
                        <button class="btn-post-dl" onclick="event.stopPropagation(); downloadPostItem(window.currentCreatorData.posts.find(p => p.id === '${post.id}'), window.currentBatchQuality || 'highest')" title="按当前选定画质下载">
                            <i class="fa-solid fa-download"></i> 保存
                        </button>`}
                    </div>
                </div>
            </div>
        `;
    }).join("");

    if (isAppend) {
        const grid = creatorPostsContainer.querySelector(".creator-posts-grid");
        if (grid) {
            grid.insertAdjacentHTML("beforeend", cardsHtml);
        }
    } else {
        creatorPostsContainer.innerHTML = `
            <div class="creator-posts-grid">
                ${cardsHtml}
            </div>
        `;
    }
}

// 博主主页批量下载：按博主名归档。
// 十几个/几十个作品平铺在根目录太乱，与"图集/合集各归其位"是同一条思路。
function creatorSubdir() {
    const user = window.currentCreatorData && window.currentCreatorData.user;
    const name = (user && (user.nickname || user.unique_id)) || "";
    const safe = String(name).replace(/[\r\n\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
    return safe ? safe.slice(0, 40) : null;
}

// 针对单个博主作品下载 (自动联动当前选定的期望画质)
async function downloadPostItem(post, targetQuality = (window.currentBatchQuality || "highest")) {
    if (!post) return;
    const isImages = post.type === "images";
    const ext = isImages ? "jpg" : "mp4";
    const safeTitle = (post.title || post.id).replace(/[\r\n\\/:*?"<>|]/g, "_").slice(0, 40);
    const subdir = creatorSubdir();

    // 如果是 B 站视频 / Twitter 视频，调用 /api/parse 提取匹配画质并触发混流下载
    const isBili = post.id && (post.id.startsWith("BV") || post.id.startsWith("bv") || (post.download_url && post.download_url.includes("bilibili.com")));
    const isTwitter = post.download_url && (post.download_url.includes("twitter.com") || post.download_url.includes("x.com"));

    if (isBili || isTwitter) {
        showToast(`正在获取 [${safeTitle.slice(0, 12)}...] 高清媒体流...`, "info");
        try {
            const reqUrl = isBili ? `https://www.bilibili.com/video/${post.id}` : post.download_url;
            const sessdata = getBiliSessdata();
            const payload = { url: reqUrl };
            if (sessdata) payload.sessdata = sessdata;

            const resp = await fetch("/api/parse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.success && data.video) {
                const qualities = data.video.qualities || [];
                let chosenQ = null;

                if (qualities.length > 0) {
                    if (targetQuality === "highest") {
                        chosenQ = qualities[0];
                    } else if (targetQuality === "720p") {
                        chosenQ = qualities.find(q => (q.width >= 1280 || q.height >= 720 || q.label.includes("720P"))) || qualities[0];
                    } else if (targetQuality === "480p") {
                        chosenQ = qualities.find(q => (q.width <= 1056 || q.height <= 480 || q.label.includes("480P"))) || qualities[qualities.length - 1];
                    } else {
                        chosenQ = qualities[0];
                    }
                }

                const vUrl = chosenQ ? chosenQ.video_url : data.video.no_watermark_url;
                const aUrl = chosenQ ? chosenQ.audio_url : data.video.audio_url;

                if (isBili && aUrl) {
                    triggerMuxDownload(vUrl, aUrl, `${safeTitle}.mp4`, { subdir: subdir });
                } else {
                    triggerDownload(vUrl, `${safeTitle}.mp4`, { subdir: subdir });
                }
                return;
            }
        } catch (e) {
            console.error("解析视频异常:", e);
        }
    }

    // 默认直接代理下载
    triggerDownload(post.download_url, `${safeTitle}.${ext}`, { subdir: subdir });
}

// 切换单项选择状态
function togglePostSelect(id) {
    const card = document.getElementById(`post_card_${id}`);
    if (window.selectedPostIds.has(id)) {
        window.selectedPostIds.delete(id);
        if (card) card.classList.remove("is-selected");
    } else {
        window.selectedPostIds.add(id);
        if (card) card.classList.add("is-selected");
    }
    renderCreatorActionBar();
}

// 全选或全不选
function selectAllPosts(selectAll = true) {
    if (!window.currentCreatorData || !window.currentCreatorData.posts) return;
    window.currentCreatorData.posts.forEach(p => {
        const card = document.getElementById(`post_card_${p.id}`);
        if (selectAll) {
            window.selectedPostIds.add(p.id);
            if (card) card.classList.add("is-selected");
        } else {
            window.selectedPostIds.delete(p.id);
            if (card) card.classList.remove("is-selected");
        }
    });
    renderCreatorActionBar();
}

// 批量极速并发下载 (带画质选择)
function batchDownloadDirect() {
    if (window.selectedPostIds.size === 0) {
        showToast("请先勾选需要下载的作品", "error");
        return;
    }
    if (!window.currentCreatorData || !window.currentCreatorData.posts) return;

    const qualitySelect = document.getElementById("batchQualitySelect");
    const targetQuality = qualitySelect ? qualitySelect.value : "highest";
    const qualityLabel = qualitySelect ? qualitySelect.options[qualitySelect.selectedIndex].text.split(" ")[1] || "最高画质" : "最高画质";

    const selectedPosts = window.currentCreatorData.posts.filter(p => window.selectedPostIds.has(p.id));
    showToast(`正在按 [${qualityLabel}] 依次触发 ${selectedPosts.length} 个作品保存...`, "info");

    selectedPosts.forEach((p, idx) => {
        setTimeout(() => {
            downloadPostItem(p, targetQuality);
        }, idx * 1000);
    });
}

// 加载更多博主作品 (分页)
if (creatorLoadMoreBtn) {
    creatorLoadMoreBtn.addEventListener("click", async () => {
        if (!window.currentCreatorData) return;
        const { max_cursor } = window.currentCreatorData;
        const url = creatorUrlInput.value.trim();

        creatorLoadMoreBtn.disabled = true;
        creatorLoadMoreBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> 正在加载更多...`;

        try {
            const sessdata = getBiliSessdata();
            const payload = { url, cursor: max_cursor, count: 20 };
            if (sessdata) payload.sessdata = sessdata;

            const response = await fetch("/api/user/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.detail || data.error || "加载更多作品失败");
            }

            // 追加到全局数据中
            if (data.posts && data.posts.length > 0) {
                window.currentCreatorData.posts.push(...data.posts);
                window.currentCreatorData.max_cursor = data.max_cursor;
                window.currentCreatorData.has_more = data.has_more;

                // 默认勾选新加载项
                data.posts.forEach(p => window.selectedPostIds.add(p.id));

                renderCreatorPosts(data.posts, true);
                renderCreatorActionBar();
            }

            if (!data.has_more) {
                creatorLoadMoreContainer.style.display = "none";
                showToast("已加载该博主的全部公开作品！", "info");
            }
        } catch (err) {
            showToast(err.message || "加载更多失败", "error");
        } finally {
            creatorLoadMoreBtn.disabled = false;
            creatorLoadMoreBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> 加载更多作品`;
        }
    });
}

// 从博主空间直接一键跳转并解析合集作品
function parseAndOpenMedia(url) {
    if (!url) return;
    // 切换到单作品解析 Tab
    const singleTabBtn = document.querySelector('.nav-tab[data-tab="single"]');
    if (singleTabBtn) {
        singleTabBtn.click();
    }
    const inputEl = document.getElementById("urlInput");
    const parseBtn = document.getElementById("parseBtn");
    if (inputEl) {
        inputEl.value = url;
    }
    showToast("正在为您深度解析该合集所有分集...", "info");
    if (parseBtn) {
        parseBtn.click();
    }
}

// ==========================================================================
// 应用内原图预览（灯箱）
// 说明：桌面客户端的 WebView 里 window.open 不是"开新窗口"，而是把主框架
// 导航到目标 URL —— 整个操作界面会被一张图片顶掉且无法返回，故改为应用内预览。
// ==========================================================================
// 图集：按「作品标题」建子目录归档。
// 规则统一为：同一作品产出多个文件时才建目录（图集 / B站合集），单个文件平铺。
function galleryTargetTitle() {
    const g = window.pendingGallery;
    return (g && g.title) || "图集";
}

function gallerySelectedIndexes() {
    return Array.from(document.querySelectorAll("[data-gallery-check]"))
        .filter(el => el.checked)
        .map(el => parseInt(el.dataset.galleryCheck, 10))
        .filter(n => Number.isInteger(n))
        .sort((a, b) => a - b);
}

// 勾选变化：只更新按钮文案与计数，不重建图集（否则会丢掉滚动位置与灯箱状态）
function onGallerySelectChange() {
    const boxes = Array.from(document.querySelectorAll("[data-gallery-check]"));
    if (!boxes.length) return;
    const selected = gallerySelectedIndexes();
    if (window.pendingGallery) window.pendingGallery.selected = new Set(selected);

    const allChecked = selected.length === boxes.length;
    const toggle = document.getElementById("gallerySelectAllBtn");
    if (toggle) {
        toggle.innerHTML = allChecked
            ? `<i class="fa-regular fa-square-check"></i> 取消全选`
            : `<i class="fa-regular fa-square"></i> 全选`;
    }
    const btn = document.getElementById("galleryBatchBtn");
    if (btn) {
        btn.innerHTML = selected.length
            ? `<i class="fa-solid fa-download"></i> 下载选中 ${selected.length} 张`
            : `<i class="fa-solid fa-download"></i> 请先勾选图片`;
    }
    const badge = document.getElementById("galleryCountBadge");
    if (badge) {
        badge.innerHTML = `<i class="fa-regular fa-images"></i> 已选 ${selected.length} / 共 ${boxes.length} 张`;
    }
}

function toggleGallerySelectAll() {
    const boxes = Array.from(document.querySelectorAll("[data-gallery-check]"));
    if (!boxes.length) return;
    const allChecked = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !allChecked; });
    onGallerySelectChange();
}

function openGalleryImage(index) {
    const g = window.pendingGallery;
    if (!g || !g.images || !g.images[index]) return;
    openImagePreview(g.images[index]);
}

function downloadSingleImage(index) {
    const g = window.pendingGallery;
    if (!g || !g.images || !g.images[index]) return;
    triggerDownload(g.images[index], `${g.title}_图${index + 1}.jpg`, { subdir: galleryTargetTitle() });
}

function downloadAllImages() {
    const g = window.pendingGallery;
    if (!g || !g.images || !g.images.length) return;
    const indexes = gallerySelectedIndexes();
    if (!indexes.length) {
        showToast("请先勾选要下载的图片（点图片左上角的方框）", "error");
        return;
    }
    const title = galleryTargetTitle();
    showToast(`正在依次加入选中的 ${indexes.length} 张原图（归档到「${title}」文件夹）...`, "info");
    indexes.forEach((idx, order) => {
        // 逐个错开入队：后端有并发上限，一次性全部提交也会排队，这里只是让顺序更直观
        setTimeout(() => triggerDownload(g.images[idx], `${g.title}_图${idx + 1}.jpg`, { subdir: title }), order * 300);
    });
}

function openImagePreview(url) {
    if (!url) return;
    let box = document.getElementById("imagePreviewBox");
    if (!box) {
        box = document.createElement("div");
        box.id = "imagePreviewBox";
        box.className = "image-preview-overlay";
        box.innerHTML = `
            <img id="imagePreviewImg" alt="高清原图预览">
            <div class="image-preview-bar">
                <span class="image-preview-tip">点击图片任意处关闭 · Esc 退出</span>
                <button type="button" class="btn-secondary-sm" id="imagePreviewSaveBtn">
                    <i class="fa-solid fa-download"></i> 保存这张
                </button>
            </div>
        `;
        box.addEventListener("click", (e) => {
            if (e.target && e.target.id === "imagePreviewSaveBtn") return;
            closeImagePreview();
        });
        document.body.appendChild(box);
        const saveBtn = box.querySelector("#imagePreviewSaveBtn");
        if (saveBtn) saveBtn.addEventListener("click", saveImageFromPreview);
    }
    const img = document.getElementById("imagePreviewImg");
    if (img) img.src = url;
    window.currentPreviewUrl = url;
    box.style.display = "flex";
}

function closeImagePreview() {
    const box = document.getElementById("imagePreviewBox");
    if (box) box.style.display = "none";
    const img = document.getElementById("imagePreviewImg");
    if (img) img.src = "";
    window.currentPreviewUrl = null;
}

function saveImageFromPreview() {
    const url = window.currentPreviewUrl;
    if (!url) return;
    let name = decodeURIComponent((url.split("?")[0].split("/").pop() || "image.jpg"));
    if (!/\.[a-zA-Z0-9]{3,4}$/.test(name)) name += ".jpg";
    // 灯箱里的「保存这张」也归到同一作品的子目录，避免批量/单张归档规则不一致
    const gallery = window.pendingGallery;
    const inGallery = gallery && gallery.images && gallery.images.includes(url);
    if (inGallery) {
        const idx = gallery.images.indexOf(url);
        name = `${gallery.title}_图${idx + 1}.jpg`;
    }
    triggerDownload(url, name, inGallery ? { subdir: galleryTargetTitle() } : undefined);
    closeImagePreview();
    showToast("已加入下载任务", "success");
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImagePreview();
});

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    updateBiliHelperBars();
    initServerArchiving();
});

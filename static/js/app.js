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

// ==========================================================================
// 设备标识（client_id）—— 多设备共用一个后端时的归属凭据
//
// 为什么需要：NAS 上只有一个后端进程、一份 history.json、一份任务表。
// 没有归属的话，任何浏览器打开都是"公共看板"——能看到别人正在下的任务
// （卡片上还带暂停/取消按钮）、能操作别人的任务、能看到并清空所有人的历史。
//
// 粒度说明：标识存在 localStorage，所以粒度是**浏览器**而不是"设备"。
// 同一台电脑的 Safari 与 Chrome 各算一个 —— 这与 B站 SESSDATA 的粒度一致
// （也是每个浏览器独立）。清掉浏览器数据即换了新身份，旧记录不会消失，
// 只是变成"其他设备"的记录，在往期区仍可展开查看。
// ==========================================================================
const UD_CLIENT_ID_KEY = "ud_client_id";

function loadClientId() {
    const fresh = () => (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
        let id = localStorage.getItem(UD_CLIENT_ID_KEY);
        if (!id) {
            id = fresh();
            localStorage.setItem(UD_CLIENT_ID_KEY, id);
        }
        return id;
    } catch (e) {
        // 隐私模式 / 存储被禁：退化成"本次会话一个身份"。隔离仍然生效，
        // 只是刷新后自己也会变成"另一台设备"——好过整个功能不可用。
        console.warn("无法持久化设备标识，降级为会话级:", e);
        return fresh();
    }
}

window.udClientId = loadClientId();

// 统一给**同源**请求带上标识。
//
// 为什么不逐个 fetch 手写：本项目有 30+ 处 fetch 调用，手写一定会漏，
// 而漏掉的那一处就是"隔离静默失效"的地方（表现为某个入口又能看到别人的东西）。
// 注入给第三方 URL 会触发 CORS 预检失败，所以只对同源请求注入。
(function installClientIdHeader() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const sameOrigin = !/^([a-z]+:)?\/\//i.test(url) || url.startsWith(window.location.origin);
        if (!sameOrigin) return originalFetch(input, init);
        const headers = new Headers(
            init.headers
            || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
        );
        headers.set("X-Client-Id", window.udClientId);
        return originalFetch(input, { ...init, headers });
    };
})();

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

// 浏览器只在**安全上下文**（https 或 localhost）下才允许读剪贴板。
// 用 http://<NAS 的 IP>:28760 打开页面时 navigator.clipboard 根本不存在，
// 点了按钮只会弹一句报错 —— 所以干脆把它藏掉，别让用户以为功能坏了。
// 桌面客户端走 pywebview 桥读系统剪贴板，不受这个限制，始终保留按钮。
// 注意：输入框自身的 Ctrl/Cmd + V 一直可用，不依赖这个按钮。
const CLIPBOARD_UNAVAILABLE_HINT = "当前页面不是安全上下文（http），浏览器不允许读取剪贴板 —— 请按 Ctrl/Cmd + V 直接粘贴";

function canUseClipboard() {
    if (window.isDesktop || hasNativeApi()) return true;
    return !!(navigator.clipboard && navigator.clipboard.readText && window.isSecureContext);
}

function syncPasteButtonVisibility() {
    const available = canUseClipboard();
    ["pasteBtn", "creatorPasteBtn"].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.display = available ? "" : "none";
        if (!available) btn.title = CLIPBOARD_UNAVAILABLE_HINT;
    });
    return available;
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
        showToast(CLIPBOARD_UNAVAILABLE_HINT, "error");
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

    // 队列里已有指向同一目标文件的活动任务 → 两条通道都拦掉。
    // 这个检查原先写在下面的服务端分流**之后**，于是 NAS 模式下被 return 跳过，
    // 只剩后端 DuplicateTaskError 兜底（能拦住，但提示要到下一次网络往返才出现）。
    const dup = findActiveTaskByFilename(safeFilename, options.subdir || null);
    if (dup) {
        showToast(`「${safeFilename}」已在下载队列中，未重复添加`, "info");
        toggleTaskManager(true);
        return;
    }

    // NAS 归档模式：必须交给服务端落盘。塞进本地队列的话 runSingleTask
    // 会走浏览器 Blob 下载 —— 文件就存到**打开页面这台电脑**上了。
    if (!window.isDesktop && window.downloadDestination === "server") {
        submitTasksToServerArchive([{
            direct_url: url,
            direct_backup_urls: backupsForUrl(url),
            title: options.title || safeFilename,
            filename: safeFilename,
            subdir: options.subdir || null,
            platform: options.platform || "media",
        }]);
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
        // 直连模式：单轨平台默认仍把远程直链交给 <video> 直接播 —— 秒开、零磁盘、
        // 零后端开销。只有**确实播不了**时才退回到 B站 那条「后端落盘再播」的链路
        // （见 onPreviewDirectFailed）。这样既保住短视频的秒开，又给
        // 「CDN 挑剔 Referer/UA、直链带签名会过期、AVFoundation 不吃这个源」
        // 这类失败留了兜底 —— 原先这些情况一律是黑屏且没有任何补救。
        const isDirectPlay = !isBiliStream && !!noWmUrl;
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
                    ${isDirectPlay ? 'data-direct-play="1" onerror="onPreviewDirectFailed(this)"' : ''}
                    onloadedmetadata="onVideoMetadataLoaded(this)"
                ></video>
                ${(isBiliStream || isDirectPlay) ? `
                <button type="button" class="preview-prepare-overlay" id="previewOverlay"
                        style="${isBiliStream ? '' : 'display: none;'}"
                        onclick="startPreviewPrepare()">
                    <span class="preview-play-btn"><i class="fa-solid fa-play"></i></span>
                    <span class="preview-prepare-text" id="previewPrepareText">点击准备预览</span>
                    <span class="preview-prepare-hint">${isBiliStream
                        ? 'B站是音视频分离的，会先在本机完整缓存这段视频再播放（之后可拖动进度、可重播，缓存可清理）'
                        : '直连播放不可用，改为在本机完整缓存后再播放（之后可拖动进度、可重播，缓存可清理）'}</span>
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
        // 直连模式也要登记参数：一旦直连失败，回退流程正是靠它去调 /api/preview/prepare
        window.pendingPreview = (isBiliStream || isDirectPlay)
            ? { videoUrl: noWmUrl, audioUrl: isBiliStream ? audioUrl : "", title: cleanTitle }
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

    // 播放器是刚重建的，给直连模式装上看门狗（B站本来就是落盘，这里直接返回）
    armDirectPlayWatchdog();
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
// --------------------------------------------------------------------------
// 直连播放的失败兜底
//
// 单轨平台（抖音 / 小红书 / 快手 / 皮皮虾 / 推特）默认把远程直链交给 <video>
// 直接播放：秒开、零磁盘、零后端开销，对短视频明显优于"先完整缓存再播"。
//
// 但这条路很脆：<video> 发不出自定义 Referer/UA/Cookie（页面还设了
// referrerpolicy="no-referrer"），直链带签名会过期，CDN 也可能挑剔请求特征 ——
// 一旦被拒就是黑屏 + 划掉的播放图标，且**没有任何补救入口**。
//
// 这里只在**确认失败**时退回到 B站 那条成熟链路（后端落盘 -> 以文件播放），
// 成功路径一个字节都不碰。判定用两条：媒体 error 事件（403/解码失败会立刻触发）
// 与"迟迟拿不到元数据"的看门狗（静默挂起时用）。
// --------------------------------------------------------------------------

// 直连等待上限。取 10s 偏保守：元数据在文件开头，正常直连通常 1~2s 就到位；
// 超过 10s 还 readyState=0 基本就是被拒或超时，而不是"网慢"。
// 宁可让真失败的等 10s，也不要把"能播只是慢"误判成失败而白等一次完整下载。
const PREVIEW_DIRECT_TIMEOUT_MS = 10000;

// 看门狗代次：换视频/换画质后旧定时器必须失效，否则会把新视频误判成失败
window._previewDirectGen = 0;
window._previewDirectTimer = null;

function _clearDirectPlayWatchdog() {
    if (window._previewDirectTimer) {
        clearTimeout(window._previewDirectTimer);
        window._previewDirectTimer = null;
    }
}

// 渲染结果后调用：给直连模式的播放器装看门狗。非直连模式直接返回。
function armDirectPlayWatchdog() {
    _clearDirectPlayWatchdog();
    const player = document.getElementById("mainVideoPlayer");
    if (!player || player.dataset.directPlay !== "1") return;
    const gen = ++window._previewDirectGen;
    window._previewDirectTimer = setTimeout(() => {
        if (gen !== window._previewDirectGen) return;                     // 已换视频/换画质
        if (document.getElementById("mainVideoPlayer") !== player) return; // 陈旧节点
        if (player.dataset.fallbackDone === "1") return;                  // 已回退过
        if (player.readyState >= 1) return;                               // 拿到元数据 = 直连可用
        onPreviewDirectFailed(player, "直连播放超时（未取到媒体信息）");
    }, PREVIEW_DIRECT_TIMEOUT_MS);
}

// 直连播放失败 -> 切到后端落盘播放。
// 整个过程**只做一次**（fallbackDone 标记）：落盘文件若也出错，不会再回退，
// 否则会陷入"失败 -> 回退 -> 再失败"的死循环。
function onPreviewDirectFailed(videoEl, reason) {
    const player = videoEl || document.getElementById("mainVideoPlayer");
    if (!player || player.dataset.directPlay !== "1") return;
    if (player.dataset.fallbackDone === "1") return;
    if (document.getElementById("mainVideoPlayer") !== player) return;   // 陈旧节点（已切视频）
    const pending = window.pendingPreview;
    if (!pending || !pending.videoUrl) return;

    player.dataset.fallbackDone = "1";
    _clearDirectPlayWatchdog();

    const overlay = document.getElementById("previewOverlay");
    if (!overlay) return;

    console.warn("直连播放不可用，回退到本机缓存播放:", reason || "媒体加载失败");
    // 必须把遮罩显出来：否则黑屏的播放器上没有任何反馈，看起来像点坏了
    overlay.classList.remove("is-error");
    overlay.style.display = "flex";
    // 复用既有的准备流程：它负责进度、文案、以及完成后把 src 换成缓存文件
    startPreviewPrepare();
}

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
    // 元数据到手就说明这条直链是能用的，撤掉看门狗（不能让它晚点再触发一次回退）
    _clearDirectPlayWatchdog();
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

    // 队列检查放在服务端分流**之前**：放在它后面的话 NAS 模式下会被 return 跳过。
    // 刻意不带 subdir 比对：服务端任务镜像进队列时不带子目录信息，带上反而匹配不到
    // （宁可多拦一次，也不要漏拦之后静默覆盖归档里的文件）。
    const dup = findActiveTaskByFilename(safeEpTitle);
    if (dup) {
        showToast(`该分集已在下载队列中，未重复添加`, "info");
        toggleTaskManager(true);
        return;
    }

    // NAS 归档模式：交给服务端（否则浏览器下载会落到本机）
    if (!window.isDesktop && window.downloadDestination === "server") {
        submitTasksToServerArchive([{
            url: shareUrl,
            title: `${seasonTitle} P${pageNum}`,
            filename: safeEpTitle,
            season_title: seasonTitle,
            page_num: pageNum,
            platform: "bilibili",
            sessdata: getBiliSessdata() || null,
        }]);
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
                tipEl.style.display = "inline-flex";
                setDestPathLabel((window.serverConfig && window.serverConfig.download_dir) || "/downloads");
            }
        } else {
            localBtn.classList.add("active");
            serverBtn.classList.remove("active");
            if (tipEl) tipEl.style.display = "none";
        }
    }
}

// ==========================================================================
// NAS / 服务端归档目录：在界面上直接改，不必改 compose 再重建容器
//
// 背景：原先归档目录只能由 DOWNLOAD_DIR 环境变量决定，NAS 用户想换个存储位置
// 就得重建容器 —— 而重建会丢掉正在排队的任务。现在改成持久化设置，界面上可改。
//
// 两个必须守住的口径：
// 1) 只影响**后续**任务（在途任务的目标路径在入队时就算好了，改不了）；
// 2) 写进没挂载的路径时**警告但不阻止** —— 文件能下、界面正常，但容器重建就没了，
//    这是 NAS 上最隐蔽的一类数据损失，所以要明确提示。
// ==========================================================================

// 路径显示在<b>内部 span</b> 上：外层是个按钮、里面还有铅笔图标，
// 直接写 textContent 会把图标一起抹掉。
function setDestPathLabel(text) {
    const inner = document.getElementById("destPathText");
    if (inner) {
        inner.textContent = text || "";
        return;
    }
    const tip = document.getElementById("destPathTip");
    if (tip) tip.textContent = text || "";
}

function openServerDirEditor() {
    const modal = document.getElementById("serverDirModal");
    const input = document.getElementById("serverDirInput");
    const hint = document.getElementById("serverDirHint");
    if (!modal || !input) return;
    input.value = (window.serverConfig && window.serverConfig.server_dir) || "";
    if (hint) hint.textContent = "";
    modal.classList.add("active");
    setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 50);
}

function closeServerDirEditor() {
    const modal = document.getElementById("serverDirModal");
    if (modal) modal.classList.remove("active");
}

// targetDir 省略时读输入框（「保存」按钮走这条），传值时为「恢复默认」
async function saveServerDir(targetDir) {
    const input = document.getElementById("serverDirInput");
    const hint = document.getElementById("serverDirHint");
    const saveBtn = document.getElementById("serverDirSaveBtn");
    const dir = (targetDir !== undefined ? targetDir : (input ? input.value : "")).trim();
    if (!dir) {
        if (hint) hint.textContent = "请填写目录";
        return;
    }
    if (saveBtn) saveBtn.disabled = true;
    if (hint) hint.textContent = "正在保存…";
    try {
        const resp = await fetch("/api/server/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ download_dir: dir }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.detail || `保存失败 (${resp.status})`);

        window.serverConfig = Object.assign({}, window.serverConfig || {}, data);
        setDestPathLabel(data.download_dir || dir);
        setDownloadDestination(window.downloadDestination);   // 按最新配置重渲染路径提示
        closeServerDirEditor();
        if (data.warning) showToast(data.warning, "error");
        else showToast("归档目录已更新（只影响后续任务）", "success");
    } catch (e) {
        if (hint) hint.textContent = e.message || "保存失败";
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// 「恢复默认」= 回到环境变量给的目录（compose 里的 DOWNLOAD_DIR）
function resetServerDir() {
    const def = window.serverConfig && window.serverConfig.default_server_dir;
    const hint = document.getElementById("serverDirHint");
    if (!def) {
        if (hint) hint.textContent = "没有可用的默认目录，请手动填写";
        return;
    }
    saveServerDir(def);
}

// 归档目录弹窗的交互绑定。放在这里自成一块，避免改动文件顶部那一大段
// 弹窗绑定区（那里牵涉多个既有弹窗，动它容易误伤）。
(function bindServerDirModal() {
    const modal = document.getElementById("serverDirModal");
    if (!modal) return;
    const closeBtn = document.getElementById("closeServerDirBtn");
    const saveBtn = document.getElementById("serverDirSaveBtn");
    const resetBtn = document.getElementById("serverDirResetBtn");
    const input = document.getElementById("serverDirInput");
    if (closeBtn) closeBtn.addEventListener("click", closeServerDirEditor);
    if (saveBtn) saveBtn.addEventListener("click", () => saveServerDir());
    if (resetBtn) resetBtn.addEventListener("click", resetServerDir);
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); saveServerDir(); }
        });
    }
    // 与其他弹窗一致：点遮罩空白处关闭
    modal.addEventListener("click", (e) => { if (e.target === modal) closeServerDirEditor(); });
})();

// ==========================================================================
// 桌面客户端：原生保存位置（选择目录 / 打开目录 / 持久化）
// ==========================================================================
function hasNativeApi() {
    return !!(window.pywebview && window.pywebview.api);
}

window.addEventListener("pywebviewready", () => {
    applyDesktopMode();
    syncPasteButtonVisibility();
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
//
// channel="local"  → 查桌面端保存目录。只有桌面端才有意义：浏览器模式下文件落在
//                    用户自己电脑上，服务端根本看不到，无从检查。
// channel="server" → 查 NAS 归档目录。NAS 模式下必须用它，否则重复下载
//                    既没有提示、又会静默覆盖掉归档里已有的文件。
async function resolveFilenameConflict(task, channel = "local") {
    if (!task || !task.filename) return "proceed";
    if (channel === "local" && !window.isDesktop) return "proceed";

    const endpoint = channel === "server" ? "/api/server/check" : "/api/local/check";
    try {
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // 原样把提交时的那几个字段传过去，**目录由后端按同一套规则算** ——
            // 前端自己拼目录就等于把路径规则写了两份，迟早会不同步
            // （本次「重复下载没提示」正是这么来的）。
            body: JSON.stringify({
                filename: task.filename,
                subdir: task.subdir || null,
                season_title: task.season_title || task.seasonTitle || null,
                platform: task.platform || "media",
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
        console.warn("检查同名文件失败，按覆盖继续:", e);
        return "proceed";
    }
}

// 提交到 NAS 归档之前的重复处理。返回处理后的任务数组（空 = 全部跳过或用户取消）。
//
//   单条 → 弹窗问「覆盖重下 / 保留两者 / 取消」，与桌面端保存的行为一致；
//   批量 → **静默跳过归档里已存在的**，最后汇总提示一句。
//          一次可能提交几百个文件（整部合集），逐个弹窗是灾难。
async function resolveArchiveConflicts(items) {
    if (!items || !items.length) return items;

    if (items.length === 1) {
        const item = items[0];
        const decision = await resolveFilenameConflict(item, "server");
        if (decision === "cancel") {
            showToast(`已取消「${item.filename}」的下载`, "info");
            return [];
        }
        if (decision && decision.filename) {
            return [{ ...item, filename: decision.filename }];
        }
        return items;
    }

    // 批量：按「会落到同一个目录」的字段组合分组，每组拉一次清单，再按文件名比对。
    // 分组键是 (subdir, season_title, platform) —— 这三个决定后端往哪个目录写
    // （规则见后端 _plan_target），只有同组内的文件才平铺在同一个目录里。
    const keyOf = (i) => JSON.stringify([i.subdir || "", i.season_title || "", i.platform || "media"]);
    const groups = new Map();
    items.forEach(i => {
        const k = keyOf(i);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
    });

    // 文件名规范化：与后端 sanitize_filename 对齐的轻量版本。
    // 两边规则若不一致，出现的不是"误删"而是"没识别出已存在"（退化成重新下载覆盖），
    // 所以两边各规范化一次更稳。
    const norm = (n) => String(n || "")
        .replace(/[\r\n\\/:*?"<>|]+/g, "_")
        .replace(/^[ ._]+/, "")
        .replace(/[ ._]+$/, "");

    const kept = [];
    for (const group of groups.values()) {
        const head = group[0];
        let existing = new Set();
        try {
            const qs = new URLSearchParams({
                subdir: head.subdir || "",
                season_title: head.season_title || "",
                platform: head.platform || "media",
            });
            const resp = await fetch(`/api/server/files?${qs.toString()}`);
            if (resp.ok) existing = new Set((((await resp.json()).files) || []).map(norm));
        } catch (e) {
            // 拉不到清单就照常提交，不因为检查失败而挡住下载
        }
        group.forEach(i => { if (!existing.has(norm(i.filename))) kept.push(i); });
    }

    const skipped = items.length - kept.length;
    if (skipped > 0) {
        showToast(
            kept.length
                ? `已跳过 ${skipped} 个归档里已存在的文件（共 ${items.length} 个）`
                : `${items.length} 个文件归档里都已存在，未重复下载`,
            "info"
        );
    }
    return kept;
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
                setDestPathLabel(cfg.download_dir);
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
    // http 页面下读不了剪贴板：把粘贴按钮藏掉，而不是让它点了报错
    syncPasteButtonVisibility();

    // 入口常驻：先把气泡显示出来，历史拉回来后再按内容分级刷新。
    // 不能等历史/任务就绪才显示 —— 那正是"第一次有下载任务才出现入口"的老问题。
    updateTaskBubble();
    loadDownloadHistory();

    // 服务端任务的同步分两层：
    //   ① 全量快照 syncServerTasks() —— **界面能否看到任务的权威来源**
    //   ② SSE 增量（/api/server/events）—— 只负责把进度刷得更实时
    //
    // 为什么必须以快照为准：SSE 是"一次性增量事件"，没有任何重放。它一旦没连上
    // （浏览器长时间开着、网络中断、中间层缓冲、事件漏收），任务就**永远**不会
    // 出现在界面上 —— 哪怕它正在跑、甚至已经下载完成。实测复现过：拦掉 SSE 后
    // 提交任务，后端有任务、文件也落盘了，界面却一直显示「本次还没有任务」。
    await syncServerTasks();
    startServerEventStream();
}

// ---------------------------------------------------------------------------
// 服务端任务同步
// ---------------------------------------------------------------------------

// 把一条服务端任务数据应用到前端队列。
// SSE 增量与全量快照**共用同一份逻辑** —— 状态判断写成两份是这个项目踩过的老坑
// （两份口径迟早会不一致，且不一致时表现为"按钮没生效"这类很难查的现象）。
function applyServerTask(data, allowCreate = true) {
    if (!data || !data.id) return false;
    if (data.channel === "preview") return false;   // 预览缓存不在任务列表里呈现
    // 归属兜底：后端已按连接定向推送，这里再判一次。
    // SSE 只是"实时增强"，快照才是权威源；万一有连接串了归属（或将来有人改了
    // 推送规则），界面也不能因为推送而多出别人的任务。
    if (data.owner && data.owner !== window.udClientId) return false;

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
        // 排队原因（"preempted" = 为其他设备让位后在排队续传）
        localTask.queuedReason = data.queued_reason || '';
        // 体积进度（后端逐块统计，用来判断"是不是卡住了"）
        if (typeof data.total_bytes === "number") {
            localTask.totalBytes = data.total_bytes;
            localTask.downloadedBytes = data.downloaded_bytes;
        }
        // 落盘绝对路径（供「在访达中显示」定位文件）
        if (data.save_path) localTask.savePath = data.save_path;
        // 进入终态时记下完成时间：历史区要按它倒序排列，
        // 而且后端此时已经把这条写进 history.json，时间能对上。
        if (['success', 'error', 'canceled'].includes(data.status) && !localTask.finishedAt) {
            localTask.finishedAt = Date.now() / 1000;
        }
        return true;
    }

    if (!allowCreate) return false;
    window.taskQueue.push({
        id: data.id,
        title: `[NAS] ${data.title}`,
        filename: data.filename,
        status: data.status,
        progress: data.progress,
        errorMsg: data.error,
        savePath: data.save_path || '',
        totalBytes: data.total_bytes,
        downloadedBytes: data.downloaded_bytes,
        queuedReason: data.queued_reason || '',
        finishedAt: ['success', 'error', 'canceled'].includes(data.status) ? Date.now() / 1000 : 0,
        isServerTask: true,
    });
    return true;
}

// 拉一次服务端任务全量快照并与前端队列合并。
// 这是「界面能看到服务端任务」的兜底：SSE 断了也靠它把界面拉回正确状态。
//
// 注意「不在队列里 + 已经终态」的任务**不补进来**：终态任务在界面上由「往期记录」
// （history.json）呈现；这里若也无条件补，刷新一次页面就会把服务端内存里几十条
// 旧任务全灌进「本次任务」，反而更乱。已在队列里的则一律更新（用它修正"SSE 断了
// 导致任务卡在下载中"的状态）。
async function syncServerTasks() {
    try {
        const resp = await fetch("/api/server/tasks");
        if (!resp.ok) return false;
        const tasks = (await resp.json()).tasks || [];
        const qsig = () => window.taskQueue.map(t => `${t.id}:${t.status}:${t.progress}`).join('|');
        const before = qsig();
        tasks.forEach(t => {
            const terminal = ['success', 'error', 'canceled'].includes(t.status);
            applyServerTask(t, !terminal);
        });
        if (qsig() === before) return false;
        // 这里刻意**不**调 notifyTasksSettled：页面刚打开时队列从空变满，
        // 会误报一次"全部下载完成"。
        renderTaskManagerUI();
        return true;
    } catch (e) {
        return false;   // 网络抖动时静默，下一轮再同步
    }
}

// SSE 断开期间的兜底轮询。
// SSE 只推增量，断开期间发生的"新任务 / 完成 / 失败"全都收不到，必须靠轮询兜住。
// 句柄挂在 window 上（而不是模块作用域的 let）：一是与 window.taskQueue 等既有状态
// 风格一致，二是运行时可观测（调试"到底有没有在兜底"时很关键）。
window._serverSyncTimer = null;

function startServerSyncFallback() {
    if (window._serverSyncTimer) return;
    window._serverSyncTimer = setInterval(syncServerTasks, 5000);
}

function stopServerSyncFallback() {
    if (window._serverSyncTimer) {
        clearInterval(window._serverSyncTimer);
        window._serverSyncTimer = null;
    }
}

function startServerEventStream() {
    try {
        // 标识只能走 query：EventSource 不支持自定义请求头（浏览器 API 硬限制）。
        // 后端据此把事件**定向**推给同归属的连接 —— 不只是"前端不显示"，
        // 而是别人的任务详情根本不进这条连接。
        const evtSource = new EventSource(
            `/api/server/events?client_id=${encodeURIComponent(window.udClientId)}`
        );
        evtSource.onopen = () => {
            // 连上就停掉兜底轮询，并补一次快照（把断开期间错过的变化补回来）
            stopServerSyncFallback();
            syncServerTasks();
        };
        evtSource.onerror = () => {
            // EventSource 会自己重连；重连成功前的空窗期靠轮询兜底。
            // 如果环境里 SSE 根本建不起来，这里会被反复调用 —— 等价于退化成轮询模式，
            // 界面依然正确，只是进度刷新没那么实时。
            startServerSyncFallback();
        };
        evtSource.onmessage = (e) => {
            try {
                const { event, data } = JSON.parse(e.data);
                const tag = event === "task_added" || (data && data.status === "running");
                if (applyServerTask(data, tag)) {
                    renderTaskManagerUI();
                    notifyTasksSettled();
                }
            } catch (err) {}
        };
    } catch (err) {
        startServerSyncFallback();
    }
}

// 切换任务管理器显示/隐藏/最小化
function toggleTaskManager(show = true) {
    const drawer = document.getElementById("taskManagerDrawer");
    const bubble = document.getElementById("taskManagerBubble");
    if (!drawer || !bubble) return;

    if (show) {
        drawer.style.display = "flex";
        bubble.style.display = "none";
        // 窄屏下这个抽屉几乎占满屏：锁住 body 滚动，否则在列表里滑动会带着
        // 背后的页面一起滚。桌面端不锁（非模态浮层，要能边下边浏览），
        // 所以这条规则写在 max-width: 768px 的媒体查询里。
        document.body.classList.add("tm-drawer-open");
        renderTaskManagerUI();
        refreshPreviewCacheInfo();
    } else {
        drawer.style.display = "none";
        document.body.classList.remove("tm-drawer-open");
        // 入口常驻：此前队列为空时气泡也一起消失，界面上就完全没有入口了，
        // 重启客户端后更是连历史都看不到。现在无论有没有任务都保留入口，
        // 由 updateTaskBubble 按状态分级显示（灰 / 有历史 / 有活跃 / 有失败）。
        updateTaskBubble();
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

// ==========================================================================
// 任务列表分区
//
// 此前所有任务混在一个列表里、按提交顺序 append：46 条「已完成」会把新任务挤到最
// 底部，要往下滚才能看到自己刚加的东西。改为两个区：
//   「进行中」  = running / waiting / paused / error（失败要留在活跃区提醒处理）
//   「已完成与历史」= success / canceled，默认折叠
// 活跃区按**倒序**渲染（新任务在最上面），所以永远不需要滚动。
//
// 历史有两条来源，按 id 去重：
//   1. 当前会话内还留在 taskQueue 里的终态任务；
//   2. 后端 history.json（任务终结时落盘，重启后仍在）。
// ==========================================================================
window.taskHistory = [];          // 后端持久化的历史（最近的在前）—— 只含本设备
window.taskHistoryOthers = [];    // 其他设备的历史（最多 50 条，默认折叠、只读）
window._tmOtherCount = 0;         // 其他设备的记录总数（可能多于已拉回的条数）
window._tmOthersExpanded = false; // 其他设备的记录是否已展开查看
window._tmHistoryExpanded = false; // 往期区是否展开
// 已展开的批次（batch_id 集合）。放在内存里即可：批次是"看历史"的临时视图，
// 不值得落 localStorage，重启后回到折叠态反而更清爽。
window._tmExpandedBatches = new Set();

// 往期区与展开的批次最多各渲染多少项：history.json 条数上限 3000，
// 全渲染会让 DOM 过重（一个 500 集的批次就是 500 个节点）
const TM_HISTORY_RENDER_LIMIT = 50;

// 终态 = 已经结束、不会再变的状态。
// 注意：`error` **不是**终态 —— 失败任务留在「本次任务」区等用户重试。
// 「未结束」一律用 !_tmTerminal(t) 表示，不要再另写一份状态列表（会漏）。
function _tmTerminal(t) {
    return t.status === 'success' || t.status === 'canceled';
}

// 分区模型（v2.5.6.0 起）：**按「本次会话 / 往期」分，而不是按状态分**。
//
// 旧模型按状态分（进行中 / 已完成与历史），结果是任务一完成就立刻离开「进行中」区、
// 落进默认折叠的历史区 —— 卡片在视野里凭空消失，用户会问"我刚下的东西去哪了"。
// 改用「本次 / 往期」之后，"完成"只让卡片就地变灰，不再退场。
// 详见 MEMORY「完成即跳走」。

// 本次任务 = 本会话提交的全部任务（含已完成）。
// 未结束的（含失败，等用户重试）倒序在前 —— 保证运行中的任务永远在最上方；
// 已完成的按完成时间倒序紧随其后，留在同一区域里。
function _tmSessionTasks() {
    const q = window.taskQueue;
    const unfinished = q.filter(t => !_tmTerminal(t)).reverse();
    const finished = q.filter(_tmTerminal)
        .slice()
        .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    return [...unfinished, ...finished];
}

// history.json 的条目 → 任务卡片数据。自己与其他设备的记录共用这一个转换，
// 免得两处字段口径漂移（本项目已多次吃过"同一种数据两份映射"的亏）。
// isOther = true 表示这条记录属于别的设备：只读，不渲染任何操作按钮。
function _tmHistoryEntryToItem(h, isOther = false) {
    return {
        id: h.id,
        title: h.title || h.filename || '已下载',
        filename: h.filename || '',
        status: h.status === 'canceled' ? 'canceled' : (h.status === 'error' ? 'error' : 'success'),
        progress: h.status === 'success' ? 100 : 0,
        sizeBytes: h.size_bytes || 0,
        totalBytes: h.status === 'success' ? (h.size_bytes || 0) : 0,
        downloadedBytes: h.status === 'success' ? (h.size_bytes || 0) : 0,
        savePath: h.save_path || '',
        platform: h.platform || '',
        finishedAt: h.finished_at || 0,
        errorMsg: h.error || '',
        batchId: h.batch_id || '',
        batchTitle: h.batch_title || '',
        fromHistory: true,
        isOtherDevice: isOther,
    };
}

// 往期记录 = 持久化历史里「不属于本次会话」的那部分（重启后加载进来的）
function _tmPastItems() {
    const liveIds = new Set(window.taskQueue.map(t => t.id));
    return window.taskHistory
        .filter(h => !liveIds.has(h.id))
        .map(h => _tmHistoryEntryToItem(h, false));
}

// 其他设备的往期记录：同样按批次折叠，但**逐条标记只读**，且不参与任何计数
// （「清空」的作用范围必须与本设备的数据严格一致，混进来数字就对不上了）。
function _tmOtherItems() {
    return (window.taskHistoryOthers || []).map(h => _tmHistoryEntryToItem(h, true));
}

// 把往期记录按批次折叠。
// 一次合集下载会产出成百上千条记录（实测有过 500 条），平铺会把往期区彻底淹掉、
// 也让"按条淘汰"的上限被一次批量打满。同一次提交（batch_id 相同）合并成一行，
// 展开才列出文件。
function _tmGroupPast(items) {
    const groups = [];
    const byBatch = new Map();
    items.forEach(it => {
        const bid = (it.batchId || '').trim();
        // isOther：整组只读（其他设备的记录）。batch_id 由一次提交生成，
        // 一批里不会混归属；万一数据被手工改乱，只要有一项不属于本设备就整组只读。
        const groupIsOther = !!it.isOtherDevice;
        if (!bid) {
            groups.push({ kind: 'single', item: it, isOther: groupIsOther });
            return;
        }
        let g = byBatch.get(bid);
        if (!g) {
            g = {
                kind: 'batch', batchId: bid, title: it.batchTitle || '批量下载',
                items: [], sizeBytes: 0, finishedAt: 0, isOther: groupIsOther,
            };
            byBatch.set(bid, g);
            groups.push(g);
        }
        if (groupIsOther) g.isOther = true;
        g.items.push(it);
        g.sizeBytes += it.sizeBytes || 0;
        g.finishedAt = Math.max(g.finishedAt, it.finishedAt || 0);
    });
    // 批次内的文件按文件名自然序排（P01、P02…），而不是按完成先后 —— 后者受并发影响会乱
    groups.forEach(g => {
        if (g.kind === 'batch') {
            g.items.sort((a, b) => String(a.filename).localeCompare(
                String(b.filename), undefined, { numeric: true }));
        }
    });
    return groups;
}

// 全部「已完成记录」条数：本次已完成的 + 往期。气泡文案与「清空已完成」按钮共用这个口径，
// 避免两处数字对不上（历史上踩过）。
function _tmCompletedCount(sessionTasks, pastItems) {
    return sessionTasks.filter(_tmTerminal).length + pastItems.length;
}

// 入口气泡：常驻 + 分级
//
// 这个函数会被 renderTaskManagerUI 每次调用（包括每个进度数据块，一个 1.5GB
// 文件约 2.4 万次）。所以状态没变时必须直接返回，绝不能每次写 DOM。
window._tmBubbleState = null;

function updateTaskBubble() {
    const bubble = document.getElementById("taskManagerBubble");
    if (!bubble) return;
    const drawer = document.getElementById("taskManagerDrawer");
    const drawerOpen = !!(drawer && drawer.style.display !== "none");
    // 抽屉展开时气泡让位（同一个位置，否则会被压在下面）
    if (drawerOpen) {
        if (window._tmBubbleState !== "hidden") {
            bubble.style.display = "none";
            window._tmBubbleState = "hidden";
        }
        return;
    }
    const running = window.taskQueue.filter(t => t.status === 'running').length;
    const waiting = window.taskQueue.filter(t => t.status === 'waiting').length;
    const paused = window.taskQueue.filter(t => t.status === 'paused').length;
    const error = window.taskQueue.filter(t => t.status === 'error').length;
    const active = running + waiting + paused;
    // 历史条数取「合并去重后的可见历史」（含本会话刚完成、还没被清掉的任务），
    // 不能只数持久化历史 —— 否则刚下完 3 个文件、历史区明明写着「已完成与历史 · 3」，
    // 气泡却还是「下载管理」，两处对不上。
    const historyCount = window._tmHistoryCount || 0;

    const stateKey = `${running}|${active}|${error}|${historyCount}`;
    if (window._tmBubbleState === stateKey) return;   // 状态没变，一个 DOM 都不碰
    window._tmBubbleState = stateKey;

    const iconEl = document.getElementById("tmBubbleIcon");
    const textEl = document.getElementById("tmBubbleText");
    const badgeEl = document.getElementById("tmBubbleBadge");

    bubble.classList.toggle("is-idle", active === 0 && error === 0 && historyCount === 0);
    bubble.classList.toggle("has-history", active === 0 && error === 0 && historyCount > 0);
    bubble.classList.toggle("has-failed", error > 0);
    bubble.classList.toggle("has-active", active > 0);

    if (iconEl) {
        // 只有真有任务在跑才让它动，常驻时保持安静
        iconEl.classList.toggle("fa-bounce", running > 0);
    }
    if (textEl) {
        if (error > 0) textEl.textContent = `失败 ${error}`;
        else if (active > 0) textEl.textContent = running > 0 ? `下载中 (${running}/${active})` : `待下载 ${active}`;
        // 口径 = 已完成总数（本次 + 往期），与「清空 (N)」按钮一致
        else if (historyCount > 0) textEl.textContent = `已完成 ${historyCount}`;
        else textEl.textContent = "下载管理";
    }
    if (badgeEl) {
        // 徽标只承担"失败数量"这一个语义，避免和文案里的数字重复
        if (error > 0) {
            badgeEl.textContent = String(error);
            badgeEl.style.display = "inline-block";
        } else {
            badgeEl.style.display = "none";
        }
    }
    bubble.title = active > 0 ? "点击展开任务管理器（有任务进行中）" : "点击展开任务管理器";
    bubble.style.display = "flex";
}

function _tmSignature() {
    // 分区之后，签名必须同时覆盖"历史区的可见集合与展开状态"：
    // 否则任务从活跃区转移到历史区（或历史被清空）时不会重建 DOM，
    // 界面会停在上一次的结构上（历史上踩过的整表重建坑的反面）。
    const queuePart = window.taskQueue
        .map(t => [t.id, t.status, t.title, t.filename || '', t.savePath || '', t.queuedReason || ''].join('|'))
        .join('\n');
    // 历史部分的签名由 renderTaskManagerUI 算好缓存（它已经遍历过一遍历史，
    // 而这里的调用频率是"每个进度数据块一次"，不能重复遍历最多 500 条历史）
    return `${queuePart}\n===history:${window._tmHistorySig || ''}`;
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

    // 徽章文案在下面按「活跃数 / 历史数」定稿（这里只取元素引用）
    const totalBadge = document.getElementById("taskTotalBadge");
    const navBadge = document.getElementById("navTaskBadge");
    const rEl = document.getElementById("statRunning"); if (rEl) rEl.textContent = running;
    const wEl = document.getElementById("statWaiting"); if (wEl) wEl.textContent = waiting;
    const pEl = document.getElementById("statPaused"); if (pEl) pEl.textContent = paused;
    const sEl = document.getElementById("statSuccess"); if (sEl) sEl.textContent = success;
    const eEl = document.getElementById("statError"); if (eEl) eEl.textContent = error;

    // 有失败任务时才出现「重试」，并带上数量。
    // 文案是「重试 (N)」而非「重试失败 (N)」：头部宽度实测卡在 636px，
    // 少这两个字（-22px）才能让抽屉在 600px 下任何状态都不折行。
    const retryAllBtn = document.getElementById("btnRetryFailed");
    if (retryAllBtn) {
        retryAllBtn.style.display = error > 0 ? "inline-flex" : "none";
        retryAllBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> 重试 (${error})`;
    }


    // 总进度条
    const overallBar = document.getElementById("overallProgressBar");
    if (overallBar) {
        const percent = total > 0 ? Math.round((success / total) * 100) : 0;
        overallBar.style.width = `${percent}%`;
    }

    const sessionTasks = _tmSessionTasks();
    const pastItems = _tmPastItems();
    const pastGroups = _tmGroupPast(pastItems);
    const completedCount = _tmCompletedCount(sessionTasks, pastItems);
    // 「还要处理」= 未结束的（含失败，等用户重试）
    const unfinishedCount = sessionTasks.length - sessionTasks.filter(_tmTerminal).length;

    // 「清空」按钮：计数口径必须与 clearDownloadHistory 完全一致（已完成总数 = 本次 + 往期），
    // 否则按钮写着 3、实际清掉 5 条，用户会以为漏删或多删。
    // 按钮放在头部工具条而不是往期行：它的作用范围横跨「本次任务」与「往期」两个区域，
    // 挂在任一区域里都会出现"按钮范围 ≠ 所在区域"的歧义（v2.5.5.0 踩过）。
    const clearBtn = document.getElementById("btnClearHistory");
    if (clearBtn) {
        clearBtn.style.display = completedCount > 0 ? "inline-flex" : "none";
        clearBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> 清空 (${completedCount})`;
    }

    // 徽章：优先反映"还要处理的量"，全处理完才退化为已完成条数
    if (totalBadge) {
        totalBadge.textContent = unfinishedCount
            ? `${unfinishedCount} 项进行中`
            : (completedCount ? `已完成 ${completedCount}` : "0 项");
    }
    if (navBadge) {
        if (unfinishedCount) {
            navBadge.style.display = "inline-block";
            navBadge.textContent = unfinishedCount;
        } else {
            navBadge.style.display = "none";
        }
    }

    // 往期区的结构签名（含展开状态、各批次的展开状态、其他设备区的展开状态）：
    // 只算一次，供 _tmSignature 与 updateTaskBubble 复用（两者都在进度事件里高频调用）
    window._tmHistorySig = [
        window._tmHistoryExpanded ? 1 : 0,
        window._tmOthersExpanded ? 1 : 0,
        window._tmOtherCount || 0,
        Array.from(window._tmExpandedBatches || []).sort().join(','),
        pastGroups.map(g => (g.kind === 'batch'
            ? `B:${g.batchId}:${g.items.length}`
            : `S:${g.item.id}:${g.item.status}`)).join('|'),
    ].join('~');
    window._tmHistoryCount = completedCount;

    updateTaskBubble();

    // 结构未变（只是进度在走）：绝不重建 DOM，只原地刷进度，保证节点稳定可点
    const signature = _tmSignature();
    if (signature === window._tmStructureSignature) {
        _tmScheduleProgressPatch();
        return;
    }
    window._tmStructureSignature = signature;

    // 空态：本设备既没有活跃任务也没有往期记录。但**其他设备有记录时不算空** ——
    // 那种情况下要显示"其他设备的记录"这一行（正是新设备/新浏览器最需要看到的信息，
    // 不然用户会以为历史全丢了）。
    if (sessionTasks.length === 0 && pastGroups.length === 0 && !window._tmOtherCount) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 30px 10px; font-size: 12px;">
                <i class="fa-solid fa-list-check" style="font-size: 24px; margin-bottom: 8px; color: var(--text-muted);"></i>
                <div>暂无批量任务</div>
                <div style="margin-top: 6px; font-size: 11px;">下载过的内容会记在这里，重启客户端也不会丢</div>
            </div>
        `;
        return;
    }

    const parts = [];

    // ---- 本次任务：含已完成，完成的任务就地留在这里（不退场） ----
    if (sessionTasks.length) {
        parts.push(`
            <div class="task-list-group">
                <span class="task-list-group-title">
                    <i class="fa-solid fa-bolt" style="color: #38bdf8;"></i> 本次任务
                    <span class="task-list-group-count">· ${sessionTasks.length}</span>
                </span>
                <span class="task-list-group-hint">${
                    unfinishedCount ? `新任务在最上方 · ${unfinishedCount} 项进行中` : "全部已结束"
                }</span>
            </div>
        `);
        // 顺序由 _tmSessionTasks() 决定：未结束的（新→旧）在前，已完成的（新→旧）在后
        sessionTasks.forEach(t => parts.push(renderTaskCard(t, false)));
    } else {
        parts.push(`
            <div style="color: var(--text-dim); padding: 6px 2px 2px; font-size: 12px;">
                本次还没有任务
            </div>
        `);
    }

    // ---- 往期记录：只放重启后从 history.json 加载进来的，按批次折叠 ----
    if (pastGroups.length) {
        const expandIcon = window._tmHistoryExpanded ? "fa-chevron-up" : "fa-chevron-down";
        const batchCount = pastGroups.filter(g => g.kind === 'batch').length;
        const countText = batchCount && batchCount !== pastGroups.length
            ? `${pastGroups.length} 项（含 ${batchCount} 个批次 · ${pastItems.length} 个文件）`
            : `${pastGroups.length} 项`;
        parts.push(`
            <div class="task-history-collapse" data-tm-hist="toggle" title="${window._tmHistoryExpanded ? "收起往期记录" : "展开往期记录"}">
                <span><i class="fa-solid fa-clock-rotate-left"></i> 往期记录 · ${countText}</span>
                <span class="task-history-collapse-actions">
                    <i class="fa-solid ${expandIcon}"></i>
                </span>
            </div>
        `);
        if (window._tmHistoryExpanded) {
            let shown = pastGroups;
            if (pastGroups.length > TM_HISTORY_RENDER_LIMIT) {
                shown = pastGroups.slice(0, TM_HISTORY_RENDER_LIMIT);
                parts.push(`
                    <div style="color: var(--text-dim); font-size: 11px; padding: 2px 2px 0;">
                        仅显示最近 ${TM_HISTORY_RENDER_LIMIT} 项（共 ${pastGroups.length} 项）
                    </div>
                `);
            }
            shown.forEach(g => parts.push(
                g.kind === 'batch' ? renderBatchRow(g) : renderTaskCard(g.item, true)
            ));
        }
    }

    // ---- 其他设备的记录（共用一台 NAS 时别的浏览器下的东西）----
    //
    // 默认折叠且**只读**（后端同样拒绝越权删除）。必须显式列出并给出条数：
    // 换了浏览器/换了设备打开时看不到自己的记录，如果没有这行提示，用户会直接
    // 得出"历史丢了"的结论 —— 而事实是它在那台设备上好好的。
    // 它不参与「清空 (N)」的计数：计数口径必须严格等于本设备的数据范围。
    if (window._tmOtherCount > 0) {
        const otherGroups = _tmGroupPast(_tmOtherItems());
        const oIcon = window._tmOthersExpanded ? "fa-chevron-up" : "fa-chevron-down";
        parts.push(`
            <div class="task-history-collapse" data-tm-hist="others" title="${
                window._tmOthersExpanded ? "收起其他设备的记录" : "查看其他设备的记录（只读）"}">
                <span><i class="fa-solid fa-desktop"></i> 其他设备的记录 · ${window._tmOtherCount} 条</span>
                <span class="task-history-collapse-actions">
                    <i class="fa-solid ${oIcon}"></i>
                </span>
            </div>
        `);
        if (window._tmOthersExpanded) {
            otherGroups.slice(0, TM_HISTORY_RENDER_LIMIT).forEach(g => parts.push(
                g.kind === 'batch' ? renderBatchRow(g) : renderTaskCard(g.item, true)
            ));
            const fetched = (window.taskHistoryOthers || []).length;
            if (window._tmOtherCount > fetched) {
                parts.push(`
                    <div style="color: var(--text-dim); font-size: 11px; padding: 2px 2px 0;">
                        仅显示最近 ${fetched} 条（共 ${window._tmOtherCount} 条）
                    </div>
                `);
            }
        }
    }

    listEl.innerHTML = parts.join("");
}

// 往期里的一个批次：折叠成一行「合集名 · N 个文件 · 体积 · 时间」，点开展开文件
function renderBatchRow(g) {
    const open = window._tmExpandedBatches.has(g.batchId);
    const timeText = g.finishedAt ? _tmFormatTime(g.finishedAt) : "";
    const bid = escapeHtml(g.batchId);
    const shown = open ? g.items.slice(0, TM_HISTORY_RENDER_LIMIT) : [];
    return `
        <div class="task-batch-row${open ? ' is-open' : ''}" data-batch-toggle="${bid}"
             title="点击${open ? "收起" : "展开"} ${escapeHtml(g.title)}">
            <i class="fa-solid fa-layer-group task-batch-icon"></i>
            <span class="task-batch-title">${escapeHtml(g.title)}</span>
            <span class="task-batch-meta">${g.items.length} 个文件 · ${formatBytes(g.sizeBytes)}${
                timeText ? ` · ${timeText}` : ""
            }${g.isOther ? ` · <span title="由其他设备发起，仅可查看">其他设备</span>` : ""}</span>
            ${g.isOther ? "" : `
            <button class="btn-task-action" data-batch-remove="${bid}"
                    title="从往期记录中移除整批（不会删除已下载的文件）">
                <i class="fa-solid fa-trash-can"></i>
            </button>`}
            <i class="fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}"></i>
        </div>
        ${shown.length ? `<div class="task-batch-items">${
            shown.map(it => renderTaskCard(it, true)).join("")
        }</div>` : ""}
    `;
}

// 时间戳 → 「今天 15:50」/「09-23 15:50」，历史条目用
function _tmFormatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    return sameDay ? `今天 ${hm}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

// 渲染单张任务卡片。活跃区与历史区共用，避免两套模板各自漂移。
// isHistory 只会影响视觉（更暗）与可用动作（历史条目没有真正的后端任务，
// 只能"定位文件 / 从历史移除"）。
function renderTaskCard(t, isHistory) {
    let statusLabel = "等待中";
    let statusClass = "status-waiting";
    if (t.status === "running") { statusLabel = `下载中 ${t.progress}%`; statusClass = "status-running"; }
    else if (t.status === "waiting" && t.queuedReason === 'preempted') {
        // 为其他设备让位后重新排队：这不是用户暂停，槽位一空出来就会自己续上。
        // 文案必须和「已暂停」区分开，否则用户会以为自己得点一下才能继续。
        statusLabel = "已让位 · 排队续传"; statusClass = "status-waiting";
    }
    else if (t.status === "paused") { statusLabel = "已暂停"; statusClass = "status-paused"; }
    else if (t.status === "success") { statusLabel = "已完成"; statusClass = "status-success"; }
    else if (t.status === "error") { statusLabel = "失败"; statusClass = "status-error"; }
    else if (t.status === "canceled") { statusLabel = "已取消"; statusClass = "status-canceled"; }

    // 只有真正的活动任务（等待/下载中/已暂停）才有暂停/继续/取消
    const cardActive = t.status === 'running' || t.status === 'waiting' || t.status === 'paused';
    // 历史条目是"只读"的：没有后端任务可操作，只能定位文件或从历史里移除
    const canRemove = !isHistory && t.status !== 'running';

    const sizeText = t.totalBytes
        ? `${formatBytes(t.downloadedBytes || 0)} / ${formatBytes(t.totalBytes)}`
        : (t.sizeBytes ? formatBytes(t.sizeBytes) : "");
    const titleTip = t.savePath ? `${t.title} → ${t.savePath}` : t.title;

    // 平台与完成时间对「本次任务里已完成的卡片」同样有意义（现在它们和历史卡片
    // 在同一屏里并排显示），因此不再用 isHistory 门控，只按有没有值决定。
    const platformTag = t.platform && t.platform !== 'media'
        ? `<span class="task-item-platform">${escapeHtml(t.platform)}</span>` : "";
    const timeTag = t.finishedAt
        ? `<span class="task-item-time">${_tmFormatTime(t.finishedAt)}</span>` : "";

    return `
        <div class="task-item-card is-${t.status}${isHistory ? ' is-history' : ''}" id="task_card_${t.id}">
            <div class="task-item-main">
                <span class="task-item-title" title="${escapeHtml(titleTip)}">${escapeHtml(t.title)}</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    ${platformTag}
                    ${timeTag}
                    <span class="task-item-size" data-task-size="${t.id}">${sizeText}</span>
                    <span class="task-status-badge ${statusClass}" data-task-badge="${t.id}">${statusLabel}</span>
                    <div class="task-item-actions">
                        ${t.status === 'running' ? `
                        <button class="btn-task-action" data-task-action="pause" data-task-id="${t.id}" title="暂停此任务">
                            <i class="fa-solid fa-pause"></i>
                        </button>` : ''}
                        ${t.status === 'paused' || (t.status === 'waiting' && t.queuedReason !== 'preempted') ? `
                        <button class="btn-task-action" data-task-action="resume" data-task-id="${t.id}" title="开始/继续此任务">
                            <i class="fa-solid fa-play"></i>
                        </button>` : ''}
                        ${t.status === 'error' && !isHistory ? `
                        <button class="btn-task-action" data-task-action="retry" data-task-id="${t.id}" title="重试此任务">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </button>` : ''}
                        ${t.status === 'success' && t.savePath ? `
                        <button class="btn-task-action" data-task-action="reveal" data-task-id="${t.id}" title="在访达中显示此文件">
                            <i class="fa-solid fa-folder-open"></i>
                        </button>` : ''}
                        ${cardActive ? `
                        <button class="btn-task-action is-danger" data-task-action="cancel" data-task-id="${t.id}" title="取消此任务（已下载的分片会丢弃）">
                            <i class="fa-solid fa-xmark"></i>
                        </button>` : ''}
                        ${isHistory && !t.isOtherDevice ? `
                        <button class="btn-task-action" data-task-action="forget" data-task-id="${t.id}" title="从历史记录中移除（不删除文件）">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>` : ''}
                        ${canRemove ? `
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
        else if (action === "forget") forgetHistoryItem(taskId);
    };

    // 分区标题行上的操作（展开/收起历史、展开其他设备的记录）。
    // 与任务按钮同样走 pointerdown：这一行也在重建区域内，click 会被重渲染吃掉。
    const runGroupAction = (el) => {
        const act = el.dataset.tmHist;
        if (act === "toggle") {
            window._tmHistoryExpanded = !window._tmHistoryExpanded;
            renderTaskManagerUI();
        } else if (act === "others") {
            window._tmOthersExpanded = !window._tmOthersExpanded;
            renderTaskManagerUI();
        }
    };

    const toggleBatch = (batchId) => {
        if (!batchId) return;
        if (window._tmExpandedBatches.has(batchId)) window._tmExpandedBatches.delete(batchId);
        else window._tmExpandedBatches.add(batchId);
        renderTaskManagerUI();
    };

    // 移除整批：id 集合直接从当前分组里取，避免前端另存一份批次索引
    const removeBatch = (batchId) => {
        const group = _tmGroupPast(_tmPastItems()).find(g => g.batchId === batchId);
        if (!group) return;
        const ids = group.items.map(it => it.id);
        window._tmExpandedBatches.delete(batchId);
        window.taskHistory = window.taskHistory.filter(h => !ids.includes(h.id));
        renderTaskManagerUI();
        deleteHistoryRecords(ids);
    };

    const resolve = (e, attr) => (e.target && e.target.closest ? e.target.closest(`[data-${attr}]`) : null);

    listEl.addEventListener("pointerdown", (e) => {
        const groupEl = resolve(e, "tm-hist");
        if (groupEl) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.stopPropagation();
            runGroupAction(groupEl);
            return;
        }
        // 批次的「移除整批」按钮在可展开的行里，必须先判断它，
        // 否则会被整行的展开动作吞掉（上行同理）
        const batchRemove = resolve(e, "batch-remove");
        if (batchRemove) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.stopPropagation();
            removeBatch(batchRemove.dataset.batchRemove);
            return;
        }
        const batchRow = resolve(e, "batch-toggle");
        if (batchRow) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.stopPropagation();
            toggleBatch(batchRow.dataset.batchToggle);
            return;
        }
        const btn = resolve(e, "task-action");
        if (!btn) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.stopPropagation();
        handledByPointer.add(btn);
        runAction(btn);
    });

    listEl.addEventListener("click", (e) => {
        const btn = resolve(e, "task-action");
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
            showToast(_dupSkipMessage(data.skipped[0]), "info");
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
        task.finishedAt = Date.now() / 1000;   // 历史区按完成时间倒序
        renderTaskManagerUI();
    } catch (err) {
        if (err.name === 'AbortError') {
            // 主动取消是终止态，不能被中断异常改回「已暂停」
            if (task.status !== 'canceled') task.status = 'paused';
        } else {
            task.status = 'error';
            task.errorMsg = err.message || "下载失败";
            task.finishedAt = Date.now() / 1000;
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
    // 终态任务在历史里也有一条同名记录（后端落盘的）。列表里移除了却还在历史里
    // 冒出来，看起来像"移除按钮没生效"，所以同步遗忘。
    //
    // 这里不能用 _tmTerminal：它只含 success/canceled（失败任务要留在活跃区等用户重试），
    // 但后端在 success / error / canceled **三种终态都会落历史**，失败任务同样有记录。
    // 按 _tmTerminal 判断的话，移除一条失败任务不会删它的历史，重启客户端后这条
    // 已经"被移除"的失败任务又会从历史区冒出来。
    if (['success', 'canceled', 'error'].includes(task.status)) {
        deleteHistoryRecords([taskId]);
    }
    renderTaskManagerUI();
}

// ==========================================================================
// 下载历史
// ==========================================================================

// 从后端拉取持久化历史（客户端启动时调用一次）
//
// 后端只回本设备的记录（外加无归属的老记录）当 entries，其他设备的最多回 50 条
// 当 others —— 只用来"展开看看"，所以不需要按需请求，切换纯本地展开。
async function loadDownloadHistory() {
    try {
        const resp = await fetch("/api/history");
        if (!resp.ok) return;
        const data = await resp.json();
        window.taskHistory = Array.isArray(data.entries) ? data.entries : [];
        window.taskHistoryOthers = Array.isArray(data.others) ? data.others : [];
        window._tmOtherCount = data.others_count || 0;
        // 历史变了，结构签名必须作废，否则界面不会重建
        window._tmStructureSignature = null;
        renderTaskManagerUI();
        updateTaskBubble();
    } catch (e) {
        console.warn("加载下载历史失败:", e);
    }
}

// 从历史里移除单条（只删记录，不动文件）
async function forgetHistoryItem(taskId) {
    // 其他设备的记录只读：界面上不渲染按钮，这里再挡一层（纵深防御，
    // 免得将来某处复用这个函数时把别人的记录删了）
    if ((window.taskHistoryOthers || []).some(h => h.id === taskId)) {
        showToast("其他设备的记录只能查看", "info");
        return;
    }
    window.taskHistory = window.taskHistory.filter(h => h.id !== taskId);
    // 会话内还没被清掉的任务也一并从列表移除，避免"删了还在"
    window.taskQueue = window.taskQueue.filter(t => t.id !== taskId);
    renderTaskManagerUI();
    await deleteHistoryRecords([taskId]);
}

async function deleteHistoryRecords(ids) {
    if (!ids || !ids.length) return;
    try {
        const resp = await fetch("/api/history/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
        });
        if (!resp.ok) throw new Error("删除失败");
    } catch (e) {
        console.warn("删除历史记录失败:", e);
        showToast("删除历史记录失败，请稍后再试", "error");
    }
}

// 清空**本设备的全部已完成记录**：本次会话的已完成/已取消 + 本设备的全部往期。
//
// 范围严格等于「本设备」：后端按设备标识过滤，其他设备的记录一条都不动
// （共用 NAS 时一个人点清空、全家历史归零是灾难）。往期区里"其他设备的记录"
// 因此不计入这里的计数，也不需要重新拉取。
//
// 为什么放在抽屉头部而不是往期行上：它的范围横跨「本次任务」与「往期记录」两块区域，
// 挂在任一块里都会出现"按钮范围 ≠ 所在区域"的歧义 —— 这在 v2.5.5.0 已经踩过一次
// （点了「清空历史」历史区却还有东西，因为本次会话刚完成的那些不在清理范围内）。
// 头部工具条本来就是全局批量操作区（暂停全部 / 开始全部 / 取消全部 / 重试），语义一致。
//
// 失败(error)任务刻意不动：它留在「本次任务」区等用户重试或看失败原因，
// 不该被"清空"顺手带走。
//
// 顺序上**先请求后端、成功后再改本地状态**。反过来（乐观更新 + 失败回滚）看着更快，
// 但回滚不完整：本地已经把这批终态任务从 taskQueue 里删掉了，而 syncTaskStatusFromServer
// 只能同步"已存在的任务"，救不回被删的条目，界面就停在"已清空"的假象上。
// 请求走的是本机回环，这点延迟看不出来。
async function clearDownloadHistory() {
    const sessionTasks = _tmSessionTasks();
    const pastItems = _tmPastItems();
    // 计数口径与头部「清空 (N)」按钮完全一致，改一处必须改另一处
    const count = _tmCompletedCount(sessionTasks, pastItems);
    if (!count) {
        showToast("暂无已完成记录", "info");
        return;
    }
    try {
        const resp = await fetch("/api/history/clear", { method: "POST" });
        if (!resp.ok) throw new Error("清空失败");
    } catch (e) {
        console.warn("清空已完成记录失败:", e);
        showToast("清空失败，请稍后再试", "error");
        return;                       // 本地状态一个字节都没动，无需回滚
    }
    const settledIds = sessionTasks.filter(_tmTerminal).map(t => t.id);
    window.taskQueue = window.taskQueue.filter(t => !settledIds.includes(t.id));
    window.taskHistory = [];
    window._tmExpandedBatches.clear();
    window._tmStructureSignature = null;
    renderTaskManagerUI();
    showToast(`已清空 ${count} 条已完成记录（文件未被删除）`, "info");
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
    // 历史条目（重启后从 history.json 恢复的那种）不在 taskQueue 里，
    // 但它的落盘路径是记在历史里的，照样能定位。
    const historyEntry = task ? null : window.taskHistory.find(h => h.id === taskId);
    const path = (task && task.savePath) || (historyEntry && historyEntry.save_path);
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

// 「清除完成」按钮已并入「清空历史」（见 clearDownloadHistory）。
// 分区之后终态任务已并入历史区，独立的「已完成列表」不复存在，
// 这个按钮的作用域与「清空历史」重叠，且重叠处会出现"点了清不干净"的错觉。

// 提交一批任务给**服务端/NAS 归档**（后端自己落盘到挂载目录）。
//
// 为什么需要它：浏览器的下载是"存到打开页面这台电脑"，而 NAS 归档是"存到
// 容器挂载的目录"。两者只能选一个，前端必须在入队前就分开 —— 一旦塞进本地
// taskQueue，runSingleTask 就会用 Blob 下载（必然落到本机）。
// 原先只有「合集/分P」做了这个判断，单条视频、图集、单集下载都漏了。
//
// 返回是否至少创建了 1 个任务。
// 重复入队的提示文案。
//
// 后端的"同一目标路径只允许一个活动任务"是**跨设备**判定（归档目录只有一份，
// 去重一旦按设备切开就会有两个协程写同一个临时文件）。所以"已在下载队列中"那条任务
// 很可能属于别的设备 —— 而它不在本设备的任务列表里。不说清楚，用户会去翻一条
// 根本不存在的任务，然后怀疑是界面丢了任务。
function _dupSkipMessage(skip) {
    const base = (skip && skip.reason) || "该文件已在下载队列中";
    if (skip && skip.existing_owner && skip.existing_owner !== window.udClientId) {
        return `${base}（由其他设备发起，本设备看不到该任务）`;
    }
    return base;
}

async function submitTasksToServerArchive(items, options = {}) {
    if (!items || !items.length) return false;

    // 归档目录里已有同名文件时先处理：单条弹窗、批量跳过。
    // 少了这一步，重复下载既没有任何提示、又会静默覆盖掉归档里的原文件
    // （此前只有桌面端保存那条通道有检查，归档通道一直缺失）。
    if (options.checkDuplicates !== false) {
        items = await resolveArchiveConflicts(items);
        if (!items.length) return false;
    }

    try {
        const resp = await fetch("/api/server/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: items }),
        });
        const res = await resp.json().catch(() => ({}));
        if (!resp.ok || !res.success) {
            showToast(res.detail || "提交 NAS 归档失败", "error");
            return false;
        }
        const created = res.count || 0;
        const skipped = res.skipped_count || 0;

        // 把后端返回的任务对象直接入队 —— **不等 SSE**。
        // SSE 只是增量通道，不能当作"任务能否显示"的唯一来源：它一旦没连上或漏了
        // 事件，界面就会一直空白（实测复现过）。这里同步入队，界面立刻就能看到。
        (res.tasks || []).forEach(t => applyServerTask(t, true));
        if (created > 0) {
            renderTaskManagerUI();
            showToast(options.toastOk || `已提交 ${created} 个任务到 NAS 归档（存到挂载目录，不占本机）`, "success");
        } else if (skipped > 0) {
            const first = (res.skipped && res.skipped[0]) || {};
            showToast(_dupSkipMessage(first), "info");
        }
        if (options.openDrawer !== false) toggleTaskManager(true);
        return created > 0;
    } catch (e) {
        showToast("网络请求异常: " + e.message, "error");
        return false;
    }
}

// 批量下载当前选集所有分集入口
async function downloadAllEpisodes(mode = 'direct') {
    if (!window.currentMediaData || !window.currentMediaData.episodes) return;
    const episodes = window.currentMediaData.episodes;
    const seasonTitle = window.currentMediaData.season_title || window.currentMediaData.title || "合集视频";
    const safeSeasonTitle = seasonTitle.replace(/[\r\n\\/:*?"<>|]+/g, '_').slice(0, 40);

    // 用户选了 NAS/服务端归档：整批一次提交，由后端建目录落盘
    if (!window.isDesktop && window.downloadDestination === 'server') {
        const sessdata = getBiliSessdata();
        const root = (window.serverConfig && window.serverConfig.download_dir) || "/downloads";
        await submitTasksToServerArchive(
            episodes.map(ep => ({
                url: ep.share_url,
                title: ep.title || `第${ep.page}集`,
                season_title: seasonTitle,
                platform: "bilibili",
                page_num: ep.page,
                sessdata: sessdata || null,
            })),
            { toastOk: `🎉 成功提交！NAS 正在自动在 ${root}/${safeSeasonTitle} 下建目录归档下载！` }
        );
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

    // 与 triggerDownload 一致：队列检查必须在服务端分流**之前**，
    // 否则 NAS 模式下会被下面的 return 跳过（这里原先连检查都没有）。
    const dup = findActiveTaskByFilename(safeFilename, options.subdir || null);
    if (dup) {
        showToast(`「${safeFilename}」已在下载队列中，未重复添加`, "info");
        toggleTaskManager(true);
        return;
    }

    // NAS 归档模式：音视频双轨也交给服务端混流落盘（理由同 triggerDownload）
    if (!window.isDesktop && window.downloadDestination === "server") {
        submitTasksToServerArchive([{
            direct_url: videoUrl,
            audio_url: audioUrl,
            direct_backup_urls: backupsForUrl(videoUrl),
            audio_backup_urls: backupsForUrl(audioUrl),
            title: options.title || safeFilename,
            filename: safeFilename,
            subdir: options.subdir || null,
            platform: options.platform || "media",
        }]);
        return;
    }

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
        // 换画质 = 换了一组直链，直连模式也要登记新参数（失败回退靠它）
        window.pendingPreview = bilisTream
            ? { videoUrl: q.video_url, audioUrl: q.audio_url, title: cleanTitle }
            : { videoUrl: q.video_url, audioUrl: "", title: cleanTitle };
        window.previewJobToken = (window.previewJobToken || 0) + 1;   // 作废上一次轮询
        // 旧的看门狗必须先撤掉，否则它会把"刚换上的新直链"当成上一个视频超时来处理
        _clearDirectPlayWatchdog();

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
            // 换了新直链就必须重置兜底状态：新地址可能是好的。
            // 不重置的话 fallbackDone 会一直是 "1"，新地址再失败也不会回退了。
            player.dataset.fallbackDone = "";
            if (textEl) textEl.textContent = "点击准备预览";
            if (iconEl) iconEl.className = "fa-solid fa-play";
            if (barEl) barEl.style.width = "0%";
            if (hintEl) hintEl.textContent = "直连播放不可用，改为在本机完整缓存后再播放（之后可拖动进度、可重播，缓存可清理）";
            armDirectPlayWatchdog();
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
            showToast(CLIPBOARD_UNAVAILABLE_HINT, "error");
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

    // NAS 归档模式：整批一次请求（逐张提交会开 N 次请求、弹 N 次提示）
    if (!window.isDesktop && window.downloadDestination === "server") {
        submitTasksToServerArchive(
            indexes.map(idx => ({
                direct_url: g.images[idx],
                title: `${g.title}_图${idx + 1}.jpg`,
                filename: `${g.title}_图${idx + 1}.jpg`,
                subdir: title,
                platform: "media",
            })),
            { toastOk: `已提交 ${indexes.length} 张原图到 NAS 归档（归档到「${title}」文件夹）` }
        );
        return;
    }

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
    // NAS 归档模式下 triggerDownload 自己已经弹过提示，不再重复
    if (window.isDesktop || window.downloadDestination !== "server") {
        showToast("已加入下载任务", "success");
    }
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // 最上层优先：改归档目录的弹窗是带输入框的模态，Esc 先关它
    // （只有它自己开着时才处理，否则照旧往下走，不影响预览与抽屉）
    const dirModal = document.getElementById("serverDirModal");
    if (dirModal && dirModal.classList.contains("active")) {
        closeServerDirEditor();
        return;
    }
    // 优先级按"谁在最上层"来：图片预览是全屏遮罩，先关它；它没开才轮到任务抽屉。
    // Esc 关闭是桌面应用的硬惯例，而这个抽屉此前完全不响应 Esc
    //（Esc 只关图片预览），用户只能去点右上角的收起箭头。
    const box = document.getElementById("imagePreviewBox");
    if (box && box.style.display !== "none") {
        closeImagePreview();
        return;
    }
    const drawer = document.getElementById("taskManagerDrawer");
    if (drawer && drawer.style.display !== "none") toggleTaskManager(false);
});

// 点抽屉外的**空白处**收起抽屉。
//
// 只对非交互元素生效：点按钮 / 输入框 / 链接 / 下拉一律不收。
// 这不是洁癖 —— 抽屉里有未提交状态（图集勾选、保存目录、并发设置），
// 用户在"粘贴链接 → 提交"的过程中点一下主区按钮就被收起，会直接打断
// "提交完看任务出现在列表里"这条动线。点真正的空白处才收起，规则简单可预测。
//
// 不加遮罩：这个面板是非模态的，价值就在于"边下边继续操作"，加遮罩会把这条路堵死。
// 收起后的代价也很低 —— 入口气泡常驻，随时点回来。
const _TM_OUTSIDE_IGNORE = [
    "button", "a", "input", "select", "textarea", "label",
    "[contenteditable='true']", ".modal-overlay", ".modal-card",
    ".image-preview-overlay",
].join(",");

document.addEventListener("pointerdown", (e) => {
    const drawer = document.getElementById("taskManagerDrawer");
    if (!drawer || drawer.style.display === "none") return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (drawer.contains(t)) return;                       // 抽屉内部
    const bubble = document.getElementById("taskManagerBubble");
    if (bubble && bubble.contains(t)) return;             // 气泡自己负责开合
    if (t.closest(_TM_OUTSIDE_IGNORE)) return;            // 交互元素 / 弹窗：不收起
    toggleTaskManager(false);
});

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    updateBiliHelperBars();
    initServerArchiving();
});

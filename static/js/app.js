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

// 粘贴按钮
pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
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

// 触发代理下载
function triggerDownload(url, filename) {
    const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`正在下载: ${filename}`, "info");
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

        // 视频播放源：B站等音视频分离流走后端实时混流流式代理 (带声音且 100% 兼容 iOS/Safari)
        const isBiliStream = isBilibili && audioUrl;
        const previewSrc = isBiliStream
            ? `/api/stream/mux?video_url=${encodeURIComponent(noWmUrl)}&audio_url=${encodeURIComponent(audioUrl)}&inline=true`
            : noWmUrl;

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
            </div>
        `;

        const hasQualities = video.qualities && video.qualities.length > 0;
        const defaultQ = hasQualities ? video.qualities[0] : null;
        const defaultQName = defaultQ ? defaultQ.label.split("(")[0].trim() : (video.ratio || '高清');

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
        const galleryItems = images.map((imgUrl, idx) => `
            <div class="gallery-item" title="点击新窗口查看原图" onclick="window.open('${imgUrl}', '_blank')">
                <img src="${imgUrl}" alt="图片 ${idx + 1}" loading="lazy" referrerpolicy="no-referrer">
                <div class="gallery-item-action" onclick="event.stopPropagation()">
                    <span class="gallery-idx">#${idx + 1}</span>
                    <button class="btn-gallery-dl" onclick="triggerDownload('${imgUrl}', '${cleanTitle}_图${idx + 1}.jpg')" title="下载此图">
                        <i class="fa-solid fa-download"></i> 保存
                    </button>
                </div>
            </div>
        `).join("");

        mediaHtml = `
            <div class="images-gallery-container">
                <div class="gallery-header">
                    <span class="gallery-count-badge"><i class="fa-regular fa-images"></i> 共 ${images.length} 张高清原图</span>
                    <span style="font-size: 11px; color: var(--text-dim);">点击图片预览原图</span>
                </div>
                <div class="gallery-grid">
                    ${galleryItems}
                </div>
            </div>
        `;

        actionsHtml = `
            <div class="download-action-grid">
                <button class="btn-primary grid-span-2" onclick="downloadAllImages(${JSON.stringify(images).replace(/"/g, '&quot;')}, '${cleanTitle}')">
                    <i class="fa-solid fa-download"></i> 批量下载全部高清原图 (${images.length}张)
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

    // 选集 / 分P合集面板渲染
    let episodesHtml = "";
    if (data.episodes && data.episodes.length > 1) {
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
                    </div>
                </div>
            `;
        }).join("");

        episodesHtml = `
            <div class="episodes-section" id="episodesSection">
                <div class="episodes-header-row">
                    <div class="episodes-title-group">
                        <span class="episodes-title"><i class="fa-solid fa-layer-group text-gradient"></i> 视频选集 / 分P合集</span>
                        <span class="episodes-count-badge">共 ${data.episodes.length} 集</span>
                        ${data.season_title ? `<span class="episodes-season-badge" title="${data.season_title}">合集: ${data.season_title}</span>` : ''}
                    </div>
                    <div class="episodes-tools">
                        <input type="text" class="episodes-search-input" id="episodeSearchInput" placeholder="🔍 搜索分集/序号..." oninput="onEpisodeSearch(this.value)">
                        <button class="btn-episodes-tool" onclick="copyAllEpisodesLinks()" title="一键复制全部分P链接">
                            <i class="fa-regular fa-copy"></i> 复制全部链接
                        </button>
                    </div>
                </div>
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

// 视频元数据加载完成后自适应比例
function onVideoMetadataLoaded(videoEl) {
    if (!videoEl) return;
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

// 批量下载图集
function downloadAllImages(imgList, baseTitle) {
    if (!imgList || imgList.length === 0) return;
    showToast(`正在依次触发 ${imgList.length} 张图片下载...`, "info");
    imgList.forEach((url, i) => {
        setTimeout(() => {
            triggerDownload(url, `${baseTitle}_图${i + 1}.jpg`);
        }, i * 400);
    });
}

// 内存混流下载 (针对 B站 等 DASH 音视频分离格式)
function triggerMuxDownload(videoUrl, audioUrl, filename) {
    if (!videoUrl) {
        showToast("视频链接无效", "error");
        return;
    }
    const safeFilename = filename || "bilibili_video.mp4";
    const muxUrl = `/api/stream/mux?video_url=${encodeURIComponent(videoUrl)}&audio_url=${encodeURIComponent(audioUrl || '')}&filename=${encodeURIComponent(safeFilename)}`;
    
    showToast("正在启动内存流式混流引擎，即将开始下载...", "info");
    
    const a = document.createElement("a");
    a.href = muxUrl;
    a.download = safeFilename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

    // 同步更新网页播放器
    const player = document.getElementById("mainVideoPlayer");
    if (player && q.video_url) {
        if (isBilibili && q.audio_url) {
            player.src = `/api/stream/mux?video_url=${encodeURIComponent(q.video_url)}&audio_url=${encodeURIComponent(q.audio_url)}&inline=true`;
        } else {
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
            const text = await navigator.clipboard.readText();
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

        return `
            <div class="post-card ${isSelected ? 'is-selected' : ''}" id="post_card_${post.id}" onclick="togglePostSelect('${post.id}')">
                <div class="post-thumb-wrap">
                    <img class="post-thumb" src="${post.cover || '/static/avatar-placeholder.png'}" alt="${post.title}" loading="lazy" referrerpolicy="no-referrer">
                    <div class="post-checkbox">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="post-type-badge">
                        ${isImages ? `<i class="fa-regular fa-images"></i> 图集` : `<i class="fa-solid fa-play"></i> 视频`}
                    </div>
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
                        <button class="btn-post-dl" onclick="event.stopPropagation(); downloadPostItem(window.currentCreatorData.posts.find(p => p.id === '${post.id}'), window.currentBatchQuality || 'highest')" title="按当前选定画质下载">
                            <i class="fa-solid fa-download"></i> 保存
                        </button>
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

// 针对单个博主作品下载 (自动联动当前选定的期望画质)
async function downloadPostItem(post, targetQuality = (window.currentBatchQuality || "highest")) {
    if (!post) return;
    const isImages = post.type === "images";
    const ext = isImages ? "jpg" : "mp4";
    const safeTitle = (post.title || post.id).replace(/[\r\n\\/:*?"<>|]/g, "_").slice(0, 40);

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
                    triggerMuxDownload(vUrl, aUrl, `${safeTitle}.mp4`);
                } else {
                    triggerDownload(vUrl, `${safeTitle}.mp4`);
                }
                return;
            }
        } catch (e) {
            console.error("解析视频异常:", e);
        }
    }

    // 默认直接代理下载
    triggerDownload(post.download_url, `${safeTitle}.${ext}`);
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

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    updateBiliHelperBars();
});

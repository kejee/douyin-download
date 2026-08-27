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

// 监听输入框变化
urlInput.addEventListener("input", () => {
    if (urlInput.value.trim().length > 0) {
        clearBtn.style.display = "inline-flex";
    } else {
        clearBtn.style.display = "none";
    }
});

// 清空按钮
clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.style.display = "none";
    urlInput.focus();
});

// 粘贴按钮
pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            urlInput.value = text;
            clearBtn.style.display = "inline-flex";
            showToast("已从剪贴板粘贴内容", "success");
        } else {
            showToast("剪贴板为空", "info");
        }
    } catch (err) {
        showToast("无法访问剪贴板，请手动粘贴", "error");
    }
});

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
        const response = await fetch("/api/parse", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: text }),
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

// 渲染结果
function renderResult(data) {
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

        // 视频播放器
        mediaHtml = `
            <div class="media-preview-container">
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
                ></video>
            </div>
        `;

        const primaryBtnClick = isBilibili && audioUrl
            ? `triggerMuxDownload('${noWmUrl}', '${audioUrl}', '${cleanTitle}_完整高清.mp4')`
            : `triggerDownload('${noWmUrl}', '${cleanTitle}_${isPipixia ? '高清' : (isBilibili ? '高清' : (isTwitter ? '高清' : '无水印'))}.mp4')`;

        const primaryBtnTitle = isBilibili 
            ? `下载高清视频 (${video.ratio || '1080P'} 带声音 MP4)` 
            : (isPipixia || isTwitter ? `下载高清视频 (${video.ratio || '高清'} MP4)` : '下载无水印视频 (高清 MP4)');

        // 多画质下拉选择器 (支持 B站 与 Twitter 等)
        let qualitySelectorHtml = "";
        if (video.qualities && video.qualities.length > 1) {
            const optionsHtml = video.qualities.map((q, idx) => `
                <option value="${idx}" ${idx === 0 ? 'selected' : ''}>
                    ${q.label}
                </option>
            `).join("");
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
        // 图集展示
        const galleryItems = images.map((imgUrl, idx) => `
            <div class="gallery-item">
                <img src="${imgUrl}" alt="图片 ${idx + 1}" loading="lazy" referrerpolicy="no-referrer">
                <div class="gallery-item-action">
                    <button class="btn-secondary-sm" onclick="triggerDownload('${imgUrl}', '${cleanTitle}_图${idx + 1}.jpg')">
                        <i class="fa-solid fa-download"></i> 图 ${idx + 1}
                    </button>
                </div>
            </div>
        `).join("");

        mediaHtml = `
            <div class="images-gallery-container">
                <div class="gallery-grid">
                    ${galleryItems}
                </div>
            </div>
        `;

        actionsHtml = `
            <div class="download-action-grid">
                <button class="btn-primary grid-span-2" onclick="downloadAllImages(${JSON.stringify(images).replace(/"/g, '&quot;')}, '${cleanTitle}')">
                    <i class="fa-solid fa-download"></i> 批量下载全部高清图片 (${images.length}张)
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

    resultContainer.innerHTML = `
        <div class="result-layout">
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
        </div>
    `;

    resultContainer.style.display = "block";
    resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

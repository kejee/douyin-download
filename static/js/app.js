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

openDisclaimerBtn.addEventListener("click", openDisclaimer);
footerDisclaimerLink.addEventListener("click", openDisclaimer);
closeDisclaimerBtn.addEventListener("click", closeDisclaimer);
acceptDisclaimerBtn.addEventListener("click", () => {
    closeDisclaimer();
    showToast("已确认免责声明", "success");
});
disclaimerModal.addEventListener("click", (e) => {
    if (e.target === disclaimerModal) closeDisclaimer();
});

// 格式化数字 (如点赞数)
function formatNumber(num) {
    if (!num) return "0";
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + "w";
    }
    return num.toLocaleString();
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
        showToast("请输入或粘贴抖音分享内容", "error");
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
        showToast("解析成功！", "success");
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
    const { type, title, author, statistics, music, cover, video, images, id } = data;
    const cleanTitle = title || `douyin_${id}`;

    let mediaHtml = "";
    let actionsHtml = "";

    if (type === "video") {
        const noWmUrl = video.no_watermark_url;
        const wmUrl = video.watermark_url;

        // 视频播放器 (优先使用代理或真实无水印链接)
        mediaHtml = `
            <div class="media-preview-container">
                <video 
                    src="${noWmUrl}" 
                    poster="${cover}" 
                    controls 
                    playsinline
                    preload="metadata"
                ></video>
            </div>
        `;

        actionsHtml = `
            <div class="download-action-grid">
                <button class="btn-primary grid-span-2" onclick="triggerDownload('${noWmUrl}', '${cleanTitle}_无水印.mp4')">
                    <i class="fa-solid fa-download"></i> 下载无水印视频 (高清 MP4)
                </button>
                <button class="btn-secondary" onclick="triggerDownload('${wmUrl}', '${cleanTitle}_带水印.mp4')">
                    <i class="fa-solid fa-water"></i> 下载带水印视频
                </button>
                ${music && music.url ? `
                <button class="btn-secondary btn-outline-cyan" onclick="triggerDownload('${music.url}', '${cleanTitle}_原声.mp3')">
                    <i class="fa-solid fa-music"></i> 提取背景音乐 MP3
                </button>` : ''}
                <button class="btn-secondary" onclick="copyToClipboard('${noWmUrl}', '无水印直链')">
                    <i class="fa-regular fa-copy"></i> 复制无水印直链
                </button>
                <button class="btn-secondary" onclick="copyToClipboard('${wmUrl}', '带水印直链')">
                    <i class="fa-regular fa-copy"></i> 复制带水印直链
                </button>
                ${cover ? `
                <button class="btn-secondary grid-span-2" onclick="triggerDownload('${cover}', '${cleanTitle}_封面.jpg')">
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
                <img src="${imgUrl}" alt="图片 ${idx + 1}" loading="lazy">
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
    }

    resultContainer.innerHTML = `
        <div class="result-layout">
            <div class="media-column">
                ${mediaHtml}
            </div>
            <div class="info-panel">
                <div class="author-box">
                    <img class="author-avatar" src="${author.avatar || '/static/avatar-placeholder.png'}" alt="${author.nickname}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="author-meta">
                        <span class="author-name">${author.nickname}</span>
                        <span class="author-id">抖音号：${author.unique_id}</span>
                    </div>
                </div>

                <div class="video-desc">
                    ${title || '无作品描述'}
                </div>

                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-val">${formatNumber(statistics.digg_count)}</div>
                        <div class="stat-label">获赞</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${formatNumber(statistics.comment_count)}</div>
                        <div class="stat-label">评论</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${formatNumber(statistics.share_count)}</div>
                        <div class="stat-label">分享</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${type === 'images' ? '图集' : '视频'}</div>
                        <div class="stat-label">类型</div>
                    </div>
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

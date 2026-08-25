/**
 * Cloudflare Pages Functions - 解析接口 /api/parse
 */

const APP_USER_AGENT = "com.ss.android.ugc.aweme/230501 (Linux; U; Android 10; zh_CN; MI 9; Build/QKQ1.190825.002; Cronet/TTNetVersion:b4d74d15 2020-04-23 QuicVersion:0144d358 2020-03-24)";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost(context) {
  try {
    const { request } = context;
    const body = await request.json().catch(() => ({}));
    const inputUrl = body.url ? body.url.trim() : "";

    if (!inputUrl) {
      return jsonResponse({ success: false, error: "请输入有效的抖音分享链接或文案" }, 400);
    }

    const result = await parseDouyin(inputUrl);
    return jsonResponse(result, result.success ? 200 : 400);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || "解析过程发生内部异常" }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { ...corsHeaders, "Content-Type": "application/json;charset=utf-8" },
  });
}

/**
 * 抖音解析核心算法
 */
async function parseDouyin(text) {
  // 1. 提取 URL
  const urlMatch = text.match(/https?:\/\/[a-zA-Z0-9.\-_/%\?&=#+:~]+/);
  if (!urlMatch) {
    return { success: false, error: "未从输入内容中检测到有效的抖音链接" };
  }
  const shareUrl = urlMatch[0];

  // 2. 追踪重定向获取真实 aweme_id
  let awemeId = null;
  const directIdMatch = shareUrl.match(/\/(?:video|note)\/(\d+)/);
  if (directIdMatch) {
    awemeId = directIdMatch[1];
  } else {
    try {
      const redirectResp = await fetch(shareUrl, {
        headers: { "User-Agent": DEFAULT_USER_AGENT },
        redirect: "follow",
      });
      const finalUrl = redirectResp.url;
      const pathIdMatch = finalUrl.match(/\/(?:video|note)\/(\d+)/);
      if (pathIdMatch) {
        awemeId = pathIdMatch[1];
      } else {
        const queryIdMatch = finalUrl.match(/(?:modal_id|item_ids|aweme_id)=(\d+)/);
        if (queryIdMatch) awemeId = queryIdMatch[1];
      }
    } catch (e) {
      // 忽略跳转异常
    }
  }

  if (!awemeId) {
    return { success: false, error: "未能解析出作品 ID，请确认链接有效且未被删除" };
  }

  // 3. 优先请求移动端原生 Feed 接口
  const feedEndpoints = [
    `https://api5-normal-c-lq.amemv.com/aweme/v1/feed/?aweme_id=${awemeId}`,
    `https://api.amemv.com/aweme/v1/feed/?aweme_id=${awemeId}`,
    `https://api3-normal-c-hl.amemv.com/aweme/v1/feed/?aweme_id=${awemeId}`,
  ];

  let item = null;
  for (const ep of feedEndpoints) {
    try {
      const resp = await fetch(ep, {
        headers: { "User-Agent": APP_USER_AGENT, "Accept": "*/*" },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.aweme_list && data.aweme_list.length > 0) {
          item = data.aweme_list[0];
          break;
        }
      }
    } catch (e) {
      continue;
    }
  }

  // 4. 备用策略：从网页端 SSR 提取
  if (!item) {
    try {
      const sharePageResp = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/`, {
        headers: { "User-Agent": DEFAULT_USER_AGENT },
        redirect: "follow",
      });
      const html = await sharePageResp.text();
      const ssrMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);\s*<\/script>/);
      if (ssrMatch) {
        const rawJson = JSON.parse(ssrMatch[1].trim().replace(/;$/, ""));
        const loaderData = rawJson.loaderData || {};
        for (const k in loaderData) {
          const val = loaderData[k];
          if (val && typeof val === "object") {
            const list = val.videoInfoRes?.item_list || val.item_list;
            if (list && list.length > 0) {
              item = list[0];
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  if (!item) {
    return {
      success: false,
      error: "获取视频数据失败，可能是由于平台接口改动或访问风控",
      aweme_id: awemeId,
    };
  }

  // 5. 整理数据结构
  const title = (item.desc || `douyin_${awemeId}`).trim();
  const createTime = item.create_time || 0;
  const author = item.author || {};
  const authorAvatar =
    author.avatar_thumb?.url_list?.[0] ||
    author.avatar_medium?.url_list?.[0] ||
    author.avatar_larger?.url_list?.[0] ||
    "";

  const authorInfo = {
    nickname: author.nickname || "未知作者",
    avatar: authorAvatar,
    unique_id: author.unique_id || author.short_id || "未知ID",
    signature: author.signature || "",
  };

  const stats = item.statistics || {};
  const statistics = {
    digg_count: stats.digg_count || 0,
    comment_count: stats.comment_count || 0,
    share_count: stats.share_count || 0,
    play_count: stats.play_count || 0,
  };

  const music = item.music || {};
  const musicInfo = {
    title: music.title || "",
    author: music.author || "",
    url: music.play_url?.url_list?.[0] || "",
    cover: music.cover_large?.url_list?.[0] || "",
  };

  const videoInfo = item.video || {};
  const covers =
    videoInfo.origin_cover?.url_list ||
    videoInfo.cover?.url_list ||
    videoInfo.dynamic_cover?.url_list ||
    [];
  const coverUrl = covers[0] || "";

  // 判断图集与视频
  const images = item.images;
  if (images && Array.isArray(images) && images.length > 0) {
    const imgUrls = images.map((img) => img.url_list?.[0]).filter(Boolean);
    return {
      success: true,
      type: "images",
      id: awemeId,
      title,
      cover: coverUrl || imgUrls[0] || "",
      author: authorInfo,
      statistics,
      music: musicInfo,
      images: imgUrls,
      image_count: imgUrls.length,
      create_time: createTime,
    };
  } else {
    let playUrlList = [];
    const bitRate = videoInfo.bit_rate;
    if (bitRate && Array.isArray(bitRate) && bitRate.length > 0) {
      bitRate.sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
      playUrlList = bitRate[0]?.play_addr?.url_list || [];
    }
    if (!playUrlList.length) {
      playUrlList = videoInfo.play_addr?.url_list || [];
    }

    const rawPlayUrl = playUrlList[0] || "";
    const nowmUrl = rawPlayUrl ? rawPlayUrl.replace("playwm", "play") : "";
    const wmUrl = videoInfo.download_addr?.url_list?.[0] || rawPlayUrl;

    return {
      success: true,
      type: "video",
      id: awemeId,
      title,
      cover: coverUrl,
      duration: videoInfo.duration || 0,
      author: authorInfo,
      statistics,
      music: musicInfo,
      video: {
        no_watermark_url: nowmUrl,
        watermark_url: wmUrl,
        ratio: videoInfo.ratio || "720p",
        width: videoInfo.width || 0,
        height: videoInfo.height || 0,
      },
      create_time: createTime,
    };
  }
}

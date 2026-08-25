/**
 * Cloudflare Pages Functions - 媒体下载代理接口 /api/download
 */

const DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  let filename = url.searchParams.get("filename") || "download";

  if (!targetUrl) {
    return new Response("缺少 url 参数", { status: 400, headers: corsHeaders });
  }

  // 清理文件名非法字符
  filename = filename.replace(/[\\/:*?"<>|\r\n]/g, "_").trim();

  try {
    const mediaResp = await fetch(targetUrl, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://www.douyin.com/",
      },
    });

    if (!mediaResp.ok) {
      return new Response("媒体资源拉取失败", { status: mediaResp.status, headers: corsHeaders });
    }

    let contentType = mediaResp.headers.get("Content-Type") || "application/octet-stream";
    if (filename.endsWith(".mp4")) contentType = "video/mp4";
    else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) contentType = "image/jpeg";
    else if (filename.endsWith(".mp3")) contentType = "audio/mpeg";

    const headers = new Headers(mediaResp.headers);
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(mediaResp.body, {
      status: 200,
      headers: headers,
    });
  } catch (err) {
    return new Response(`下载代理发生异常: ${err.message}`, { status: 500, headers: corsHeaders });
  }
}

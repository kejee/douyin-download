/**
 * Cloudflare Pages Functions - 健康检查接口 /health
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "douyin-download-pages",
      runtime: "Cloudflare Pages Functions",
      version: "1.0.0",
    }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json;charset=utf-8",
      },
    }
  );
}

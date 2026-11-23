import { config } from "@/lib/config";

const ALLOWED = ["uploads.mangadex.org", "s4.anilist.co", "webtoon-phinf.pstatic.net"];

/** Proxies cover art from a small allowlist (MangaDex disallows hotlinking from other origins). */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return new Response("missing u", { status: 400 });
  const target = new URL(u);
  if (!ALLOWED.includes(target.hostname)) return new Response("host not allowed", { status: 403 });
  const res = await fetch(target, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const redirect = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL!;
  if (!clientKey || !redirect) {
    return NextResponse.json({ ok: false, error: "Missing TikTok env" }, { status: 500 });
  }
  const state = randomUUID();
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("tt_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}

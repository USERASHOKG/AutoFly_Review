import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { appUrl } from "@/lib/env";
import { encryptToken } from "@/lib/crypto";
import { BUSINESS_SCOPE, exchangeCode, fetchUserInfo } from "@/lib/google";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function back(code: string): NextResponse {
  const res = NextResponse.redirect(`${appUrl()}/dashboard?google=${code}`);
  res.cookies.set("rp_oauth_state", "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    if (url.searchParams.get("error")) return back("denied");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = /(?:^|;\s*)rp_oauth_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    if (!code || !state || !cookieState || state !== cookieState) return back("bad_state");

    const tokens = await exchangeCode(code);

    // Users can untick permissions on Google's consent screen.
    if (!(tokens.scope ?? "").split(" ").includes(BUSINESS_SCOPE)) return back("scope_missing");

    const info = await fetchUserInfo(tokens.access_token);
    const admin = createSupabaseAdmin();

    const { data: existing } = await admin
      .from("google_connections")
      .select("id, refresh_token_enc")
      .eq("user_id", user.id)
      .eq("google_sub", info.sub)
      .maybeSingle();

    // Google only returns a refresh token on consent; prompt=consent makes that the norm.
    if (!tokens.refresh_token && !existing) return back("no_refresh_token");

    const { error } = await admin.from("google_connections").upsert(
      {
        user_id: user.id,
        google_sub: info.sub,
        google_email: info.email ?? null,
        refresh_token_enc: tokens.refresh_token
          ? encryptToken(tokens.refresh_token)
          : existing!.refresh_token_enc,
        scope: tokens.scope ?? null,
        status: "active",
        last_error: null,
        is_demo: false,
      },
      { onConflict: "user_id,google_sub" }
    );
    if (error) throw new AppError("INTERNAL", "Could not save the Google connection.");

    return back("connected");
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") {
      return NextResponse.redirect(`${appUrl()}/login`);
    }
    console.error("Google callback failed:", e instanceof Error ? e.message : "unknown");
    return back("failed");
  }
}

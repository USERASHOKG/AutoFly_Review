import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { revokeToken } from "@/lib/google";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { connectionId?: string };
  if (!body.connectionId) throw new AppError("VALIDATION", "connectionId is required.");

  const admin = createSupabaseAdmin();
  const { data: conn } = await admin
    .from("google_connections")
    .select("id, refresh_token_enc, is_demo")
    .eq("id", body.connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn) throw new AppError("NOT_FOUND");

  if (!conn.is_demo) {
    try {
      await revokeToken(decryptToken(conn.refresh_token_enc));
    } catch {
      /* token may already be unusable */
    }
  }

  // Keep locations and review history; just invalidate the credentials.
  await admin
    .from("google_connections")
    .update({
      status: "revoked",
      refresh_token_enc: encryptToken("revoked"),
      last_error: "Disconnected by user.",
    })
    .eq("id", conn.id);

  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { checkReply, MAX_REPLY_LENGTH } from "@/lib/moderation";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Saves the owner's edits to a draft. Does NOT publish and clears any prior approval. */
export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { reply?: string };
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!reply) throw new AppError("VALIDATION", "The reply cannot be empty.");
  if (reply.length > MAX_REPLY_LENGTH) {
    throw new AppError("VALIDATION", `Replies are limited to ${MAX_REPLY_LENGTH} characters.`);
  }

  const flags = checkReply(reply);
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("reviews")
    .update({
      final_reply: reply,
      moderation_flags: flags,
      status: "drafted",
      drafted_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .neq("status", "replied")
    .select("id")
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not save your edits.");
  if (!data) throw new AppError("CONFLICT", "This review was not found or already has a published reply.");

  return NextResponse.json({ ok: true, flags });
});

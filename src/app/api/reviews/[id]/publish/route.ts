import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { getAccessToken, updateReply } from "@/lib/google";
import { checkReply, MAX_REPLY_LENGTH, needsExplicitConfirmation } from "@/lib/moderation";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionRow, LocationRow, ReviewRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Approve + publish. This is the ONLY code path that writes a reply to Google, and it
 * requires an authenticated human to send `approve: true` with the exact reply text.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as {
    reply?: string;
    approve?: boolean;
    confirmSensitive?: boolean;
  };

  if (body.approve !== true) throw new AppError("APPROVAL_REQUIRED");
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!reply) throw new AppError("VALIDATION", "The reply cannot be empty.");
  if (reply.length > MAX_REPLY_LENGTH) {
    throw new AppError("VALIDATION", `Replies are limited to ${MAX_REPLY_LENGTH} characters.`);
  }

  const admin = createSupabaseAdmin();
  const { data: reviewData } = await admin
    .from("reviews")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!reviewData) throw new AppError("NOT_FOUND");
  const review = reviewData as ReviewRow;
  if (review.status === "replied") {
    throw new AppError("CONFLICT", "This review already has a published reply.");
  }

  const flags = checkReply(reply);
  if (needsExplicitConfirmation(review.star_rating, flags) && body.confirmSensitive !== true) {
    throw new AppError(
      "APPROVAL_REQUIRED",
      review.star_rating <= 3
        ? "This is a low-rated review. Please confirm you have read the reply and want it to go public."
        : "This reply was flagged for review. Please confirm you want it to go public."
    );
  }

  const { data: locData } = await admin
    .from("locations")
    .select("*")
    .eq("id", review.location_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!locData) throw new AppError("NOT_FOUND");
  const location = locData as LocationRow;

  const { data: connData } = await admin
    .from("google_connections")
    .select("*")
    .eq("id", location.connection_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!connData) throw new AppError("GOOGLE_NOT_CONNECTED");
  const conn = connData as ConnectionRow;

  const now = new Date().toISOString();

  // Record the human approval first, so the audit trail exists even if Google rejects the call.
  await admin
    .from("reviews")
    .update({
      final_reply: reply,
      moderation_flags: flags,
      approved_at: now,
      approved_by: user.id,
      publish_error: null,
    })
    .eq("id", review.id)
    .eq("user_id", user.id);

  let publishedAt = now;
  if (!conn.is_demo) {
    if (conn.status !== "active") throw new AppError("GOOGLE_REVOKED");
    try {
      const token = await getAccessToken(admin, conn);
      const result = await updateReply(
        token,
        location.google_account_name,
        location.google_location_name,
        review.google_review_id,
        reply
      );
      publishedAt = result.updateTime ?? now;
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError("INTERNAL");
      await admin.from("reviews").update({ publish_error: err.message }).eq("id", review.id);
      throw err;
    }
  }

  const { error } = await admin
    .from("reviews")
    .update({ status: "replied", published_at: publishedAt, publish_error: null })
    .eq("id", review.id)
    .eq("user_id", user.id);
  if (error) {
    // The reply is live on Google; the next sync will reconcile the status.
    throw new AppError("INTERNAL", "Your reply was published, but we could not update its status. Refresh in a moment.");
  }

  return NextResponse.json({ ok: true, publishedAt, demo: conn.is_demo });
});

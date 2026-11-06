import { AppError } from "./errors";
import { freeDraftLimit } from "./env";
import { generateReplyDraft } from "./gemini";
import { checkReply } from "./moderation";
import type { AdminClient } from "./supabase/admin";
import type { ReviewRow } from "./types";

async function assertWithinPlan(admin: AdminClient, userId: string): Promise<void> {
  const { data: profile } = await admin.from("profiles").select("plan").eq("user_id", userId).maybeSingle();
  const plan = (profile?.plan as string | undefined) ?? "free";
  if (plan !== "free") return;

  const month = new Date();
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("usage_counters")
    .select("drafts_used")
    .eq("user_id", userId)
    .eq("month", first)
    .maybeSingle();
  if ((usage?.drafts_used ?? 0) >= freeDraftLimit()) throw new AppError("LIMIT_REACHED");
}

/**
 * Generates (or regenerates) an AI draft for a review. The draft is only saved;
 * publishing always requires a separate explicit approval call.
 */
export async function createDraft(
  admin: AdminClient,
  userId: string,
  reviewId: string
): Promise<{ draft: string; flags: string[] }> {
  const { data, error } = await admin
    .from("reviews")
    .select("*, locations(title)")
    .eq("id", reviewId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new AppError("NOT_FOUND");
  const review = data as ReviewRow;

  if (review.status === "replied") {
    throw new AppError("CONFLICT", "This review already has a published reply.");
  }

  await assertWithinPlan(admin, userId);

  const draft = await generateReplyDraft({
    businessName: review.locations?.title ?? "our business",
    starRating: review.star_rating,
    reviewerName: review.reviewer_name,
    comment: review.comment,
  });

  const flags = checkReply(draft);
  const { error: upErr } = await admin
    .from("reviews")
    .update({
      ai_draft: draft,
      final_reply: draft,
      moderation_flags: flags,
      status: "drafted",
      drafted_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
      publish_error: null,
    })
    .eq("id", reviewId)
    .eq("user_id", userId)
    .neq("status", "replied");
  if (upErr) throw new AppError("INTERNAL", "Could not save the draft.");

  await admin.rpc("increment_draft_usage", { p_user: userId });
  return { draft, flags };
}

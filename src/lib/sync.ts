import { AppError } from "./errors";
import { createDraft } from "./drafting";
import { getAccessToken, listReviewsPage, starToNumber, type GbpReview } from "./google";
import type { AdminClient } from "./supabase/admin";
import type { ConnectionRow, LocationRow, SyncSummary } from "./types";

const MAX_PAGES = 10; // 500 reviews per location per sync
const AUTO_DRAFT_MAX_PER_CONNECTION = 5; // keeps cron runs short and AI usage predictable

interface ExistingReview {
  id: string;
  google_review_id: string;
  status: string;
  comment: string | null;
  star_rating: number;
  google_update_time: string | null;
}

function toRow(userId: string, locationId: string, r: GbpReview) {
  const replied = Boolean(r.reviewReply?.comment);
  return {
    user_id: userId,
    location_id: locationId,
    google_review_id: r.reviewId,
    reviewer_name: r.reviewer?.isAnonymous ? "Anonymous" : (r.reviewer?.displayName ?? null),
    reviewer_photo_url: r.reviewer?.profilePhotoUrl ?? null,
    star_rating: starToNumber(r.starRating) || 3,
    comment: r.comment ?? null,
    google_create_time: r.createTime,
    google_update_time: r.updateTime,
    ...(replied
      ? {
          status: "replied" as const,
          final_reply: r.reviewReply!.comment,
          published_at: r.reviewReply!.updateTime,
          replied_on_google: true,
        }
      : { status: "new" as const }),
  };
}

/** Syncs one location. Returns ids of newly inserted unreplied reviews. */
export async function syncLocation(
  admin: AdminClient,
  loc: LocationRow,
  accessToken: string
): Promise<{ inserted: number; updated: number; newUnrepliedIds: string[] }> {
  const { data: existingRows } = await admin
    .from("reviews")
    .select("id, google_review_id, status, comment, star_rating, google_update_time")
    .eq("location_id", loc.id);
  const existing = new Map<string, ExistingReview>(
    ((existingRows ?? []) as ExistingReview[]).map((r) => [r.google_review_id, r])
  );

  let inserted = 0;
  let updated = 0;
  const newUnrepliedIds: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { reviews, nextPageToken } = await listReviewsPage(
      accessToken,
      loc.google_account_name,
      loc.google_location_name,
      pageToken
    );

    const toInsert: ReturnType<typeof toRow>[] = [];
    let unchangedOnPage = 0;

    for (const r of reviews) {
      const prev = existing.get(r.reviewId);
      if (!prev) {
        toInsert.push(toRow(loc.user_id, loc.id, r));
        continue;
      }
      const changed = prev.google_update_time !== r.updateTime;
      const answeredElsewhere = prev.status !== "replied" && Boolean(r.reviewReply?.comment);
      if (!changed && !answeredElsewhere) {
        unchangedOnPage++;
        continue;
      }
      const patch: Record<string, unknown> = {
        comment: r.comment ?? null,
        star_rating: starToNumber(r.starRating) || prev.star_rating,
        google_update_time: r.updateTime,
      };
      if (answeredElsewhere) {
        patch.status = "replied";
        patch.final_reply = r.reviewReply!.comment;
        patch.published_at = r.reviewReply!.updateTime;
        patch.replied_on_google = true;
      }
      const { error } = await admin.from("reviews").update(patch).eq("id", prev.id);
      if (!error) updated++;
    }

    if (toInsert.length > 0) {
      const { data, error } = await admin
        .from("reviews")
        .upsert(toInsert, { onConflict: "location_id,google_review_id", ignoreDuplicates: true })
        .select("id, status");
      if (error) throw new AppError("INTERNAL", "Could not save reviews.");
      for (const row of data ?? []) {
        inserted++;
        if (row.status === "new") newUnrepliedIds.push(row.id as string);
      }
    }

    // Reviews are ordered by update time (newest first): a page of only known,
    // unchanged reviews means everything older is already in sync.
    if (reviews.length > 0 && unchangedOnPage === reviews.length) break;
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  await admin
    .from("locations")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", loc.id);

  return { inserted, updated, newUnrepliedIds };
}

/**
 * Syncs every active location of a connection, then creates AI drafts for new reviews.
 * Drafts are never published automatically.
 */
export async function syncConnection(
  admin: AdminClient,
  conn: ConnectionRow,
  opts?: { onlyLocationId?: string }
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    locations: 0,
    newReviews: 0,
    updatedReviews: 0,
    draftsCreated: 0,
    errors: [],
  };
  if (conn.is_demo) return summary;
  if (conn.status !== "active") {
    summary.errors.push({ location: "-", code: "GOOGLE_REVOKED", message: new AppError("GOOGLE_REVOKED").message });
    return summary;
  }

  let q = admin
    .from("locations")
    .select("*")
    .eq("connection_id", conn.id)
    .eq("is_active", true);
  if (opts?.onlyLocationId) q = q.eq("id", opts.onlyLocationId);
  const { data: locs } = await q;
  const locations = (locs ?? []) as LocationRow[];
  if (locations.length === 0) return summary;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(admin, conn);
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError("INTERNAL");
    summary.errors.push({ location: "-", code: err.code, message: err.message });
    return summary;
  }

  const draftQueue: { userId: string; id: string }[] = [];

  for (const loc of locations) {
    try {
      const r = await syncLocation(admin, loc, accessToken);
      summary.locations++;
      summary.newReviews += r.inserted;
      summary.updatedReviews += r.updated;
      for (const id of r.newUnrepliedIds) draftQueue.push({ userId: loc.user_id, id });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError("INTERNAL");
      summary.errors.push({ location: loc.title, code: err.code, message: err.message });
      await admin.from("locations").update({ last_sync_error: err.message }).eq("id", loc.id);
      if (err.code === "GOOGLE_REVOKED") break; // no point continuing
    }
  }

  for (const item of draftQueue.slice(0, AUTO_DRAFT_MAX_PER_CONNECTION)) {
    try {
      await createDraft(admin, item.userId, item.id);
      summary.draftsCreated++;
    } catch (e) {
      // LIMIT_REACHED or AI failure: the review stays "new" and can be drafted manually.
      if (e instanceof AppError && e.code === "LIMIT_REACHED") break;
    }
  }

  return summary;
}

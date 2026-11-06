import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { syncConnection } from "@/lib/sync";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionRow, LocationRow, SyncSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SECONDS_BETWEEN_SYNCS = 45;

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { locationId?: string };
  const admin = createSupabaseAdmin();

  if (body.locationId) {
    const { data: loc } = await admin
      .from("locations")
      .select("last_synced_at")
      .eq("id", body.locationId)
      .eq("user_id", user.id)
      .maybeSingle<Pick<LocationRow, "last_synced_at">>();
    if (!loc) throw new AppError("NOT_FOUND");
    if (loc.last_synced_at && Date.now() - new Date(loc.last_synced_at).getTime() < MIN_SECONDS_BETWEEN_SYNCS * 1000) {
      throw new AppError("SYNC_TOO_SOON");
    }
  }

  const { data } = await admin
    .from("google_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_demo", false);
  const connections = (data ?? []) as ConnectionRow[];
  if (connections.length === 0) throw new AppError("GOOGLE_NOT_CONNECTED");

  const total: SyncSummary = { locations: 0, newReviews: 0, updatedReviews: 0, draftsCreated: 0, errors: [] };
  for (const conn of connections) {
    const s = await syncConnection(admin, conn, { onlyLocationId: body.locationId });
    total.locations += s.locations;
    total.newReviews += s.newReviews;
    total.updatedReviews += s.updatedReviews;
    total.draftsCreated += s.draftsCreated;
    total.errors.push(...s.errors);
  }

  // If every attempt failed because the grant is gone, surface it as a clear error.
  if (total.locations === 0 && total.errors.some((e) => e.code === "GOOGLE_REVOKED")) {
    throw new AppError("GOOGLE_REVOKED");
  }
  return NextResponse.json(total);
});

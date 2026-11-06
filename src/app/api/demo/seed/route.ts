import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { encryptToken } from "@/lib/crypto";
import { AppError, route } from "@/lib/errors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SAMPLES: { name: string; stars: number; comment: string | null }[] = [
  { name: "Priya Sharma", stars: 5, comment: "Lovely staff and spotless place. Got seen on time and everything was explained clearly." },
  { name: "Rahul Verma", stars: 2, comment: "Waited 50 minutes past my appointment and nobody told me why. Disappointing." },
  { name: "Anita Desai", stars: 4, comment: "Great service overall, parking is a bit tricky though." },
  { name: "Karthik R", stars: 1, comment: "Charged more than the quoted price. Will not return." },
  { name: "Meera Iyer", stars: 5, comment: null },
  { name: "Sandeep Nair", stars: 3, comment: "Decent experience. Good results but the front desk felt rushed." },
];

/** Creates a demo connection, location and sample reviews so the app works before GBP API approval. */
export const POST = route(async () => {
  const user = await requireUser();
  const admin = createSupabaseAdmin();

  const { data: conn, error: cErr } = await admin
    .from("google_connections")
    .upsert(
      {
        user_id: user.id,
        google_sub: "demo",
        google_email: "demo@autofly-review.local",
        refresh_token_enc: encryptToken("demo"),
        status: "active",
        is_demo: true,
      },
      { onConflict: "user_id,google_sub" }
    )
    .select("id")
    .single();
  if (cErr || !conn) throw new AppError("INTERNAL", "Could not create demo data.");

  const { data: loc, error: lErr } = await admin
    .from("locations")
    .upsert(
      {
        user_id: user.id,
        connection_id: conn.id,
        google_account_name: "accounts/demo",
        google_location_name: "locations/demo",
        title: "Demo Dental Clinic",
        address: "12 Sample Street, Bengaluru",
      },
      { onConflict: "user_id,google_account_name,google_location_name" }
    )
    .select("id")
    .single();
  if (lErr || !loc) throw new AppError("INTERNAL", "Could not create demo data.");

  const now = Date.now();
  const rows = SAMPLES.map((s, i) => {
    const t = new Date(now - i * 36 * 3600 * 1000).toISOString();
    return {
      user_id: user.id,
      location_id: loc.id,
      google_review_id: `demo-${i + 1}`,
      reviewer_name: s.name,
      star_rating: s.stars,
      comment: s.comment,
      google_create_time: t,
      google_update_time: t,
      status: "new" as const,
    };
  });
  await admin
    .from("reviews")
    .upsert(rows, { onConflict: "location_id,google_review_id", ignoreDuplicates: true });

  return NextResponse.json({ ok: true });
});

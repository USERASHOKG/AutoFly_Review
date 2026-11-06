import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { toErrorResponse } from "@/lib/errors";
import { notifyNewReviews } from "@/lib/notify";
import { syncConnection } from "@/lib/sync";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron (or any external pinger) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createSupabaseAdmin();
    const { data } = await admin
      .from("google_connections")
      .select("*")
      .eq("status", "active")
      .eq("is_demo", false);
    const connections = (data ?? []) as ConnectionRow[];

    const perUser = new Map<string, { newReviews: number; draftsCreated: number }>();
    let errors = 0;

    for (const conn of connections) {
      const s = await syncConnection(admin, conn);
      errors += s.errors.length;
      const acc = perUser.get(conn.user_id) ?? { newReviews: 0, draftsCreated: 0 };
      acc.newReviews += s.newReviews;
      acc.draftsCreated += s.draftsCreated;
      perUser.set(conn.user_id, acc);
    }

    for (const [userId, counts] of perUser) await notifyNewReviews(admin, userId, counts);

    return NextResponse.json({ ok: true, connections: connections.length, errors });
  } catch (e) {
    return toErrorResponse(e);
  }
}

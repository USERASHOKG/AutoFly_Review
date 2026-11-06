import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { getAccessToken, listAccounts, listLocations } from "@/lib/google";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async () => {
  const user = await requireUser();
  const admin = createSupabaseAdmin();

  const { data } = await admin
    .from("google_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_demo", false);
  const connections = (data ?? []) as ConnectionRow[];
  if (connections.length === 0) throw new AppError("GOOGLE_NOT_CONNECTED");

  let imported = 0;
  let accountCount = 0;
  const errors: { account: string; code: string; message: string }[] = [];
  let revoked = false;

  for (const conn of connections) {
    if (conn.status !== "active") {
      revoked = true;
      continue;
    }
    const token = await getAccessToken(admin, conn); // throws GOOGLE_REVOKED if needed
    const accounts = await listAccounts(token); // throws GBP_API_NOT_APPROVED if no API access
    accountCount += accounts.length;

    for (const account of accounts) {
      try {
        const locations = await listLocations(token, account.name);
        if (locations.length === 0) continue;
        const rows = locations.map((l) => ({
          user_id: user.id,
          connection_id: conn.id,
          google_account_name: account.name,
          google_location_name: l.name,
          title: l.title,
          address: l.address,
        }));
        const { error } = await admin
          .from("locations")
          .upsert(rows, { onConflict: "user_id,google_account_name,google_location_name" });
        if (error) throw new AppError("INTERNAL", "Could not save locations.");
        imported += rows.length;
      } catch (e) {
        const err = e instanceof AppError ? e : new AppError("INTERNAL");
        if (err.code === "GOOGLE_REVOKED") throw err;
        errors.push({
          account: account.accountName ?? account.name,
          code: err.code,
          message: err.message,
        });
      }
    }
  }

  if (revoked && imported === 0 && accountCount === 0) throw new AppError("GOOGLE_REVOKED");

  return NextResponse.json({
    accounts: accountCount,
    imported,
    errors,
    message:
      imported === 0 && errors.length === 0
        ? "No business locations were found on this Google account. Make sure it manages a verified Business Profile."
        : null,
  });
});

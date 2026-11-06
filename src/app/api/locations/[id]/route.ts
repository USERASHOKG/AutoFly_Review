import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError, route } from "@/lib/errors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { isActive?: boolean };
  if (typeof body.isActive !== "boolean") throw new AppError("VALIDATION", "isActive must be true or false.");

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("locations")
    .update({ is_active: body.isActive })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new AppError("NOT_FOUND");
  return NextResponse.json({ ok: true });
});

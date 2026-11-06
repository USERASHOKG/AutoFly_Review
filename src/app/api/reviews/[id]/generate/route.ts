import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/errors";
import { createDraft } from "@/lib/drafting";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route<{ params: { id: string } }>(async (_req, { params }) => {
  const user = await requireUser();
  const result = await createDraft(createSupabaseAdmin(), user.id, params.id);
  return NextResponse.json(result);
});

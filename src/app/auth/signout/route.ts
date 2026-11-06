import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createSupabaseServer();
  await supabase.auth.signOut();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return NextResponse.redirect(`${base}/login`, { status: 303 });
}

import { AppError } from "./errors";
import { createSupabaseServer } from "./supabase/server";

export async function requireUser() {
  const supabase = createSupabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new AppError("UNAUTHENTICATED");
  return user;
}

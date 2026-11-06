import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "../env";

/**
 * Service-role client. Bypasses RLS. SERVER ONLY.
 * Used for token storage, review writes, and cron. Always scope queries by user_id yourself.
 */
export function createSupabaseAdmin() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createSupabaseAdmin>;

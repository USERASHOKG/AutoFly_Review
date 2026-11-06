import { appUrl, optionalEnv } from "./env";
import type { AdminClient } from "./supabase/admin";

/**
 * Optional email notification via Resend. Silently does nothing if RESEND_API_KEY is unset
 * or the user turned notifications off. Never throws.
 */
export async function notifyNewReviews(
  admin: AdminClient,
  userId: string,
  counts: { newReviews: number; draftsCreated: number }
): Promise<void> {
  try {
    const apiKey = optionalEnv("RESEND_API_KEY");
    if (!apiKey || counts.newReviews === 0) return;

    const { data: profile } = await admin
      .from("profiles")
      .select("notify_email")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile && profile.notify_email === false) return;

    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (!email) return;

    const n = counts.newReviews;
    const d = counts.draftsCreated;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: optionalEnv("NOTIFY_FROM_EMAIL") ?? "AutoFly_Review <onboarding@resend.dev>",
        to: [email],
        subject: `${n} new Google review${n === 1 ? "" : "s"} waiting for your approval`,
        text:
          `You have ${n} new Google review${n === 1 ? "" : "s"}` +
          (d > 0 ? `, and ${d} AI draft${d === 1 ? "" : "s"} ready to review.` : ".") +
          `\n\nNothing is published until you approve it:\n${appUrl()}/dashboard`,
      }),
    });
  } catch {
    /* notifications are best effort */
  }
}

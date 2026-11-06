import Link from "next/link";
import { redirect } from "next/navigation";
import ConnectionPanel from "@/components/ConnectionPanel";
import ReviewCard from "@/components/ReviewCard";
import { freeDraftLimit } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ReviewRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const GOOGLE_BANNERS: Record<string, { tone: "ok" | "warn"; text: string }> = {
  connected: { tone: "ok", text: "Google connected. Next: click “Import locations”." },
  denied: { tone: "warn", text: "Google access was declined. Connect again and allow the Business Profile permission." },
  scope_missing: {
    tone: "warn",
    text: "The Business Profile permission was not granted. Please connect again and leave all boxes ticked.",
  },
  bad_state: { tone: "warn", text: "The sign-in session expired or did not match. Please try connecting again." },
  no_refresh_token: {
    tone: "warn",
    text: "Google did not return a long-lived token. Remove AutoFly_Review at myaccount.google.com/permissions, then connect again.",
  },
  failed: { tone: "warn", text: "Connecting to Google failed. Please try again." },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "drafted", label: "Drafted" },
  { key: "replied", label: "Replied" },
] as const;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: { google?: string; status?: string; location?: string };
}) {
  const supabase = createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const [connRes, locRes, revRes, profileRes, usageRes] = await Promise.all([
    supabase
      .from("google_connections")
      .select("id, google_email, status, is_demo")
      .order("created_at", { ascending: true }),
    supabase
      .from("locations")
      .select("id, connection_id, title, address, is_active, last_synced_at, last_sync_error")
      .order("title"),
    supabase
      .from("reviews")
      .select("*, locations(title)")
      .order("google_create_time", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("plan").maybeSingle(),
    supabase.from("usage_counters").select("drafts_used").eq("month", firstOfMonth).maybeSingle(),
  ]);

  const connections = (connRes.data ?? []) as {
    id: string;
    google_email: string | null;
    status: "active" | "revoked" | "error";
    is_demo: boolean;
  }[];
  const locations = locRes.data ?? [];
  const allReviews = (revRes.data ?? []) as ReviewRow[];

  const status = FILTERS.some((f) => f.key === searchParams.status) ? searchParams.status! : "all";
  const locationFilter = searchParams.location;

  const scoped = locationFilter ? allReviews.filter((r) => r.location_id === locationFilter) : allReviews;
  const counts = {
    all: scoped.length,
    new: scoped.filter((r) => r.status === "new").length,
    drafted: scoped.filter((r) => r.status === "drafted").length,
    replied: scoped.filter((r) => r.status === "replied").length,
  };
  const reviews = status === "all" ? scoped : scoped.filter((r) => r.status === status);

  const banner = searchParams.google ? GOOGLE_BANNERS[searchParams.google] : undefined;
  const plan = (profileRes.data?.plan as string | undefined) ?? "free";
  const used = (usageRes.data?.drafts_used as number | undefined) ?? 0;

  const href = (s: string, loc?: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("status", s);
    if (loc) p.set("location", loc);
    const q = p.toString();
    return q ? `/dashboard?${q}` : "/dashboard";
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <h1 className="text-xl font-bold text-indigo-700">AutoFly_Review</h1>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span className="hidden sm:inline">{user.email}</span>
          <form action="/auth/signout" method="post">
            <button className="btn-secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {banner && (
        <p
          role="status"
          className={`mb-4 rounded-lg p-3 text-sm ${banner.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
        >
          {banner.text}
        </p>
      )}

      <div className="space-y-6">
        <ConnectionPanel connections={connections} locations={locations} />

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold">Review inbox</h2>
            {plan === "free" && (
              <p className="text-xs text-slate-500">
                AI drafts this month: {used}/{freeDraftLimit()} (Free plan)
              </p>
            )}
          </div>

          {locations.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <Link href={href(status)} className={locationFilter ? "btn-secondary" : "btn-primary"}>
                All locations
              </Link>
              {locations.map((l) => (
                <Link key={l.id} href={href(status, l.id)} className={locationFilter === l.id ? "btn-primary" : "btn-secondary"}>
                  {l.title}
                </Link>
              ))}
            </div>
          )}

          <nav className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1 text-sm" aria-label="Filter reviews">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href(f.key, locationFilter)}
                className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center font-medium ${status === f.key ? "bg-white shadow-sm" : "text-slate-600"}`}
              >
                {f.label} ({counts[f.key]})
              </Link>
            ))}
          </nav>

          {reviews.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">
              {allReviews.length === 0
                ? "No reviews yet. Import your locations and sync, or load the demo data."
                : "No reviews in this view."}
            </p>
          ) : (
            <div className="space-y-4">
              {reviews.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

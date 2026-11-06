"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/clientApi";

interface Conn {
  id: string;
  google_email: string | null;
  status: "active" | "revoked" | "error";
  is_demo: boolean;
}
interface Loc {
  id: string;
  connection_id: string;
  title: string;
  address: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export default function ConnectionPanel({ connections, locations }: { connections: Conn[]; locations: Loc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; hint?: string | null; reconnect?: boolean } | null>(null);

  const real = connections.filter((c) => !c.is_demo);
  const hasActiveReal = real.some((c) => c.status === "active");
  const needsReconnect = real.length > 0 && !hasActiveReal;

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNotice(null);
    try {
      const text = await fn();
      setNotice({ kind: "ok", text });
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("Something went wrong.");
      setNotice({ kind: "error", text: err.message, hint: err.hint, reconnect: err.code === "GOOGLE_REVOKED" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const importLocations = () =>
    act("import", async () => {
      const r = await api<{ imported: number; errors: { account: string; message: string }[]; message: string | null }>(
        "/api/locations/import",
        "POST"
      );
      if (r.message) return r.message;
      const extra = r.errors.length ? ` ${r.errors.length} account(s) had problems: ${r.errors[0].message}` : "";
      return `Imported ${r.imported} location(s).${extra}`;
    });

  const syncNow = () =>
    act("sync", async () => {
      const r = await api<{ newReviews: number; draftsCreated: number; errors: { location: string; message: string }[] }>(
        "/api/sync",
        "POST",
        {}
      );
      const err = r.errors.length ? ` Problem: ${r.errors[0].message}` : "";
      return `Found ${r.newReviews} new review(s), created ${r.draftsCreated} draft(s).${err}`;
    });

  const loadDemo = () =>
    act("demo", async () => {
      await api("/api/demo/seed", "POST");
      return "Demo clinic and sample reviews added. Publishing on demo reviews never touches Google.";
    });

  const disconnect = (id: string) => {
    if (!window.confirm("Disconnect this Google account? Your reviews and drafts are kept.")) return;
    return act("disc-" + id, async () => {
      await api("/api/google/disconnect", "POST", { connectionId: id });
      return "Disconnected.";
    });
  };

  const toggle = (l: Loc) =>
    act("loc-" + l.id, async () => {
      await api(`/api/locations/${l.id}`, "PATCH", { isActive: !l.is_active });
      return l.is_active ? "Sync paused for that location." : "Sync resumed for that location.";
    });

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Google Business Profile</h2>
        <div className="flex flex-wrap gap-2">
          {hasActiveReal && (
            <>
              <button className="btn-secondary" onClick={importLocations} disabled={busy !== null}>
                {busy === "import" ? "Importing..." : "Import locations"}
              </button>
              <button className="btn-secondary" onClick={syncNow} disabled={busy !== null || locations.length === 0}>
                {busy === "sync" ? "Syncing..." : "Sync reviews"}
              </button>
            </>
          )}
          <a href="/api/google/connect" className={hasActiveReal ? "btn-secondary" : "btn-primary"}>
            {needsReconnect ? "Reconnect Google" : hasActiveReal ? "Add another account" : "Connect Google Business Profile"}
          </a>
        </div>
      </div>

      {needsReconnect && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Your Google connection was revoked or expired. Reconnect to resume syncing and publishing. Your existing
          reviews and drafts are safe.
        </p>
      )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-3 rounded-lg p-3 text-sm ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
        >
          <p>{notice.text}</p>
          {notice.hint && <p className="mt-1 text-xs opacity-80">{notice.hint}</p>}
          {notice.reconnect && (
            <a href="/api/google/connect" className="mt-2 inline-block font-medium underline">
              Reconnect Google
            </a>
          )}
        </div>
      )}

      {connections.length === 0 ? (
        <div className="mt-4 text-sm text-slate-600">
          <p>Connect your Google account to import your business locations and reviews.</p>
          <p className="mt-2">
            Waiting for Google to approve Business Profile API access?{" "}
            <button className="font-medium text-indigo-700 underline" onClick={loadDemo} disabled={busy !== null}>
              {busy === "demo" ? "Loading..." : "Try it with demo data"}
            </button>
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {connections.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{c.is_demo ? "Demo data" : (c.google_email ?? "Google account")}</span>{" "}
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs ${c.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                  >
                    {c.status === "active" ? "Connected" : "Needs reconnect"}
                  </span>
                </p>
                {!c.is_demo && c.status === "active" && (
                  <button className="btn-danger" onClick={() => disconnect(c.id)} disabled={busy !== null}>
                    Disconnect
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-2">
                {locations
                  .filter((l) => l.connection_id === c.id)
                  .map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2.5 text-sm">
                      <div>
                        <p className="font-medium">{l.title}</p>
                        <p className="text-xs text-slate-500">
                          {l.address ?? "No address"}
                          {l.last_synced_at && ` · synced ${new Date(l.last_synced_at).toLocaleString()}`}
                        </p>
                        {l.last_sync_error && <p className="mt-1 text-xs text-red-700">{l.last_sync_error}</p>}
                      </div>
                      {!c.is_demo && (
                        <button className="btn-secondary" onClick={() => toggle(l)} disabled={busy !== null}>
                          {l.is_active ? "Pause sync" : "Resume sync"}
                        </button>
                      )}
                    </li>
                  ))}
                {locations.filter((l) => l.connection_id === c.id).length === 0 && !c.is_demo && (
                  <li className="text-xs text-slate-500">No locations yet. Click “Import locations”.</li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

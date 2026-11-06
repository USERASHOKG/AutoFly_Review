"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/clientApi";
import { checkReply, FLAG_LABELS, MAX_REPLY_LENGTH, needsExplicitConfirmation, type ModerationFlag } from "@/lib/moderation";
import type { ReviewRow } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  drafted: "bg-amber-100 text-amber-800",
  replied: "bg-emerald-100 text-emerald-800",
};

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} out of 5 stars`} className="text-amber-500">
      {"★".repeat(n)}
      <span className="text-slate-300">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function ReviewCard({ review }: { review: ReviewRow }) {
  const router = useRouter();
  const [reply, setReply] = useState(review.final_reply ?? "");
  const [saved, setSaved] = useState(review.final_reply ?? "");
  const [busy, setBusy] = useState<null | "generate" | "save" | "publish">(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const replied = review.status === "replied";
  const flags = checkReply(reply).filter((f) => reply.trim() !== "" || f !== "empty") as ModerationFlag[];
  const sensitive = needsExplicitConfirmation(review.star_rating, flags);
  const dirty = reply.trim() !== saved.trim();
  const canPublish =
    !replied && reply.trim().length > 0 && reply.length <= MAX_REPLY_LENGTH && (!sensitive || confirmed) && busy === null;

  async function run<T>(kind: "generate" | "save" | "publish", fn: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("Something went wrong."));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    const r = await run("generate", () => api<{ draft: string }>(`/api/reviews/${review.id}/generate`, "POST"));
    if (r) {
      setReply(r.draft);
      setSaved(r.draft);
      setConfirmed(false);
      router.refresh();
    }
  }

  async function save() {
    const r = await run("save", () => api(`/api/reviews/${review.id}`, "PATCH", { reply }));
    if (r) {
      setSaved(reply);
      setConfirmed(false);
      router.refresh();
    }
  }

  async function publish() {
    if (!sensitive && !window.confirm("Publish this reply publicly on Google?")) return;
    const r = await run("publish", () =>
      api(`/api/reviews/${review.id}/publish`, "POST", {
        reply,
        approve: true,
        confirmSensitive: sensitive ? confirmed : undefined,
      })
    );
    if (r) router.refresh();
  }

  return (
    <article className="card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{review.reviewer_name ?? "Google user"}</p>
          <p className="text-sm text-slate-500">
            <Stars n={review.star_rating} /> · {review.locations?.title ?? "Location"} ·{" "}
            {review.google_create_time ? new Date(review.google_create_time).toLocaleDateString() : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[review.status]}`}>
          {review.status === "new" ? "New" : review.status === "drafted" ? "Drafted" : "Replied"}
        </span>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-slate-800">
        {review.comment?.trim() || <span className="italic text-slate-400">Rating only, no written comment.</span>}
      </p>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {replied ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Published reply
              {review.published_at && ` · ${new Date(review.published_at).toLocaleString()}`}
              {review.replied_on_google && " · answered on Google"}
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm text-slate-800">
              {review.final_reply}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label htmlFor={`reply-${review.id}`} className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              {review.status === "drafted" ? "Draft reply (editable)" : "Reply"}
            </label>
            <textarea
              id={`reply-${review.id}`}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                setConfirmed(false);
              }}
              rows={5}
              placeholder="Generate an AI draft, or write your own reply."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>{review.ai_draft && reply === review.ai_draft ? "AI draft, not yet published" : dirty ? "Unsaved edits" : ""}</span>
              <span className={reply.length > MAX_REPLY_LENGTH ? "text-red-600" : ""}>
                {reply.length}/{MAX_REPLY_LENGTH}
              </span>
            </div>

            {flags.length > 0 && (
              <ul className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {flags.map((f) => (
                  <li key={f}>⚠ {FLAG_LABELS[f]}</li>
                ))}
              </ul>
            )}

            {sensitive && reply.trim() && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  {review.star_rating <= 3
                    ? "This is a low-rated review. I have read this reply and approve it going public."
                    : "I have checked the flagged items above and approve this reply going public."}
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={generate} disabled={busy !== null} className="btn-secondary">
                {busy === "generate" ? "Drafting..." : review.ai_draft ? "Regenerate draft" : "Generate AI draft"}
              </button>
              <button type="button" onClick={save} disabled={busy !== null || !dirty || !reply.trim()} className="btn-secondary">
                {busy === "save" ? "Saving..." : "Save edits"}
              </button>
              <button type="button" onClick={publish} disabled={!canPublish} className="btn-primary">
                {busy === "publish" ? "Publishing..." : "Approve & publish"}
              </button>
            </div>
          </div>
        )}

        {(error || review.publish_error) && !replied && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            <p>{error?.message ?? review.publish_error}</p>
            {error?.hint && <p className="mt-1 text-xs text-red-700">{error.hint}</p>}
            {error?.code === "GOOGLE_REVOKED" && (
              <a href="/api/google/connect" className="mt-2 inline-block font-medium underline">
                Reconnect Google
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

import { AppError } from "./errors";
import { appUrl, requireEnv } from "./env";
import { decryptToken } from "./crypto";
import type { AdminClient } from "./supabase/admin";
import type { ConnectionRow } from "./types";

export const BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";

function redirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? `${appUrl()}/api/google/callback`;
}

/* ------------------------------ OAuth ------------------------------ */

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `${BUSINESS_SCOPE} openid email`,
    access_type: "offline", // needed to receive a refresh token
    prompt: "consent", // always return a refresh token, even on re-connect
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      ...body,
    }),
    cache: "no-store",
  });
  if (res.ok) return (await res.json()) as TokenResponse;

  let err = "";
  try {
    const j = (await res.json()) as { error?: string };
    err = j.error ?? "";
  } catch {
    /* ignore */
  }
  if (err === "invalid_grant") throw new AppError("GOOGLE_REVOKED");
  throw new AppError("OAUTH_FAILED", undefined, err || `HTTP ${res.status}`);
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
}

export async function fetchUserInfo(accessToken: string): Promise<{ sub: string; email?: string }> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new AppError("OAUTH_FAILED", undefined, `userinfo HTTP ${res.status}`);
  return (await res.json()) as { sub: string; email?: string };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* best effort */
  }
}

/* ------------------------- Access token cache ------------------------- */

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Returns a valid access token for a connection, refreshing automatically.
 * If Google reports the grant is revoked, the connection is flagged so the UI shows "Reconnect".
 */
export async function getAccessToken(
  admin: AdminClient,
  conn: Pick<ConnectionRow, "id" | "refresh_token_enc" | "is_demo">
): Promise<string> {
  if (conn.is_demo) throw new AppError("VALIDATION", "Demo connections do not use Google.");

  const cached = tokenCache.get(conn.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = decryptToken(conn.refresh_token_enc);
  try {
    const t = await postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
    tokenCache.set(conn.id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof AppError && e.code === "GOOGLE_REVOKED") {
      tokenCache.delete(conn.id);
      await admin
        .from("google_connections")
        .update({ status: "revoked", last_error: "Google access was revoked or expired." })
        .eq("id", conn.id);
    }
    throw e;
  }
}

/* --------------------------- Google API calls --------------------------- */

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { reason?: string; "@type"?: string }[];
  };
}

async function classifyError(res: Response, opts?: { treat429AsNoAccess?: boolean }): Promise<AppError> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    /* ignore */
  }
  const message = body.error?.message ?? "";
  const status = body.error?.status ?? "";
  const reasons = (body.error?.details ?? []).map((d) => d.reason ?? "").join(",");
  const lower = message.toLowerCase();

  if (res.status === 401) return new AppError("GOOGLE_REVOKED");

  if (res.status === 429 || status === "RESOURCE_EXHAUSTED") {
    if (opts?.treat429AsNoAccess) {
      return new AppError(
        "GBP_API_NOT_APPROVED",
        undefined,
        "A rate-limit error on the very first request usually means the GBP API quota is 0 until Google approves your project."
      );
    }
    return new AppError("GBP_RATE_LIMITED");
  }

  if (res.status === 403) {
    if (
      reasons.includes("SERVICE_DISABLED") ||
      reasons.includes("accessNotConfigured") ||
      lower.includes("has not been used") ||
      lower.includes("is disabled") ||
      lower.includes("not enabled")
    ) {
      return new AppError("GBP_API_NOT_APPROVED", undefined, message);
    }
    if (lower.includes("verif")) return new AppError("GBP_LOCATION_UNVERIFIED", undefined, message);
    return new AppError(
      "GOOGLE_API_ERROR",
      "Google denied this request. Make sure the connected Google account owns or manages this business profile.",
      message
    );
  }

  if (res.status === 404) return new AppError("GBP_NOT_FOUND", undefined, message);
  if (res.status === 400 && lower.includes("verif")) {
    return new AppError("GBP_LOCATION_UNVERIFIED", undefined, message);
  }
  return new AppError("GOOGLE_API_ERROR", undefined, message || `HTTP ${res.status}`);
}

async function gFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
  opts?: { treat429AsNoAccess?: boolean }
): Promise<T> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  };

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, cache: "no-store" });
    } catch {
      throw new AppError("GOOGLE_API_ERROR", "Could not reach Google. Please try again.");
    }
    if (res.ok) return (res.status === 204 ? {} : await res.json()) as T;

    // One gentle retry on transient server errors.
    if (res.status >= 500 && attempt === 0) {
      attempt++;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    throw await classifyError(res, opts);
  }
}

export interface GbpAccount {
  name: string; // accounts/123
  accountName?: string;
  type?: string;
}

export interface GbpLocation {
  name: string; // locations/456
  title: string;
  address: string | null;
}

export interface GbpReview {
  reviewId: string;
  name: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}

const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export function starToNumber(s: GbpReview["starRating"]): number {
  return STAR_MAP[s] ?? 0;
}

export async function listAccounts(accessToken: string): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ pageSize: "20" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gFetch<{ accounts?: GbpAccount[]; nextPageToken?: string }>(
      `${ACCOUNTS_API}/accounts?${qs}`,
      accessToken,
      undefined,
      { treat429AsNoAccess: true }
    );
    out.push(...(data.accounts ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

interface RawLocation {
  name: string;
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  };
}

export async function listLocations(accessToken: string, accountName: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({ readMask: "name,title,storefrontAddress", pageSize: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gFetch<{ locations?: RawLocation[]; nextPageToken?: string }>(
      `${INFO_API}/${accountName}/locations?${qs}`,
      accessToken
    );
    for (const l of data.locations ?? []) {
      const a = l.storefrontAddress;
      const address = a
        ? [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode]
            .filter(Boolean)
            .join(", ")
        : null;
      out.push({ name: l.name, title: l.title ?? l.name, address: address || null });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

export async function listReviewsPage(
  accessToken: string,
  accountName: string,
  locationName: string,
  pageToken?: string
): Promise<{ reviews: GbpReview[]; nextPageToken?: string }> {
  const qs = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
  if (pageToken) qs.set("pageToken", pageToken);
  const data = await gFetch<{ reviews?: GbpReview[]; nextPageToken?: string }>(
    `${REVIEWS_API}/${accountName}/${locationName}/reviews?${qs}`,
    accessToken
  );
  return { reviews: data.reviews ?? [], nextPageToken: data.nextPageToken };
}

/** Publishes (or replaces) the owner reply on a review via the updateReply endpoint. */
export async function updateReply(
  accessToken: string,
  accountName: string,
  locationName: string,
  reviewId: string,
  comment: string
): Promise<{ comment: string; updateTime: string }> {
  return gFetch<{ comment: string; updateTime: string }>(
    `${REVIEWS_API}/${accountName}/${locationName}/reviews/${encodeURIComponent(reviewId)}/reply`,
    accessToken,
    { method: "PUT", body: JSON.stringify({ comment }) }
  );
}

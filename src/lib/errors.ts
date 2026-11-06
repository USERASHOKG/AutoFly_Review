import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIG_MISSING"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OAUTH_FAILED"
  | "GOOGLE_NOT_CONNECTED"
  | "GOOGLE_REVOKED"
  | "GBP_API_NOT_APPROVED"
  | "GBP_RATE_LIMITED"
  | "GBP_LOCATION_UNVERIFIED"
  | "GBP_NOT_FOUND"
  | "GOOGLE_API_ERROR"
  | "GEMINI_ERROR"
  | "LIMIT_REACHED"
  | "APPROVAL_REQUIRED"
  | "SYNC_TOO_SOON"
  | "INTERNAL";

const DEFAULTS: Record<ErrorCode, { status: number; message: string }> = {
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  CONFIG_MISSING: { status: 500, message: "The server is missing required configuration." },
  VALIDATION: { status: 400, message: "The request was invalid." },
  NOT_FOUND: { status: 404, message: "That item was not found." },
  CONFLICT: { status: 409, message: "That action conflicts with the current state." },
  OAUTH_FAILED: { status: 400, message: "Google sign-in could not be completed. Please try again." },
  GOOGLE_NOT_CONNECTED: {
    status: 400,
    message: "Connect your Google Business Profile first.",
  },
  GOOGLE_REVOKED: {
    status: 401,
    message:
      "Your Google connection was revoked or has expired. Please reconnect Google Business Profile. Your reviews and drafts are kept.",
  },
  GBP_API_NOT_APPROVED: {
    status: 403,
    message:
      "Google Business Profile API access is not enabled for this Google Cloud project yet. Request access and enable the Business Profile APIs, then try again.",
  },
  GBP_RATE_LIMITED: {
    status: 429,
    message: "Google is rate limiting requests. Please wait a minute and try again.",
  },
  GBP_LOCATION_UNVERIFIED: {
    status: 403,
    message:
      "This location is not verified on Google, so reviews cannot be read or answered through the API. Verify the business profile first.",
  },
  GBP_NOT_FOUND: {
    status: 404,
    message: "Google could not find that account, location or review. It may have been removed.",
  },
  GOOGLE_API_ERROR: { status: 502, message: "Google returned an unexpected error." },
  GEMINI_ERROR: { status: 502, message: "The AI service could not generate a reply right now." },
  LIMIT_REACHED: {
    status: 402,
    message: "You have used all AI drafts included in your plan this month.",
  },
  APPROVAL_REQUIRED: {
    status: 400,
    message: "This reply needs your explicit approval before it can be published.",
  },
  SYNC_TOO_SOON: { status: 429, message: "This location was synced a moment ago. Please wait a minute." },
  INTERNAL: { status: 500, message: "Something went wrong. Please try again." },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly hint?: string;

  constructor(code: ErrorCode, message?: string, hint?: string, status?: number) {
    super(message ?? DEFAULTS[code].message);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? DEFAULTS[code].status;
    this.hint = hint;
  }
}

export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, hint: e.hint ?? null } },
      { status: e.status }
    );
  }
  // Never log request bodies, tokens or secrets here.
  console.error("Unhandled error:", e instanceof Error ? e.message : "unknown");
  return NextResponse.json(
    { error: { code: "INTERNAL", message: DEFAULTS.INTERNAL.message, hint: null } },
    { status: 500 }
  );
}

/** Wrap a route handler so thrown AppErrors become clean JSON responses. */
export function route<Ctx = unknown>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

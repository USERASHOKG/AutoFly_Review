import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildAuthUrl } from "@/lib/google";
import { route } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireUser();
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("rp_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
});

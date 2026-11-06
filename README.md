# AutoFly_Review

Approval-first Google review responder. Next.js (App Router) + Supabase + Gemini + Google Business Profile APIs.

**Flow:** sign in (magic link) → connect Google → import locations → sync reviews → AI draft → edit → approve → publish via `updateReply`.

**Safety rule:** nothing is ever published automatically. The only code path that writes to Google is
`POST /api/reviews/[id]/publish`, which requires a signed-in user to send `approve: true` plus the exact reply text.
Reviews rated 3 stars or below, and any reply flagged by the moderation check (links, phone numbers, refund promises, legal/medical claims),
need an extra explicit confirmation, enforced server-side.

---

## 1. Run locally

```bash
npm install
cp .env.example .env.local      # fill in the values (see section 3)
# run supabase/schema.sql in the Supabase SQL editor (section 2)
npm run dev                     # http://localhost:3000
```

Generate secrets:

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

## 2. Supabase

1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`.
3. Authentication → URL Configuration:
   - Site URL: your app URL (`http://localhost:3000` locally, your Vercel URL in production)
   - Redirect URLs: add `http://localhost:3000/auth/callback` and `https://YOUR-APP.vercel.app/auth/callback`
4. Project Settings → API: copy the URL, anon key and service role key into your env vars.
5. Supabase's built-in email sender is heavily rate limited. For real use, add custom SMTP (Authentication → SMTP Settings).

Security model: row-level security is on for every table. Users can read only their own rows, and the browser can never read
`google_connections.refresh_token_enc` (column-level grant). All token writes and review publishing go through server routes using the service role key.

## 3. Environment variables

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose it |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client (section 4) |
| `GOOGLE_REDIRECT_URI` | Must equal `https://YOUR-APP/api/google/callback` exactly |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Key from aistudio.google.com. Default model `gemini-2.0-flash`; change it if Google retires it |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64. **If you change it, every user must reconnect Google** |
| `CRON_SECRET` | Protects `/api/cron/sync` |
| `FREE_DRAFTS_PER_MONTH` | Free plan cap (default 10) |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | Optional email notifications for new reviews |

## 4. Google Cloud setup

1. Create a Google Cloud project.
2. **Request Business Profile API access** (the access request form linked from the Google Business Profile APIs documentation).
   Until Google approves your project, API quota is **0** and the first call returns a rate-limit/permission error.
   AutoFly_Review detects this and shows a clear message. Use **demo data** (button on the dashboard) while you wait.
3. APIs & Services → Library → enable all of:
   - My Business Account Management API
   - My Business Business Information API
   - Google My Business API (v4, used for reviews and replies)
4. OAuth consent screen: add scopes `openid`, `email`, and `https://www.googleapis.com/auth/business.manage`.
   While in Testing mode, add your Google account as a test user. Test-mode refresh tokens expire after 7 days.
   `business.manage` is a sensitive scope, so publish the app and complete verification before onboarding real customers.
5. Credentials → Create OAuth client ID (Web application). Add Authorized redirect URIs:
   - `http://localhost:3000/api/google/callback`
   - `https://YOUR-APP.vercel.app/api/google/callback`

## 5. Deploy to Vercel

1. Push this folder to a GitHub repo and import it at vercel.com/new (framework: Next.js, auto-detected).
2. Add every variable from section 3 under Project → Settings → Environment Variables.
   Set `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` to the production URL.
3. Deploy, then update the Supabase redirect URLs and the Google OAuth redirect URI to the final domain.
4. **Cron:** `vercel.json` ships with a **daily** schedule (`0 3 * * *`) because Vercel's Hobby plan rejects crons that run more often than once a day,
   which would fail the deployment. For 15-minute polling either:
   - on Vercel Pro, change the schedule to `*/15 * * * *`, or
   - keep Hobby and call `GET https://YOUR-APP/api/cron/sync` every 10-15 minutes from an external scheduler
     (for example cron-job.org) with the header `Authorization: Bearer <CRON_SECRET>`.
   Vercel Cron sends that header automatically when `CRON_SECRET` is set.
5. Users can always click **Sync reviews** on the dashboard.

## 6. Test the full flow

1. Sign in with a magic link.
2. Dashboard → **Try it with demo data**: generate a draft, edit, approve and publish. Demo publishes never contact Google.
3. Dashboard → **Connect Google Business Profile** → **Import locations** → **Sync reviews**.
4. Generate a draft for a real review, approve it, and confirm the reply appears on Google (it can take a few minutes).

## 7. Error handling you get

| Situation | Behaviour |
|---|---|
| GBP API access not approved / API disabled | `GBP_API_NOT_APPROVED` with setup guidance, demo mode available |
| Refresh token revoked or expired | Connection flagged `revoked`, "Reconnect Google" prompt, history preserved |
| Unverified location | `GBP_LOCATION_UNVERIFIED` message on that location only; other locations keep syncing |
| Google 429 | Friendly rate-limit message; one retry on 5xx |
| User unticked the business permission | Callback detects missing scope and explains how to retry |
| Gemini blocked/empty/quota | Clear message, review stays editable manually |
| Free plan cap reached | `LIMIT_REACHED`, manual replies still work |
| Edit after approval | Approval is cleared; you must approve the final text again |

## 8. Project layout

```
supabase/schema.sql            tables, RLS, usage counter, triggers
src/lib/crypto.ts              AES-256-GCM token encryption
src/lib/google.ts              OAuth, token refresh, accounts/locations/reviews/updateReply
src/lib/gemini.ts              reply generation (prompt-injection aware)
src/lib/moderation.ts          reply checks + sensitive confirmation rule
src/lib/sync.ts                review sync + auto drafting (never auto publishing)
src/app/api/...                connect, callback, import, sync, generate, save, publish, cron, demo
src/app/dashboard              inbox UI (mobile friendly)
```

## 9. Known limits and next steps

- Reviews are read through the v4 reviews endpoints, which Google still serves for Business Profile. If Google changes them, only `src/lib/google.ts` needs updating.
- Review text may contain Google's "(Translated by Google)" blocks; the AI replies in the review's language.
- Plan upgrades (Starter/Agency billing) are not wired up. `profiles.plan` is set manually or by a future Stripe/Razorpay webhook.
- Per-business brand voice settings, agency multi-client views and WhatsApp alerts are intentionally out of the MVP.

## License

MIT. See [LICENSE](LICENSE). Contributions are welcome: open an issue or pull request.

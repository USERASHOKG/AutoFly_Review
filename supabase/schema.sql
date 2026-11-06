-- AutoFly_Review schema. Run in Supabase SQL Editor (or `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- profiles: one row per app user (plan + limits)
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'starter', 'agency')),
  notify_email boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- google_connections: encrypted OAuth refresh token per user
-- ---------------------------------------------------------------
create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_sub text not null,                -- Google account unique id
  google_email text,
  refresh_token_enc text not null,         -- AES-256-GCM, format v1:iv:tag:ciphertext (base64)
  scope text,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  is_demo boolean not null default false,  -- sample data connection (no Google calls)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub)
);

create index if not exists google_connections_user_idx on public.google_connections (user_id);

-- ---------------------------------------------------------------
-- locations: imported Google Business Profile locations
-- ---------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.google_connections(id) on delete cascade,
  google_account_name text not null,       -- e.g. accounts/1234567890
  google_location_name text not null,      -- e.g. locations/9876543210
  title text not null,
  address text,
  is_active boolean not null default true, -- owner can pause sync per location
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  unique (user_id, google_account_name, google_location_name)
);

create index if not exists locations_user_idx on public.locations (user_id);
create index if not exists locations_connection_idx on public.locations (connection_id);

-- ---------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  google_review_id text not null,
  reviewer_name text,
  reviewer_photo_url text,
  star_rating smallint not null check (star_rating between 1 and 5),
  comment text,
  google_create_time timestamptz,
  google_update_time timestamptz,
  status text not null default 'new' check (status in ('new', 'drafted', 'replied')),
  ai_draft text,
  final_reply text,
  moderation_flags text[] not null default '{}',
  drafted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  published_at timestamptz,
  publish_error text,
  replied_on_google boolean not null default false, -- reply already existed when we synced
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, google_review_id),
  -- Hard guarantee: nothing can be marked replied without a human approval record.
  constraint replied_requires_approval check (
    status <> 'replied' or replied_on_google = true or (approved_at is not null and approved_by is not null and final_reply is not null and published_at is not null)
  )
);

create index if not exists reviews_user_status_idx on public.reviews (user_id, status, google_create_time desc);
create index if not exists reviews_location_idx on public.reviews (location_id);

-- ---------------------------------------------------------------
-- usage_counters: monthly AI draft usage (for plan limits)
-- ---------------------------------------------------------------
create table if not exists public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,                     -- first day of the month
  drafts_used int not null default 0,
  primary key (user_id, month)
);

create or replace function public.increment_draft_usage(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', now())::date;
  used int;
begin
  insert into public.usage_counters (user_id, month, drafts_used)
  values (p_user, m, 1)
  on conflict (user_id, month) do update set drafts_used = public.usage_counters.drafts_used + 1
  returning drafts_used into used;
  return used;
end;
$$;

-- Only the service role may call this.
revoke all on function public.increment_draft_usage(uuid) from public, anon, authenticated;

-- updated_at triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists google_connections_touch on public.google_connections;
create trigger google_connections_touch before update on public.google_connections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.google_connections enable row level security;
alter table public.locations enable row level security;
alter table public.reviews enable row level security;
alter table public.usage_counters enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and plan = (select p.plan from public.profiles p where p.user_id = auth.uid()));

-- google_connections: read own rows only, and NEVER the token column.
drop policy if exists "connections_select_own" on public.google_connections;
create policy "connections_select_own" on public.google_connections for select using (auth.uid() = user_id);
revoke all on public.google_connections from anon, authenticated;
grant select (id, user_id, google_sub, google_email, scope, status, last_error, is_demo, created_at, updated_at)
  on public.google_connections to authenticated;
-- Inserts/updates/deletes happen only through the service role (server routes).

-- locations
drop policy if exists "locations_select_own" on public.locations;
create policy "locations_select_own" on public.locations for select using (auth.uid() = user_id);
drop policy if exists "locations_update_own" on public.locations;
create policy "locations_update_own" on public.locations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reviews: owners can read, and edit the draft text only via server routes.
drop policy if exists "reviews_select_own" on public.reviews;
create policy "reviews_select_own" on public.reviews for select using (auth.uid() = user_id);

-- usage_counters
drop policy if exists "usage_select_own" on public.usage_counters;
create policy "usage_select_own" on public.usage_counters for select using (auth.uid() = user_id);

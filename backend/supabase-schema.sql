-- Hooporia backend schema
-- Run this in the Supabase SQL Editor for your NEW, separate Hooporia project
-- (not the same project used for Ritnome's school licensing).

-- One row per Hooporia customer — either an individual player/parent, or a coach.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  account_type text not null check (account_type in ('individual','coach')),
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

-- Tracks the actual billing state, kept in sync with Stripe via webhooks.
-- Never trust client-side "am I subscribed" claims — always check this table.
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('individual','team')),
  status text not null, -- active | past_due | canceled | incomplete | trialing
  roster_size integer default 1, -- relevant for team plans: number of paid seats
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Named players on a coach's roster. Purely organizational for now —
-- player stats themselves stay in local browser storage, not synced here yet.
create table if not exists roster_players (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  player_name text not null,
  created_at timestamptz default now()
);

-- Helpful index for the webhook handler's most common lookup.
create index if not exists idx_subscriptions_stripe_id on subscriptions(stripe_subscription_id);
create index if not exists idx_accounts_stripe_customer on accounts(stripe_customer_id);

-- Row Level Security: locked down by default. The backend server uses the
-- service_role key (bypasses RLS) for all writes — these tables are never
-- written to directly from the browser.
alter table accounts enable row level security;
alter table subscriptions enable row level security;
alter table roster_players enable row level security;

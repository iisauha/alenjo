-- Plaid OAuth: the Link token you started with, so Link can be reopened with it when a
-- bank's own sign-in page sends you back (possibly in a different browser session).
-- Server-only: no client access.
create table if not exists public.plaid_link_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  link_token text not null,
  kind text not null check (kind in ('new', 'reconnect', 'add_accounts', 'consent')),
  item_id uuid references public.plaid_items(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.plaid_link_sessions enable row level security;
revoke all on public.plaid_link_sessions from anon, authenticated;

-- Hygiene: the app never needs TRUNCATE, TRIGGER or REFERENCES on public tables
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- Limits guessing the beta sign-up code (validate-beta-code records every attempt first)
create table if not exists public.beta_code_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  ok boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists beta_code_attempts_ip_at on public.beta_code_attempts (ip_hash, at desc);
create index if not exists beta_code_attempts_at on public.beta_code_attempts (at desc);
alter table public.beta_code_attempts enable row level security;
revoke all on public.beta_code_attempts from anon, authenticated;

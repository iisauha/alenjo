-- Privacy / Security / FAQ pages live in the database, readable only by signed-in accounts
-- (they were removed from the public site). Content is gzip + base64, unzipped by the app.
create table if not exists public.info_pages (
  slug text primary key check (slug in ('privacy', 'security', 'faq')),
  gz_b64 text not null,
  updated_at timestamptz not null default now()
);
alter table public.info_pages enable row level security;
revoke all on public.info_pages from anon, authenticated;
grant select on public.info_pages to authenticated;
drop policy if exists "Signed-in users can read info pages" on public.info_pages;
create policy "Signed-in users can read info pages" on public.info_pages
  for select to authenticated using (true);

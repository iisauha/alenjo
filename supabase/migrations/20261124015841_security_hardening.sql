-- Security audit, Nov 23 2026
-- 1. Signed-out visitors (anon) had table permissions on most tables; only row rules kept them
--    out. Nothing in the app reads tables before sign-in, so remove them, now and for new tables.
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
-- 2. Same two-step rule as every other table (no data with a password-only session once a code is set up)
drop policy if exists mfa_required on public.image_cache;
create policy mfa_required on public.image_cache as restrictive for all using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
drop policy if exists mfa_required on public.merchant_logos;
create policy mfa_required on public.merchant_logos as restrictive for all using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Bank alerts Plaid sends by webhook (not errors from /item/get, which sync overwrites):
-- PENDING_DISCONNECT, PENDING_EXPIRATION, USER_PERMISSION_REVOKED, USER_ACCOUNT_REVOKED,
-- NEW_ACCOUNTS_AVAILABLE. Cleared by LOGIN_REPAIRED or after you finish update mode.
alter table public.plaid_items add column if not exists notice_code text;
alter table public.plaid_items add column if not exists notice_at timestamptz;
grant select (notice_code, notice_at) on public.plaid_items to authenticated;

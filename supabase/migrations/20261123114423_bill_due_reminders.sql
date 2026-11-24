-- Payment due reminders for credit cards and loans (push function, action 'bills').
-- Additive only: one setting, one column, one server-only table, one RPC, one cron job.

-- Settings switch (on by default, like purchases and deposits)
alter table public.notification_settings add column if not exists bills boolean not null default true;

-- When the card's last statement was issued, so payments after it count toward this bill
alter table public.liabilities add column if not exists last_statement_issue_date date;

-- Each reminder goes out once per bill: 'soon' (1-2 days before) and 'due' (the day)
create table if not exists public.bill_reminders_sent (
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  due_date date not null,
  kind text not null check (kind in ('soon', 'due')),
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (liability_id, due_date, kind)
);
alter table public.bill_reminders_sent enable row level security;
revoke all on public.bill_reminders_sent from anon, authenticated;
create index if not exists bill_reminders_sent_user_id_idx on public.bill_reminders_sent (user_id);

-- Cards and loans with a due date in a window, with the account's name (server only)
create or replace function public.get_bill_reminder_rows(p_from date, p_to date)
returns table(
  liability_id uuid, user_id uuid, account_id uuid, plaid_account_id text, label text,
  is_hidden boolean, closed_at timestamptz, liability_type text, next_payment_due_date date,
  minimum_payment_amount numeric, last_statement_balance numeric, last_statement_issue_date date,
  next_monthly_payment numeric, last_payment_date date, last_payment_amount numeric, loan_status text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_key text;
begin
  select public.private_get_encryption_key() into v_key;
  return query
  select l.id, l.user_id, a.id,
         case when a.plaid_account_id_enc is null then null else extensions.pgp_sym_decrypt(a.plaid_account_id_enc, v_key) end,
         coalesce(nullif(a.nickname, ''), extensions.pgp_sym_decrypt(a.name_enc, v_key)),
         coalesce(a.is_hidden, false), a.closed_at, l.liability_type, l.next_payment_due_date,
         l.minimum_payment_amount, l.last_statement_balance, l.last_statement_issue_date,
         l.next_monthly_payment, l.last_payment_date, l.last_payment_amount, l.loan_status
  from public.liabilities l
  join public.accounts a on a.id = l.account_id
  where l.next_payment_due_date between p_from and p_to;
end $function$;
revoke all on function public.get_bill_reminder_rows(date, date) from public, anon, authenticated;
grant execute on function public.get_bill_reminder_rows(date, date) to service_role;

-- Hourly; the function only sends at 9 AM (or later) in each person's time zone
select cron.unschedule('bill-reminders') where exists (select 1 from cron.job where jobname = 'bill-reminders');
select cron.schedule('bill-reminders', '0 * * * *', $cron$
  select net.http_post(
    'https://itkufrockebnlzcroigc.supabase.co/functions/v1/push',
    '{"action":"bills"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret'))
  ) where exists (select 1 from public.liabilities l where l.next_payment_due_date between current_date - 1 and current_date + 3);
$cron$);

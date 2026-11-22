-- Two-step sign-in (TOTP), enforced on the server: once you turn it on, your data can only
-- be read or changed with a session that passed the code step (aal2). Without it turned on,
-- nothing changes.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

create or replace function public.require_mfa()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'two-step sign-in required' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_mfa() from public, anon;
grant execute on function public.require_mfa() to authenticated, service_role;

-- Every table that holds your data
do $$
declare t text;
begin
  foreach t in array array['accounts','card_designs','category_budgets','custom_logos','investment_holdings',
    'investment_securities','liabilities','notification_settings','plaid_items','profiles','push_devices',
    'synced_transactions','transaction_actions','user_category_map'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))', t);
  end loop;
end $$;

-- The functions the app calls that read your data directly
create or replace function public.get_first_connection_date()
returns timestamp with time zone
language sql
security definer
set search_path to 'public', 'extensions'
as $$
  select min(created_at) from plaid_items where user_id = auth.uid() and public.mfa_satisfied();
$$;

do $$
declare f text; d text;
begin
  foreach f in array array['get_user_accounts','get_user_holdings','get_user_liabilities','register_push_device'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname = f;
    if position('require_mfa' in d) = 0 then
      d := regexp_replace(d, '\mbegin\M', E'BEGIN\n  PERFORM public.require_mfa();', 'i');
      execute d;
    end if;
  end loop;
end $$;

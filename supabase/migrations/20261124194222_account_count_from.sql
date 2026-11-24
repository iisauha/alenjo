-- Count from: an account added after your first connection counts toward totals only from the
-- day Alenjo first saw it. Its older history still comes in (shown as "Before tracking"), so a
-- new card, a new bank or a partner's accounts never change months you've already budgeted.
-- Null = count everything (your first connection, and every account that existed before this).

alter table public.accounts add column if not exists count_from date;

create or replace function public.set_account_count_from()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_manual or new.count_from is not null or new.plaid_item_id is null then
    return new;
  end if;
  -- First connection ever (and its accounts) counts everything. Anything later starts today.
  if exists (select 1 from plaid_items where user_id = new.user_id and id <> new.plaid_item_id)
     or exists (select 1 from plaid_items where id = new.plaid_item_id and created_at < now() - interval '1 hour') then
    new.count_from := (now() at time zone 'America/New_York')::date;
  end if;
  return new;
end;
$$;

revoke all on function public.set_account_count_from() from public, anon, authenticated;

drop trigger if exists accounts_set_count_from on public.accounts;
create trigger accounts_set_count_from before insert on public.accounts
  for each row execute function public.set_account_count_from();

grant update (count_from) on public.accounts to authenticated;

create or replace function public.get_user_accounts()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
  v_result jsonb;
begin
  perform public.require_mfa();
  select public.private_get_encryption_key() into v_key;

  select jsonb_agg(row_to_json(t))
  into v_result
  from (
    select
      a.id,
      a.plaid_item_id,
      a.type,
      a.subtype,
      a.is_hidden,
      a.is_manual,
      a.iso_currency_code,
      a.created_at,
      a.balance_last_updated_at,
      a.nickname,
      a.card_design_id,
      a.bonus_target_amount,
      a.bonus_start_date,
      a.bonus_months,
      a.apy,
      a.sort_order,
      a.exclude_from_totals,
      a.closed_at,
      a.count_from,
      pi.plaid_last_checked_at,
      pi.institution_id,
      case when a.name_enc is not null then extensions.pgp_sym_decrypt(a.name_enc, v_key) end as name,
      case when a.mask_enc is not null then extensions.pgp_sym_decrypt(a.mask_enc, v_key) end as mask,
      case when a.plaid_account_id_enc is not null then extensions.pgp_sym_decrypt(a.plaid_account_id_enc, v_key) end as plaid_account_id,
      case when a.balance_current_enc is not null then extensions.pgp_sym_decrypt(a.balance_current_enc, v_key) end as balance_current,
      case when a.balance_available_enc is not null then extensions.pgp_sym_decrypt(a.balance_available_enc, v_key) end as balance_available,
      case when a.balance_limit_enc is not null then extensions.pgp_sym_decrypt(a.balance_limit_enc, v_key) end as balance_limit,
      case when a.official_name_enc is not null then extensions.pgp_sym_decrypt(a.official_name_enc, v_key) end as official_name,
      case when pi.institution_name_enc is not null then extensions.pgp_sym_decrypt(pi.institution_name_enc, v_key) end as institution,
      case when pi.item_id_enc is not null then extensions.pgp_sym_decrypt(pi.item_id_enc, v_key) end as plaid_item_id_raw,
      pi.institution_url,
      pi.institution_logo_domain,
      (
        select jsonb_agg(extensions.pgp_sym_decrypt(pi2.item_id_enc, v_key))
        from public.plaid_items pi2
        where pi2.institution_id = pi.institution_id
          and pi2.user_id = auth.uid()
          and pi2.item_id_enc is not null
      ) as all_item_ids
    from public.accounts a
    left join public.plaid_items pi on a.plaid_item_id = pi.id
    where a.user_id = auth.uid()
    order by a.sort_order asc nulls last, a.created_at asc
  ) t;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

-- Reconnecting a bank keeps each account's original count_from
create or replace function public.merge_reconnected_history(p_user_id uuid, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_key text;
  v_inst text;
  pair record;
  tx record;
  m text;
  v_used text[];
  v_accounts int := 0;
  v_matched int := 0;
  v_kept int := 0;
begin
  select institution_id into v_inst
  from plaid_items where id = p_item_id and user_id = p_user_id and status = 'active';
  if v_inst is null then
    return jsonb_build_object('accounts', 0);
  end if;
  select public.private_get_encryption_key() into v_key;

  for pair in
    with old_accts as (
      select oa.*, pgp_sym_decrypt(oa.plaid_account_id_enc, v_key) as pid,
             pgp_sym_decrypt(oa.mask_enc, v_key) as mask,
             pgp_sym_decrypt(oa.name_enc, v_key) as nm
      from accounts oa
      join plaid_items oi on oi.id = oa.plaid_item_id
      where oa.user_id = p_user_id and oa.closed_at is not null
        and oi.user_id = p_user_id and oi.status = 'removed' and oi.institution_id = v_inst
    ), new_accts as (
      select na.id, na.type, na.subtype,
             pgp_sym_decrypt(na.plaid_account_id_enc, v_key) as pid,
             pgp_sym_decrypt(na.mask_enc, v_key) as mask,
             pgp_sym_decrypt(na.name_enc, v_key) as nm
      from accounts na
      where na.user_id = p_user_id and na.plaid_item_id = p_item_id and na.closed_at is null
    ), candidates as (
      select oc.id as old_id, nc.id as new_id, oc.plaid_item_id as old_item, oc.pid as old_pid, nc.pid as new_pid,
             oc.nickname, oc.card_design_id, oc.apy, oc.bonus_target_amount, oc.bonus_start_date, oc.bonus_months,
             oc.sort_order, oc.is_hidden, oc.exclude_from_totals, oc.count_from,
             count(*) over (partition by oc.id) as n_for_old,
             count(*) over (partition by nc.id) as n_for_new
      from old_accts oc
      join new_accts nc on nc.type = oc.type and coalesce(nc.subtype, '') = coalesce(oc.subtype, '')
        and (case when oc.mask is not null and nc.mask is not null then oc.mask = nc.mask else oc.nm = nc.nm end)
    )
    -- Only merge when the pairing is unambiguous (one old account to one new account)
    select * from candidates where n_for_old = 1 and n_for_new = 1
  loop
    v_used := '{}';
    for tx in
      select * from synced_transactions
      where user_id = p_user_id and plaid_account_id = pair.old_pid
      order by date, id
    loop
      if tx.pending then
        -- An old pending charge: if the new connection has it (still pending or posted), your edits
        -- move to that copy; then the old one goes. Unmatched, it was stale (posted or dropped).
        m := null;
        select t.id into m
        from synced_transactions t
        where t.user_id = p_user_id and t.plaid_account_id = pair.new_pid
          and t.amount = tx.amount and t.id <> all (v_used) and t.id not like 'manual\_%'
          and abs(coalesce(t.authorized_date, t.date) - coalesce(tx.authorized_date, tx.date)) <= 3
        order by (t.name = tx.name) desc,
                 abs(coalesce(t.authorized_date, t.date) - coalesce(tx.authorized_date, tx.date)), t.id
        limit 1;
        if m is not null then
          v_used := array_append(v_used, m);
          if not exists (select 1 from transaction_actions where user_id = p_user_id and transaction_id = m) then
            update transaction_actions set transaction_id = m where user_id = p_user_id and transaction_id = tx.id;
          end if;
        end if;
        delete from transaction_actions where user_id = p_user_id and transaction_id = tx.id;
        delete from synced_transactions where id = tx.id;
        continue;
      end if;

      m := null;
      if tx.id not like 'manual\_%' then
        select t.id into m
        from synced_transactions t
        where t.user_id = p_user_id and t.plaid_account_id = pair.new_pid
          and t.amount = tx.amount and t.id <> all (v_used) and t.id not like 'manual\_%'
          and abs(coalesce(t.authorized_date, t.date) - coalesce(tx.authorized_date, tx.date)) <= 3
        order by abs(coalesce(t.authorized_date, t.date) - coalesce(tx.authorized_date, tx.date)),
                 (t.name = tx.name) desc, t.id
        limit 1;
      end if;

      if m is not null then
        v_used := array_append(v_used, m);
        if exists (select 1 from transaction_actions where user_id = p_user_id and transaction_id = m) then
          -- Both copies have edits: keep the new copy's, fill anything it's missing from the old one
          update transaction_actions n set
            action_type = coalesce(n.action_type, o.action_type),
            split_ways = coalesce(n.split_ways, o.split_ways),
            split_portion = coalesce(n.split_portion, o.split_portion),
            category_override = coalesce(n.category_override, o.category_override),
            nickname = coalesce(n.nickname, o.nickname),
            date_override = coalesce(n.date_override, o.date_override),
            note = coalesce(n.note, o.note),
            amount_override = coalesce(n.amount_override, o.amount_override),
            logo_override = coalesce(n.logo_override, o.logo_override),
            updated_at = now()
          from transaction_actions o
          where n.user_id = p_user_id and n.transaction_id = m
            and o.user_id = p_user_id and o.transaction_id = tx.id;
          delete from transaction_actions where user_id = p_user_id and transaction_id = tx.id;
        else
          update transaction_actions set transaction_id = m where user_id = p_user_id and transaction_id = tx.id;
        end if;
        delete from synced_transactions where id = tx.id;
        v_matched := v_matched + 1;
      else
        update synced_transactions
        set plaid_item_id = p_item_id, plaid_account_id = pair.new_pid, account_id = null
        where id = tx.id;
        v_kept := v_kept + 1;
      end if;
    end loop;

    update accounts na set
      nickname = coalesce(na.nickname, pair.nickname),
      card_design_id = coalesce(na.card_design_id, pair.card_design_id),
      apy = coalesce(na.apy, pair.apy),
      bonus_target_amount = coalesce(na.bonus_target_amount, pair.bonus_target_amount),
      bonus_start_date = coalesce(na.bonus_start_date, pair.bonus_start_date),
      bonus_months = coalesce(na.bonus_months, pair.bonus_months),
      sort_order = coalesce(na.sort_order, pair.sort_order),
      is_hidden = coalesce(pair.is_hidden, na.is_hidden),
      exclude_from_totals = coalesce(pair.exclude_from_totals, na.exclude_from_totals),
      count_from = pair.count_from,   -- reconnecting keeps the account's original start
      updated_at = now()
    where na.id = pair.new_id and na.user_id = p_user_id;

    delete from accounts where id = pair.old_id and user_id = p_user_id;
    v_accounts := v_accounts + 1;

    -- The old connection is done once none of its accounts are left
    if not exists (select 1 from accounts where plaid_item_id = pair.old_item) then
      delete from plaid_items where id = pair.old_item and user_id = p_user_id and status = 'removed';
    end if;
  end loop;

  return jsonb_build_object('accounts', v_accounts, 'duplicates_dropped', v_matched, 'kept_from_old', v_kept);
end;
$$;

revoke all on function public.merge_reconnected_history(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_reconnected_history(uuid, uuid) to service_role;

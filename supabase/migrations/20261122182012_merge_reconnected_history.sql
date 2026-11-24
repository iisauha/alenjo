-- When you re-add a bank whose history you kept, fold that history into the new connection.
-- Runs once the new connection's full history has arrived from Plaid:
--   * old transactions the new import also has (same account, same amount, date within 3 days)
--     are dropped as duplicates, and your notes, splits and edits move to the new copy
--   * old transactions the new import is missing are kept and moved into the new account
--   * account settings (nickname, card design, APY, bonus, order, hidden) carry over
--   * the closed account, and the old connection once empty, are removed
-- Server only: called by sync-transactions with the service role.
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
             oc.sort_order, oc.is_hidden, oc.exclude_from_totals,
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
        -- A pending charge from the old connection is stale: it either posted (and came in fresh) or dropped
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

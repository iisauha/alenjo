import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest, webhookUrl } from "./plaid.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Plaid's Transactions product already includes the store logo, website,
// location and detailed category (no separate Enrich product needed).
function buildTxRow(tx: any, userId: string, itemId: string) {
  const cat = tx.personal_finance_category;
  const merchant = Array.isArray(tx.counterparties)
    ? tx.counterparties.find((c: any) => c && c.type === 'merchant')
    : null;
  const httpsOnly = (u: any) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
  return {
    id: tx.transaction_id,
    user_id: userId,
    plaid_item_id: itemId,
    plaid_account_id: tx.account_id,
    amount: tx.amount,
    date: tx.date,
    authorized_date: tx.authorized_date || null,
    authorized_datetime: tx.authorized_datetime || tx.datetime || null,
    name: tx.name,
    merchant_name: tx.merchant_name,
    category: cat?.primary || null,
    subcategory: cat?.detailed || null,
    pending: tx.pending || false,
    type: tx.amount < 0 ? 'income' : 'expense',
    enriched_logo_url: httpsOnly(tx.logo_url) || httpsOnly(merchant?.logo_url) || null,
    enriched_website: tx.website || merchant?.website || null,
    enriched_category_detailed: cat?.detailed || null,
    enriched_payment_channel: tx.payment_channel || null,
    enriched_location_city: tx.location?.city || null,
    enriched_location_region: tx.location?.region || null,
    // Sent again by Plaid: no longer set aside as removed
    removed_at: null,
  };
}

// When a pending tx posts, Plaid issues a new transaction_id and references
// the old pending id via pending_transaction_id. Move user actions
// (ignored/reimbursed/split/recategorized/etc.) from old id to new id so
// categorizations survive the pending -> posted transition.
async function migratePendingAction(
  adminClient: any,
  userId: string,
  oldId: string,
  newId: string,
) {
  if (!oldId || oldId === newId) return;
  // Don't clobber an existing row on the new id (shouldn't happen, but safe).
  const { data: existingNew } = await adminClient
    .from('transaction_actions')
    .select('id')
    .eq('user_id', userId)
    .eq('transaction_id', newId)
    .maybeSingle();
  if (existingNew) return;
  await adminClient
    .from('transaction_actions')
    .update({ transaction_id: newId })
    .eq('user_id', userId)
    .eq('transaction_id', oldId);
}

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// Money moving between your own accounts or paying a card isn't a purchase or a deposit.
// Money someone else sends you is a deposit, even though Plaid files it under
// TRANSFER_IN: Venmo, Zelle, Cash App (TRANSFER_IN_FROM_APPS), payouts
// (TRANSFER_IN_OTHER_TRANSFER_IN) and cash or check deposits (TRANSFER_IN_DEPOSIT).
const OWN_MONEY_IN = new Set([
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_IN_SAVINGS',
  'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_IN_CASH_ADVANCES_AND_LOANS',
]);
function notifiable(tx: any, accountType: string | undefined) {
  const cat = tx.personal_finance_category || {};
  if (cat.primary === 'TRANSFER_OUT' || cat.primary === 'LOAN_PAYMENTS') return false;
  if (cat.primary !== 'TRANSFER_IN') return true;
  // On a card or loan, money in under "transfer" is a payment toward it
  if (accountType === 'credit' || accountType === 'loan') return false;
  return typeof cat.detailed === 'string' && !OWN_MONEY_IN.has(cat.detailed);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const reqBody = await req.json().catch(() => ({}));

    // Two callers: you (signed in, all your banks) or Alenjo's own plaid-webhook
    // (server key, one bank, wants the newly added transactions back).
    let user: { id: string } | null = null;
    let onlyItemId: string | null = null;
    // SA-013: the server key must exist and match exactly (constant-time compare)
    const internal = reqBody.internal === true && typeof serviceKey === 'string' && serviceKey.length > 20 && sameSecret(authHeader, 'Bearer ' + serviceKey);
    if (internal) {
      if (!reqBody.user_id || !reqBody.item_id) return jsonResponse({ error: 'Missing user_id or item_id' }, 400);
      user = { id: reqBody.user_id };
      onlyItemId = reqBody.item_id;
    } else {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user: u }, error: authError } = await userClient.auth.getUser();
      if (authError || !u) return jsonResponse({ error: 'Unauthorized' }, 401);
      // Two-step sign-in, when it's on, must be completed first (server-side check)
      const { data: mfaOk } = await userClient.rpc('mfa_satisfied');
      if (mfaOk !== true) return jsonResponse({ error: 'Two-step sign-in required' }, 403);
      user = u;
    }

    const { data: allItems, error: itemsError } = await adminClient.rpc('get_user_plaid_items', {
      p_user_id: user.id,
    });
    const items = (allItems || []).filter((i: any) => !onlyItemId || i.id === onlyItemId);

    if (itemsError || items.length === 0) {
      return jsonResponse({ error: 'No connected accounts' }, 400);
    }

    const { data: itemRows } = await adminClient
      .from('plaid_items')
      .select('id, tx_sync_cursor, created_at')
      .eq('user_id', user.id);

    const cursorMap: Record<string, string> = {};
    // Only keep history from the month before your first connection (two months back)
    let firstConn: Date | null = null;
    if (itemRows) {
      for (const row of itemRows) {
        if (row.tx_sync_cursor) cursorMap[row.id] = row.tx_sync_cursor;
        if (row.created_at) {
          const c = new Date(row.created_at);
          if (!firstConn || c < firstConn) firstConn = c;
        }
      }
    }
    const fc = firstConn || new Date();
    const historyStart = new Date(Date.UTC(fc.getUTCFullYear(), fc.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);

    const { data: allAccts } = await adminClient.rpc('get_all_decrypted_account_ids', {
      p_user_id: user.id,
    });
    const plaidToAccount: Record<string, { id: string, type: string }> = {};
    if (allAccts) {
      for (const acct of allAccts) {
        plaidToAccount[acct.plaid_account_id] = { id: acct.id, type: acct.account_type };
      }
    }

    // Build set of investment plaid_account_ids to filter them out of transaction sync
    const investAccountPlaidIds = new Set<string>();
    if (allAccts) {
      for (const acct of allAccts) {
        if (acct.account_type === 'investment') investAccountPlaidIds.add(acct.plaid_account_id);
      }
    }

    const investmentItemIds = new Set<string>();
    const { data: investAccountRows } = await adminClient
      .from('accounts')
      .select('plaid_item_id')
      .eq('user_id', user.id)
      .eq('type', 'investment')
      .eq('is_hidden', false);
    if (investAccountRows) {
      for (const row of investAccountRows) {
        if (row.plaid_item_id) investmentItemIds.add(row.plaid_item_id);
      }
    }

    // Connections with a credit card or a loan get their liabilities details
    // (due dates, rates, payoff) from the Liabilities product.
    const creditItemIds = new Set<string>();
    const { data: creditAccountRows } = await adminClient
      .from('accounts')
      .select('plaid_item_id')
      .eq('user_id', user.id)
      .in('type', ['credit', 'loan'])
      .eq('is_hidden', false);
    if (creditAccountRows) {
      for (const row of creditAccountRows) {
        if (row.plaid_item_id) creditItemIds.add(row.plaid_item_id);
      }
    }

    // Notifications: only transactions dated in the last few days count as "new"
    const recentCutoff = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    let accountLabels: Record<string, string> | null = null;
    const newTransactions: any[] = [];
    const seenIds: string[] = [];
    const myWebhook = webhookUrl();

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    let holdingsSynced = 0;
    let liabilitiesSynced = 0;
    const needsAttention: string[] = [];

    for (const item of items) {
      let cursor = cursorMap[item.id] || '';
      // A bank's first sync brings in its whole history: never notify for that
      const firstSync = !cursor;
      let hasMore = true;
      let savedCursor = cursor;
      // A connection that needs the user (password changed, bank wants a new
      // sign-in, permission expired) is recorded so the app can offer Reconnect.
      let itemError: string | null = null;
      // Plaid says when a bank's full history has arrived (needed before merging kept history)
      let updateStatus = '';

      // Plaid: fetch every page of an update before saving any of it. If the bank changes
      // something mid-way, start the whole update over from the first cursor.
      let added: any[] = [], modified: any[] = [], removed: any[] = [];
      while (hasMore) {
        const data = await plaidRequest('/transactions/sync', {
          access_token: item.access_token,
          cursor: cursor,
          count: 500,
        });

        if (data.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
          cursor = savedCursor;
          added = []; modified = []; removed = [];
          continue;
        }

        if (data.error_code) {
          itemError = data.error_code;
          break;
        }

        added = added.concat(data.added || []);
        modified = modified.concat(data.modified || []);
        removed = removed.concat(data.removed || []);
        cursor = data.next_cursor;
        hasMore = data.has_more;
        if (data.transactions_update_status) updateStatus = data.transactions_update_status;
      }

      // Only a complete update is saved; on an error the cursor stays where it was
      if (itemError) cursor = savedCursor;
      else {
        for (const tx of added) {
          // Skip transactions from investment accounts
          if (investAccountPlaidIds.has(tx.account_id)) continue;
          if (tx.date < historyStart) continue;
          if (tx.pending_transaction_id) {
            await migratePendingAction(adminClient, user.id, tx.pending_transaction_id, tx.transaction_id);
          }
          await adminClient.from('synced_transactions').upsert(
            buildTxRow(tx, user.id, item.id),
            { onConflict: 'id' }
          );
          totalAdded++;

          if (!firstSync) {
            if (internal) {
              const day = tx.authorized_date || tx.date;
              if (notifiable(tx, plaidToAccount[tx.account_id]?.type) && day >= recentCutoff && tx.amount) {
                if (!accountLabels) {
                  const { data: labels } = await adminClient.rpc('get_account_labels', { p_user_id: user.id });
                  accountLabels = Object.fromEntries((labels || []).map((l: any) => [l.plaid_account_id, l.label]));
                }
                newTransactions.push({
                  id: tx.transaction_id,
                  pending_id: tx.pending_transaction_id || null,
                  name: tx.merchant_name || tx.name || 'New transaction',
                  amount: tx.amount,
                  account: accountLabels[tx.account_id] || 'Account',
                  pending: !!tx.pending,
                });
              }
            } else {
              // You were in the app for this one: don't notify about it later
              seenIds.push(tx.transaction_id);
            }
          }
        }

        for (const tx of modified) {
          if (investAccountPlaidIds.has(tx.account_id)) continue;
          if (tx.date < historyStart) continue;
          if (tx.pending_transaction_id) {
            await migratePendingAction(adminClient, user.id, tx.pending_transaction_id, tx.transaction_id);
          }
          await adminClient.from('synced_transactions').upsert(
            buildTxRow(tx, user.id, item.id),
            { onConflict: 'id' }
          );
          totalModified++;
        }

        for (const tx of removed) {
          const { data: row } = await adminClient.from('synced_transactions')
            .select('pending').eq('id', tx.transaction_id).eq('user_id', user.id).maybeSingle();
          if (row && !row.pending) {
            // A posted transaction your bank withdrew: never deleted silently. It's set aside
            // (not counted) so you can keep it if it really happened, or delete it.
            await adminClient.from('synced_transactions')
              .update({ removed_at: new Date().toISOString() })
              .eq('id', tx.transaction_id).eq('user_id', user.id);
          } else {
            // A pending charge going away is normal (it posted under a new id, or dropped).
            // Its edits already moved to the posted copy above; clear anything left over.
            await adminClient.from('transaction_actions').delete()
              .eq('user_id', user.id).eq('transaction_id', tx.transaction_id);
            await adminClient.from('synced_transactions').delete()
              .eq('id', tx.transaction_id).eq('user_id', user.id);
          }
          totalRemoved++;
        }
      }

      let plaidLastChecked: string | null = null;
      let consentExpires: string | null = null;
      try {
        const itemData = await plaidRequest('/item/get', {
          access_token: item.access_token,
        });
        if (itemData.status?.transactions?.last_successful_update) {
          plaidLastChecked = itemData.status.transactions.last_successful_update;
        }
        if (itemData.item?.consent_expiration_time) consentExpires = itemData.item.consent_expiration_time;
        if (!itemError && itemData.item?.error?.error_code) itemError = itemData.item.error.error_code;
        // Point this bank at Alenjo's webhook so new transactions arrive on their own (free)
        if (itemData.item && itemData.item.webhook !== myWebhook) {
          const upd = await plaidRequest('/item/webhook/update', { access_token: item.access_token, webhook: myWebhook });
          if (upd.error_code) console.error('webhook update failed:', upd.error_code);
          else console.log('webhook set for item', item.id);
        }
      } catch (e) {
        console.error('item/get error:', e);
      }

      const itemUpdate: Record<string, unknown> = {
        tx_sync_cursor: cursor,
        tx_last_synced_at: new Date().toISOString(),
        consent_expires_at: consentExpires,
        error_code: itemError,
        error_at: itemError ? new Date().toISOString() : null,
      };
      if (plaidLastChecked) itemUpdate.plaid_last_checked_at = plaidLastChecked;
      await adminClient.from('plaid_items').update(itemUpdate).eq('id', item.id);

      // Nothing else will work for this bank until it's reconnected
      if (itemError) {
        needsAttention.push(item.id);
        continue;
      }

      // Re-added a bank whose history you kept? Once its full history is in, fold the old
      // history in: duplicates dropped (your edits move over), anything the new import missed kept.
      if (updateStatus === 'HISTORICAL_UPDATE_COMPLETE') {
        const { data: merged, error: mergeErr } = await adminClient.rpc('merge_reconnected_history', {
          p_user_id: user.id, p_item_id: item.id,
        });
        if (mergeErr) console.error('history merge failed:', mergeErr.message);
        else if (merged?.accounts) console.log('merged kept history:', JSON.stringify(merged));
      }

      try {
        const acctData = await plaidRequest('/accounts/get', {
          access_token: item.access_token,
        });

        if (!acctData.error_code && acctData.accounts) {
          for (const acct of acctData.accounts) {
            await adminClient.rpc('update_account_balance', {
              p_plaid_account_id: acct.account_id,
              p_balance_current: acct.balances.current != null ? String(acct.balances.current) : null,
              p_balance_available: acct.balances.available != null ? String(acct.balances.available) : null,
              p_balance_limit: acct.balances.limit != null ? String(acct.balances.limit) : null,
            });
          }
        }
      } catch (e) {
        console.error('Balance update error:', e);
      }

      // Sync holdings only (no investment transactions)
      if (investmentItemIds.has(item.id)) {
        try {
          const holdingsData = await plaidRequest('/investments/holdings/get', {
            access_token: item.access_token,
          });

          if (holdingsData.error_code) {
            console.error('Holdings API error:', holdingsData.error_code, holdingsData.error_message);
          } else {
            for (const sec of (holdingsData.securities || [])) {
              await adminClient.from('investment_securities').upsert({
                user_id: user.id,
                security_id: sec.security_id,
                name: sec.name,
                ticker_symbol: sec.ticker_symbol || null,
                type: sec.type || null,
                close_price: sec.close_price,
                close_price_as_of: sec.close_price_as_of || null,
                iso_currency_code: sec.iso_currency_code || 'USD',
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id,security_id' });
            }

            const holdings = holdingsData.holdings || [];
            if (holdings.length > 0) {
              const investPlaidIds = Object.keys(plaidToAccount).filter(pid => plaidToAccount[pid].type === 'investment');
              for (const pid of investPlaidIds) {
                await adminClient.from('investment_holdings').delete().eq('account_id', plaidToAccount[pid].id);
              }

              for (const h of holdings) {
                const mapped = plaidToAccount[h.account_id];
                if (!mapped) continue;
                await adminClient.from('investment_holdings').insert({
                  user_id: user.id,
                  account_id: mapped.id,
                  security_id: h.security_id,
                  quantity: h.quantity,
                  cost_basis: h.cost_basis,
                  institution_value: h.institution_value,
                  institution_price: h.institution_price,
                  institution_price_as_of: h.institution_price_as_of || null,
                  iso_currency_code: h.iso_currency_code || 'USD',
                });
                holdingsSynced++;
              }
            }
          }
        } catch (e) {
          console.error('Holdings sync exception:', e);
        }
      }

      if (creditItemIds.has(item.id)) {
        try {
          const liabData = await plaidRequest('/liabilities/get', {
            access_token: item.access_token,
          });

          if (liabData.error_code) {
            console.error('Liabilities API error:', liabData.error_code, liabData.error_message);
          } else {
            for (const cc of (liabData.liabilities?.credit || [])) {
              const mapped = plaidToAccount[cc.account_id];
              if (!mapped) continue;

              const purchaseApr = cc.aprs?.find((a: any) => a.apr_type === 'purchase_apr');
              const cashApr = cc.aprs?.find((a: any) => a.apr_type === 'cash_apr');
              const btApr = cc.aprs?.find((a: any) => a.apr_type === 'balance_transfer_apr');

              await adminClient.from('liabilities').upsert({
                user_id: user.id,
                account_id: mapped.id,
                liability_type: 'credit',
                apr_purchase: purchaseApr?.apr_percentage || null,
                apr_cash: cashApr?.apr_percentage || null,
                apr_balance_transfer: btApr?.apr_percentage || null,
                is_overdue: cc.is_overdue || false,
                last_payment_amount: cc.last_payment_amount,
                last_payment_date: cc.last_payment_date || null,
                last_statement_balance: cc.last_statement_balance,
                minimum_payment_amount: cc.minimum_payment_amount,
                next_payment_due_date: cc.next_payment_due_date || null,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'account_id' });
              liabilitiesSynced++;
            }

            for (const sl of (liabData.liabilities?.student || [])) {
              const mapped = plaidToAccount[sl.account_id];
              if (!mapped) continue;

              await adminClient.from('liabilities').upsert({
                user_id: user.id,
                account_id: mapped.id,
                liability_type: 'student',
                interest_rate: sl.interest_rate_percentage,
                loan_name: sl.loan_name || null,
                loan_status: sl.loan_status?.type || null,
                origination_date: sl.origination_date || null,
                origination_principal: sl.origination_principal_amount || null,
                outstanding_interest: sl.outstanding_interest_amount || null,
                expected_payoff_date: sl.expected_payoff_date || null,
                ytd_interest_paid: sl.ytd_interest_paid || null,
                ytd_principal_paid: sl.ytd_principal_paid || null,
                repayment_plan: sl.repayment_plan?.description || null,
                last_payment_amount: sl.last_payment_amount,
                last_payment_date: sl.last_payment_date || null,
                minimum_payment_amount: sl.minimum_payment_amount,
                next_payment_due_date: sl.next_payment_due_date || null,
                is_overdue: sl.is_overdue || false,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'account_id' });
              liabilitiesSynced++;
            }

            for (const mg of (liabData.liabilities?.mortgage || [])) {
              const mapped = plaidToAccount[mg.account_id];
              if (!mapped) continue;

              const addr = mg.property_address;
              const addrStr = addr ? [addr.street, addr.city, addr.region, addr.postal_code].filter(Boolean).join(', ') : null;

              await adminClient.from('liabilities').upsert({
                user_id: user.id,
                account_id: mapped.id,
                liability_type: 'mortgage',
                interest_rate: mg.interest_rate?.percentage || null,
                loan_term: mg.loan_term || null,
                loan_type: mg.loan_type_description || null,
                maturity_date: mg.maturity_date || null,
                next_monthly_payment: mg.next_monthly_payment || null,
                escrow_balance: mg.escrow_balance || null,
                has_pmi: mg.has_pmi || false,
                property_address: addrStr,
                past_due_amount: mg.past_due_amount || null,
                origination_date: mg.origination_date || null,
                origination_principal: mg.origination_principal_amount || null,
                last_payment_amount: mg.last_payment_amount,
                last_payment_date: mg.last_payment_date || null,
                next_payment_due_date: mg.next_payment_due_date || null,
                is_overdue: mg.is_overdue || false,
                ytd_interest_paid: mg.ytd_interest_paid || null,
                ytd_principal_paid: mg.ytd_principal_paid || null,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'account_id' });
              liabilitiesSynced++;
            }
          }
        } catch (e) {
          console.error('Liabilities sync exception:', e);
        }
      }
    }

    if (seenIds.length) {
      await adminClient.from('notified_transactions').upsert(
        seenIds.map((id) => ({ transaction_id: id, user_id: user!.id })),
        { onConflict: 'transaction_id', ignoreDuplicates: true },
      );
    }

    return jsonResponse({
      success: true,
      added: totalAdded,
      modified: totalModified,
      removed: totalRemoved,
      holdings_synced: holdingsSynced,
      liabilities_synced: liabilitiesSynced,
      needs_attention: needsAttention,
      ...(internal ? { new_transactions: newTransactions } : {}),
    });
  } catch (err) {
    console.error('Sync error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

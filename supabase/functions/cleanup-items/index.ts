import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest } from "./plaid.js";

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

async function removeItemFromPlaid(accessToken: string) {
  return plaidRequest('/item/remove', { access_token: accessToken });
}

// Delete everything stored for one connection: accounts, transactions, your edits on them.
async function deleteItemData(adminClient: any, userId: string, itemId: string) {
  const { data: itemAccounts } = await adminClient
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('plaid_item_id', itemId);
  if (itemAccounts) {
    for (const acct of itemAccounts) {
      await adminClient.from('investment_holdings').delete().eq('account_id', acct.id);
      await adminClient.from('liabilities').delete().eq('account_id', acct.id);
    }
  }
  // Your actions (ignored, split, notes...) on this connection's transactions, then the transactions
  const PAGE = 1000;
  for (;;) {
    const { data: txIds } = await adminClient
      .from('synced_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('plaid_item_id', itemId)
      .limit(PAGE);
    if (!txIds || txIds.length === 0) break;
    const ids = txIds.map((t: { id: string }) => t.id);
    await adminClient.from('transaction_actions').delete().eq('user_id', userId).in('transaction_id', ids);
    await adminClient.from('synced_transactions').delete().in('id', ids);
    if (txIds.length < PAGE) break;
  }
  await adminClient.from('accounts').delete().eq('user_id', userId).eq('plaid_item_id', itemId);
}

// Disconnect at Plaid (free; stops the monthly fee). Then either keep the history
// (accounts marked closed, transactions and your edits stay) or delete it all.
// The bank access token is wiped either way: it's useless after /item/remove.
async function disconnectItem(adminClient: any, userId: string, item: any, keepHistory: boolean) {
  await removeItemFromPlaid(item.access_token);
  if (keepHistory) {
    const { data: itemAccounts } = await adminClient
      .from('accounts').select('id').eq('user_id', userId).eq('plaid_item_id', item.id);
    for (const acct of (itemAccounts || [])) {
      // Holdings and card/loan details would only go stale
      await adminClient.from('investment_holdings').delete().eq('account_id', acct.id);
      await adminClient.from('liabilities').delete().eq('account_id', acct.id);
    }
    await adminClient.from('accounts').update({ closed_at: new Date().toISOString() })
      .eq('user_id', userId).eq('plaid_item_id', item.id).is('closed_at', null);
  } else {
    await deleteItemData(adminClient, userId, item.id);
  }
  await adminClient.from('plaid_items')
    .update({ status: 'removed', access_token_enc: null, tx_sync_cursor: null })
    .eq('id', item.id).eq('user_id', userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);
    // Two-step sign-in, when it's on, must be completed first (server-side check)
    const { data: mfaOk } = await userClient.rpc('mfa_satisfied');
    if (mfaOk !== true) return jsonResponse({ error: 'Two-step sign-in required' }, 403);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: any = {};
    try { body = await req.json(); } catch (_) {}

    // DELETE THE SAVED HISTORY OF AN ALREADY-DISCONNECTED (CLOSED) CONNECTION
    if (body.purge_item_id) {
      const { data: row } = await adminClient.from('plaid_items')
        .select('id').eq('id', body.purge_item_id).eq('user_id', user.id).eq('status', 'removed').maybeSingle();
      if (!row) return jsonResponse({ error: 'Item not found' }, 404);
      await deleteItemData(adminClient, user.id, row.id);
      await adminClient.from('plaid_items').delete().eq('id', row.id).eq('user_id', user.id);
      return jsonResponse({ purged: 1 });
    }

    const { data: items } = await adminClient.rpc('get_user_plaid_items', {
      p_user_id: user.id,
    });

    if (!items || items.length === 0) {
      return jsonResponse({ message: 'No items to remove' });
    }

    // DISCONNECT ONE CONNECTION (keeps history unless keep_history is false)
    if (body.item_id) {
      const item = items.find((i: any) => i.id === body.item_id);
      if (!item) return jsonResponse({ error: 'Item not found' }, 404);
      await disconnectItem(adminClient, user.id, item, body.keep_history !== false);
      return jsonResponse({ removed: 1, kept_history: body.keep_history !== false });
    }

    // REMOVE ALL -- requires explicit flag; deletes everything
    if (body.remove_all === true) {
      for (const item of items) {
        await disconnectItem(adminClient, user.id, item, false);
      }
      return jsonResponse({ removed: items.length });
    }

    return jsonResponse({ error: 'Must specify item_id, purge_item_id or remove_all: true' }, 400);
  } catch (err) {
    console.error('Cleanup error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

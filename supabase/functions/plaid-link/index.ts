import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest, webhookUrl } from "./plaid.js";

const PLAID_MAX_DAYS = 730;
// SA-016: each connected bank adds a monthly Plaid fee. Off while Alenjo is single-user;
// set a number (e.g. 10) before opening signups to cap connections per account.
const MAX_CONNECTIONS = null;
const LIMIT_MESSAGE = 'You can connect up to ' + MAX_CONNECTIONS + ' banks. Disconnect one in Settings first.';
async function atConnectionLimit(adminClient, userId) {
  if (MAX_CONNECTIONS == null) return false;
  const { count } = await adminClient.from('plaid_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active');
  return (count || 0) >= MAX_CONNECTIONS;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Calendar date (year, month 1-12, day) in US Eastern time.
function nyYMD(d) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// History window: from the 1st of the month BEFORE the user's first connection
// (or before today, for a brand-new user) through today. Every bank a user
// connects shares the same start date.
function computeDaysRequested(firstConnectedAt) {
  const anchor = nyYMD(firstConnectedAt ? new Date(firstConnectedAt) : new Date());
  const today = nyYMD(new Date());
  const startUTC = Date.UTC(anchor.y, anchor.m - 2, 1);
  const todayUTC = Date.UTC(today.y, today.m - 1, today.d);
  const days = Math.floor((todayUTC - startUTC) / 86400000) + 1;
  return Math.min(Math.max(days, 1), PLAID_MAX_DAYS);
}

// Plaid OAuth: a bank's own sign-in page sends you back here. Only used once the address
// is added to Allowed redirect URIs in the Plaid Dashboard and set as PLAID_REDIRECT_URI;
// until then Link works exactly as before (pop-up sign-in).
const REDIRECT_URI = Deno.env.get('PLAID_REDIRECT_URI') || null;

// Create a Link token and remember it for you, so Link can be reopened with the same token
// when you come back from your bank's sign-in page (Plaid's recommended OAuth handling).
async function linkToken(adminClient, userId, params, kind, itemId = null) {
  const data = await plaidRequest('/link/token/create', REDIRECT_URI ? { ...params, redirect_uri: REDIRECT_URI } : params);
  if (!data.error_code && data.link_token) {
    await adminClient.from('plaid_link_sessions').upsert({ user_id: userId, link_token: data.link_token, kind, item_id: itemId, created_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }
  return data;
}

// Plaid's duplicate check: same bank AND one of the accounts you picked matches one you
// already have (name and last 4). If either side has no name or last 4, the bank alone counts.
async function isDuplicate(adminClient, userClient, userId, institution, picked) {
  if (!institution?.institution_id) return false;
  const { data: items } = await adminClient.from('plaid_items').select('id').eq('user_id', userId).eq('institution_id', institution.institution_id).eq('status', 'active');
  if (!items || !items.length) return false;
  const ids = new Set(items.map((i) => i.id));
  const { data: mine } = await userClient.rpc('get_user_accounts');
  const existing = (mine || []).filter((a) => ids.has(a.plaid_item_id) && !a.closed_at);
  const chosen = Array.isArray(picked) ? picked : [];
  const usable = (x) => x && x.name && x.mask;
  if (!chosen.length || !existing.length || !chosen.every(usable) || !existing.every(usable)) return true;
  const key = (x) => String(x.name).trim().toLowerCase() + '|' + String(x.mask);
  const have = new Set(existing.map(key));
  return chosen.some((x) => have.has(key(x)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { action, public_token, institution, item_id, accounts } = await req.json();

    if (action === 'create_link_token') {
      if (await atConnectionLimit(adminClient, user.id)) return jsonResponse({ error: 'limit', detail: LIMIT_MESSAGE }, 400);
      // Products are fixed server-side so a caller can't add Plaid products billed per item or per call.
      const requestedProducts = ['transactions'];
      const { data: oldestItem } = await adminClient.from('plaid_items').select('created_at').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
      const daysRequested = computeDaysRequested(oldestItem?.created_at || null);
      const linkParams = {
        user: { client_user_id: user.id },
        client_name: 'Alenjo',
        products: requestedProducts,
        // Plaid's recommended setup: ask permission for these now, but only start (and pay for)
        // each one when Alenjo first uses it, which sync does only for banks with matching
        // accounts (investments: investment accounts; liabilities: cards and loans).
        additional_consented_products: ['investments', 'liabilities'],
        country_codes: ['US'],
        language: 'en',
        // New transactions ping Alenjo's server (free), which powers notifications
        webhook: webhookUrl(),
        transactions: { days_requested: daysRequested },
      };
      console.log('Link token: days_requested=' + daysRequested);
      const data = await linkToken(adminClient, user.id, linkParams, 'new');
      if (data.error_code) {
        console.error('Link token error:', data.error_code, data.error_message);
        return jsonResponse({ error: 'Plaid error', detail: data.error_message }, 500);
      }
      return jsonResponse({ link_token: data.link_token });
    }

    // Reconnect a bank that needs you to sign in again (Plaid "update mode").
    // Same connection, so no new item and nothing extra billed; all history stays.
    if (action === 'create_reconnect_token') {
      if (!item_id) return jsonResponse({ error: 'Missing item_id' }, 400);
      const { data: itemData } = await adminClient.rpc('get_user_plaid_items', { p_user_id: user.id });
      const item = itemData?.find((i) => i.id === item_id);
      if (!item) return jsonResponse({ error: 'Item not found' }, 404);
      const data = await linkToken(adminClient, user.id, {
        user: { client_user_id: user.id },
        client_name: 'Alenjo',
        access_token: item.access_token,
        country_codes: ['US'],
        language: 'en',
        update: { account_selection_enabled: false },
      }, 'reconnect', item.id);
      if (data.error_code) {
        console.error('Reconnect token error:', data.error_code, data.error_message);
        return jsonResponse({ error: 'Plaid error', detail: data.error_message }, 500);
      }
      return jsonResponse({ link_token: data.link_token });
    }

    if (action === 'update_consent') {
      if (!item_id) return jsonResponse({ error: 'Missing item_id' }, 400);
      const { data: itemData } = await adminClient.rpc('get_user_plaid_items', { p_user_id: user.id });
      const item = itemData?.find((i) => i.id === item_id);
      if (!item) return jsonResponse({ error: 'Item not found' }, 404);
      const linkParams = {
        user: { client_user_id: user.id },
        client_name: 'Alenjo',
        access_token: item.access_token,
        country_codes: ['US'],
        language: 'en',
        update: { account_selection_enabled: false },
        additional_consented_products: ['investments', 'liabilities'],
      };
      const data = await linkToken(adminClient, user.id, linkParams, 'consent', item.id);
      if (data.error_code) {
        console.error('Update consent link token error:', data.error_code, data.error_message);
        return jsonResponse({ error: 'Plaid error', detail: data.error_message }, 500);
      }
      return jsonResponse({ link_token: data.link_token });
    }

    // Back from your bank's sign-in page: the Link token you started with (Link tokens last 4 hours)
    if (action === 'resume_link') {
      const { data: s } = await adminClient.from('plaid_link_sessions').select('link_token, kind, item_id, created_at').eq('user_id', user.id).maybeSingle();
      if (!s || Date.now() - new Date(s.created_at).getTime() > 4 * 3600 * 1000) return jsonResponse({ error: 'expired' }, 404);
      return jsonResponse({ link_token: s.link_token, kind: s.kind, item_id: s.item_id });
    }

    // You finished update mode (reconnect or add accounts): the bank alert is handled
    if (action === 'clear_notice') {
      if (!item_id) return jsonResponse({ error: 'Missing item_id' }, 400);
      await adminClient.from('plaid_items').update({ notice_code: null, notice_at: null }).eq('id', item_id).eq('user_id', user.id);
      return jsonResponse({ success: true });
    }

    if (action === 'create_add_accounts_token') {
      if (!item_id) return jsonResponse({ error: 'Missing item_id' }, 400);
      const { data: itemData } = await adminClient.rpc('get_user_plaid_items', { p_user_id: user.id });
      const item = itemData?.find((i) => i.id === item_id);
      if (!item) return jsonResponse({ error: 'Item not found' }, 404);
      const linkParams = {
        user: { client_user_id: user.id },
        client_name: 'Alenjo',
        access_token: item.access_token,
        country_codes: ['US'],
        language: 'en',
        update: { account_selection_enabled: true },
      };
      const data = await linkToken(adminClient, user.id, linkParams, 'add_accounts', item.id);
      if (data.error_code) {
        console.error('Add-accounts token error:', data.error_code, data.error_message);
        return jsonResponse({ error: 'Plaid error', detail: data.error_message }, 500);
      }
      return jsonResponse({ link_token: data.link_token });
    }

    if (action === 'sync_added_accounts') {
      if (!item_id) return jsonResponse({ error: 'Missing item_id' }, 400);
      const { data: itemData } = await adminClient.rpc('get_user_plaid_items', { p_user_id: user.id });
      const item = itemData?.find((i) => i.id === item_id);
      if (!item) return jsonResponse({ error: 'Item not found' }, 404);
      const { data: existingIds, error: idsError } = await adminClient.rpc('get_plaid_account_ids_for_item', { p_user_id: user.id, p_plaid_item_id: item_id });
      if (idsError) {
        console.error('Error loading existing account ids:', idsError);
        return jsonResponse({ error: 'Failed to read existing accounts' }, 500);
      }
      const accountsData = await plaidRequest('/accounts/get', { access_token: item.access_token });
      if (accountsData.error_code) {
        console.error('accounts/get error:', accountsData.error_code, accountsData.error_message);
        return jsonResponse({ error: 'Failed to fetch accounts', detail: accountsData.error_message }, 500);
      }
      const existingSet = new Set(existingIds || []);
      let added = 0;
      for (const acct of accountsData.accounts) {
        if (existingSet.has(acct.account_id)) continue;
        const { error: acctError } = await adminClient.rpc('insert_account', {
          p_user_id: user.id,
          p_plaid_item_id: item_id,
          p_plaid_account_id: acct.account_id,
          p_name: acct.name,
          p_official_name: acct.official_name || null,
          p_type: acct.type,
          p_subtype: acct.subtype || null,
          p_mask: acct.mask || null,
          p_balance_current: acct.balances.current != null ? String(acct.balances.current) : null,
          p_balance_available: acct.balances.available != null ? String(acct.balances.available) : null,
          p_balance_limit: acct.balances.limit != null ? String(acct.balances.limit) : null,
          p_iso_currency_code: acct.balances.iso_currency_code || 'USD',
        });
        if (acctError) {
          console.error('Error inserting added account:', acctError);
        } else {
          added += 1;
        }
      }
      try {
        await plaidRequest('/transactions/sync', { access_token: item.access_token });
      } catch (e) {
        console.log('tx sync after add-accounts skipped:', e);
      }
      return jsonResponse({ success: true, added });
    }

    if (action === 'check_duplicate') {
      if (await isDuplicate(adminClient, supabaseClient, user.id, institution, accounts)) {
        return jsonResponse({
          duplicate: true,
          message: 'These accounts are already connected. Use the existing connection or remove it first in Settings.',
        });
      }
      return jsonResponse({ duplicate: false });
    }

    if (action === 'exchange_token') {
      // Checked again here: an unexchanged connection never gets an access token, so it's never billed
      if (await atConnectionLimit(adminClient, user.id)) return jsonResponse({ error: 'limit', message: LIMIT_MESSAGE }, 400);
      // Plaid: never exchange a public token for a duplicate connection
      if (await isDuplicate(adminClient, supabaseClient, user.id, institution, accounts)) {
        return jsonResponse({ error: 'duplicate', message: 'These accounts are already connected.' }, 409);
      }
      const exchangeData = await plaidRequest('/item/public_token/exchange', { public_token });
      if (exchangeData.error_code) {
        return jsonResponse({ error: 'Plaid exchange error', detail: exchangeData.error_message }, 500);
      }
      const accessToken = exchangeData.access_token;
      const itemId = exchangeData.item_id;
      let institutionUrl = null;
      if (institution?.institution_id) {
        try {
          const instData = await plaidRequest('/institutions/get_by_id', { institution_id: institution.institution_id, country_codes: ['US'] });
          if (instData.institution?.url) {
            institutionUrl = instData.institution.url;
          }
        } catch (e) {
          console.error('Failed to fetch institution details:', e);
        }
      }
      const { data: plaidItemId, error: itemError } = await adminClient.rpc('insert_plaid_item', {
        p_user_id: user.id,
        p_access_token: accessToken,
        p_item_id: itemId,
        p_institution_name: institution?.name || null,
        p_institution_id: institution?.institution_id || null,
        p_institution_url: institutionUrl,
      });
      if (itemError) {
        console.error('Error storing plaid item:', itemError);
        return jsonResponse({ error: 'Failed to store connection', detail: itemError.message }, 500);
      }
      const accountsData = await plaidRequest('/accounts/get', { access_token: accessToken });
      if (accountsData.error_code) {
        return jsonResponse({ error: 'Failed to fetch accounts', detail: accountsData.error_message }, 500);
      }
      for (const acct of accountsData.accounts) {
        const { error: acctError } = await adminClient.rpc('insert_account', {
          p_user_id: user.id,
          p_plaid_item_id: plaidItemId,
          p_plaid_account_id: acct.account_id,
          p_name: acct.name,
          p_official_name: acct.official_name || null,
          p_type: acct.type,
          p_subtype: acct.subtype || null,
          p_mask: acct.mask || null,
          p_balance_current: acct.balances.current != null ? String(acct.balances.current) : null,
          p_balance_available: acct.balances.available != null ? String(acct.balances.available) : null,
          p_balance_limit: acct.balances.limit != null ? String(acct.balances.limit) : null,
          p_iso_currency_code: acct.balances.iso_currency_code || 'USD',
        });
        if (acctError) {
          console.error('Error storing account:', acctError);
        }
      }
      try {
        await plaidRequest('/transactions/sync', { access_token: accessToken });
      } catch (e) {
        console.log('Initial tx sync skipped:', e);
      }
      return jsonResponse({ success: true, accounts: accountsData.accounts.length });
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (err) {
    console.error('Edge function error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

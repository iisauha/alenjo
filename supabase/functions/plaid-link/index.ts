import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest, webhookUrl } from "./plaid.js";

const PLAID_MAX_DAYS = 730;
// SA-016: each connected bank adds a monthly Plaid fee, so cap them per account
const MAX_CONNECTIONS = 10;
const LIMIT_MESSAGE = 'You can connect up to ' + MAX_CONNECTIONS + ' banks. Disconnect one in Settings first.';
async function atConnectionLimit(adminClient, userId) {
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

    const { action, public_token, institution, item_id } = await req.json();

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
        required_if_supported_products: ['investments'],
        optional_products: ['liabilities'],
        country_codes: ['US'],
        language: 'en',
        // New transactions ping Alenjo's server (free), which powers notifications
        webhook: webhookUrl(),
        transactions: { days_requested: daysRequested },
      };
      console.log('Link token: days_requested=' + daysRequested);
      const data = await plaidRequest('/link/token/create', linkParams);
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
      const data = await plaidRequest('/link/token/create', {
        user: { client_user_id: user.id },
        client_name: 'Alenjo',
        access_token: item.access_token,
        country_codes: ['US'],
        language: 'en',
        update: { account_selection_enabled: false },
      });
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
        additional_consented_products: ['investments'],
      };
      const data = await plaidRequest('/link/token/create', linkParams);
      if (data.error_code) {
        console.error('Update consent link token error:', data.error_code, data.error_message);
        return jsonResponse({ error: 'Plaid error', detail: data.error_message }, 500);
      }
      return jsonResponse({ link_token: data.link_token });
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
      const data = await plaidRequest('/link/token/create', linkParams);
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
      if (!institution?.institution_id) {
        return jsonResponse({ duplicate: false });
      }
      const { data: existingItems } = await adminClient.from('plaid_items').select('id, institution_id').eq('user_id', user.id).eq('institution_id', institution.institution_id).eq('status', 'active');
      if (existingItems && existingItems.length > 0) {
        return jsonResponse({
          duplicate: true,
          message: 'This institution is already connected. Use the existing connection or remove it first in Settings.',
        });
      }
      return jsonResponse({ duplicate: false });
    }

    if (action === 'exchange_token') {
      // Checked again here: an unexchanged connection never gets an access token, so it's never billed
      if (await atConnectionLimit(adminClient, user.id)) return jsonResponse({ error: 'limit', message: LIMIT_MESSAGE }, 400);
      if (institution?.institution_id) {
        const { data: existingItems } = await adminClient.from('plaid_items').select('id').eq('user_id', user.id).eq('institution_id', institution.institution_id).eq('status', 'active');
        if (existingItems && existingItems.length > 0) {
          return jsonResponse({ error: 'duplicate', message: 'This institution is already connected.' }, 409);
        }
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

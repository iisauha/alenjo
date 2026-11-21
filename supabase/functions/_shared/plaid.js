// The only way Alenjo's server talks to Plaid.
//
// Billing guard: every endpoint here is either free or covered by the flat
// monthly fee Alenjo already pays per connection. Anything billed per call
// (/accounts/balance/get, /transactions/refresh, /investments/refresh, Enrich,
// Auth, Identity, ...) or that adds a new subscription (/investments/transactions/get)
// is refused before a request is ever sent.
const ALLOWED = new Set([
  '/transactions/sync',            // Transactions subscription
  '/investments/holdings/get',     // Investments Holdings subscription
  '/liabilities/get',              // Liabilities subscription
  '/accounts/get',                 // free (cached balances)
  '/item/get',                     // free
  '/item/remove',                  // free, ends the monthly fee
  '/item/webhook/update',          // free
  '/item/public_token/exchange',   // free
  '/link/token/create',            // free
  '/institutions/get_by_id',       // free
  '/webhook_verification_key/get', // free
]);

const env = (k) => (typeof Deno !== 'undefined' ? Deno.env.get(k) : process.env[k]);

export async function plaidRequest(endpoint, body) {
  if (!ALLOWED.has(endpoint)) {
    console.error('Blocked Plaid endpoint (not free or already paid for):', endpoint);
    return { error_code: 'ENDPOINT_NOT_ALLOWED', error_message: 'Blocked by Alenjo billing guard: ' + endpoint };
  }
  const base = `https://${env('PLAID_ENV') || 'sandbox'}.plaid.com`;
  const res = await fetch(base + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env('PLAID_CLIENT_ID'), secret: env('PLAID_SECRET'), ...body }),
  });
  return res.json();
}

export function webhookUrl() {
  return env('SUPABASE_URL') + '/functions/v1/plaid-webhook';
}

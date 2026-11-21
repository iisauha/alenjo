import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest } from "./plaid.js";
import { deliver } from "./notify.js";

// Plaid calls this when something changes on a connection. Every ping must
// carry Plaid's signature; anything else is rejected. New transactions are
// pulled with the same free sync Alenjo runs at sign-in (sync-transactions),
// then turned into notifications.
const enc = new TextEncoder();
const keyCache = new Map<string, CryptoKey>();

function unb64u(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function verify(token: string | null, rawBody: string) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
  if (header.alg !== 'ES256' || !header.kid) return false;
  let key = keyCache.get(header.kid);
  if (!key) {
    const res = await plaidRequest('/webhook_verification_key/get', { key_id: header.kid });
    if (!res.key || res.key.expired_at) return false;
    key = await crypto.subtle.importKey('jwk', { kty: res.key.kty, crv: res.key.crv, x: res.key.x, y: res.key.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    keyCache.set(header.kid, key);
  }
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return false;
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
  if (!claims.iat || Math.abs(Date.now() / 1000 - claims.iat) > 5 * 60) return false;
  const digest = hex(await crypto.subtle.digest('SHA-256', enc.encode(rawBody)));
  return typeof claims.request_body_sha256 === 'string' && same(digest, claims.request_body_sha256);
}

async function handle(evt: any) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!evt.item_id) return;
  const hash = hex(await crypto.subtle.digest('SHA-256', enc.encode(evt.item_id)));
  const { data: item } = await admin.from('plaid_items').select('id, user_id, status').eq('item_id_hash', hash).maybeSingle();
  if (!item || item.status !== 'active') { console.log('webhook for unknown or removed item', evt.webhook_type, evt.webhook_code); return; }

  if (evt.webhook_type === 'TRANSACTIONS' && evt.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
    const res = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/sync-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') },
      body: JSON.stringify({ internal: true, user_id: item.user_id, item_id: item.id }),
    });
    const out = await res.json().catch(() => ({}));
    const fresh = out.new_transactions || [];
    console.log('webhook sync', res.status, 'new', fresh.length);
    if (fresh.length) console.log('notify', JSON.stringify(await deliver(admin, item.user_id, fresh)));
    return;
  }
  if (evt.webhook_type === 'ITEM' && evt.webhook_code === 'ERROR' && evt.error?.error_code) {
    // The bank needs you: Alenjo shows Reconnect
    await admin.from('plaid_items').update({ error_code: evt.error.error_code, error_at: new Date().toISOString() }).eq('id', item.id);
    return;
  }
  if (evt.webhook_type === 'ITEM' && evt.webhook_code === 'LOGIN_REPAIRED') {
    await admin.from('plaid_items').update({ error_code: null, error_at: null }).eq('id', item.id);
    return;
  }
  console.log('webhook ignored', evt.webhook_type, evt.webhook_code);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  let ok = false;
  try { ok = await verify(req.headers.get('Plaid-Verification'), raw); } catch (e) { console.error('verify error', e); }
  if (!ok) { console.warn('rejected webhook: bad signature'); return new Response('Unauthorized', { status: 401 }); }
  let evt: any;
  try { evt = JSON.parse(raw); } catch (_) { return new Response('Bad request', { status: 400 }); }
  // Answer Plaid right away; do the work in the background
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(handle(evt).catch((e) => console.error('webhook handling failed', e)));
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});

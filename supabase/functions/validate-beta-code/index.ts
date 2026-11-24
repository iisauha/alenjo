import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// validate-beta-code: checks the beta sign-up code. With an email, issues a one-time 15-minute
// sign-up ticket (the database rejects any new account without one).
// Guessing is limited: 10 wrong tries an hour per network address, 200 an hour overall, and
// every attempt is recorded before it's checked so tries sent all at once still count.
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://alenjo.com' };
const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function sha256(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
// Same time whether the first or last character is wrong
function sameText(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': 'https://alenjo.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST' } });
  }
  if (req.method !== 'POST') return respond({ valid: false }, 405);
  let body: { code?: string; email?: string };
  try { body = await req.json(); } catch { return respond({ valid: false }, 400); }

  const secret = Deno.env.get('BETA_CODE');
  if (!secret) return respond({ valid: false, error: 'Beta access not configured' }, 500);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const ipHash = await sha256(secret + '|' + ip);
  const { data: row } = await admin.from('beta_code_attempts').insert({ ip_hash: ipHash }).select('id').single();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [mine, all] = await Promise.all([
    admin.from('beta_code_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).eq('ok', false).gte('at', since),
    admin.from('beta_code_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('at', since),
  ]);
  if ((mine.count || 0) > 10 || (all.count || 0) > 200) return respond({ valid: false, error: 'Too many tries. Try again in an hour.' }, 429);

  const valid = typeof body.code === 'string' && sameText(body.code.trim(), secret.trim());
  if (!valid) {
    await new Promise((r) => setTimeout(r, 1000));   // slow down guessing
    return respond({ valid: false });
  }
  if (row) await admin.from('beta_code_attempts').update({ ok: true }).eq('id', row.id);

  if (typeof body.email === 'string' && body.email.includes('@')) {
    const { error } = await admin.from('signup_tickets').upsert({
      email: body.email.trim().toLowerCase(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (error) { console.error('Ticket error:', error); return respond({ valid: false, error: 'Could not start sign-up' }, 500); }
  }
  return respond({ valid: true });
});

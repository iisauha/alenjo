import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// mfa-recovery: backup ways into two-step sign-in.
//   { action: 'list' }               fully signed in (code done) -> your backup codes and which are used
//   { action: 'generate' }           fully signed in -> a new set of 10 (the old set stops working)
//   { action: 'use-code', code }     signed in with your password, code step not done -> a valid unused
//                                    backup code turns two-step off so you can get in and set it up again
//   { action: 'use-email', password } signed in through the email link (within 30 min) -> your password
//                                    as well turns two-step off. Needs both your email and your password.
// Wrong attempts are limited to 5 an hour.
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L

function claims(token: string): any {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
  } catch { return {}; }
}
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const c = claims(token);
    const body = await req.json().catch(() => ({}));

    const { data: fl } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    const factors = (fl?.factors || []).filter((f: any) => f.status === 'verified');

    if (body.action === 'list' || body.action === 'generate') {
      if (factors.length && c.aal !== 'aal2') return json({ error: 'Enter your two-step code first' }, 403);
      if (body.action === 'generate') {
        const codes = Array.from({ length: 10 }, newCode);
        const { error } = await admin.rpc('mfa_codes_store', { p_user: user.id, p_codes: codes });
        if (error) throw error;
      }
      const { data, error } = await admin.rpc('mfa_codes_list', { p_user: user.id });
      if (error) throw error;
      return json({ codes: data || [] });
    }

    if (body.action === 'use-code' || body.action === 'use-email') {
      if (!factors.length) return json({ ok: true, off: true });   // nothing to turn off
      // Record the attempt first (as a miss), then count: tries sent all at once still count
      const { data: row } = await admin.from('mfa_recovery_log').insert({ user_id: user.id, kind: body.action, ok: false }).select('id').single();
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from('mfa_recovery_log').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('ok', false).gte('at', since);
      if ((count || 0) > 5) return json({ error: 'Too many tries. Wait an hour and try again.' }, 429);
      const log = async (ok: boolean) => { if (ok && row) await admin.from('mfa_recovery_log').update({ ok: true }).eq('id', row.id); };

      if (body.action === 'use-code') {
        const code = typeof body.code === 'string' ? body.code.slice(0, 20) : '';
        const { data: ok, error } = await admin.rpc('mfa_code_use', { p_user: user.id, p_code: code });
        if (error) throw error;
        if (!ok) { await log(false); return json({ error: 'That backup code didn’t work, or it was already used.' }, 400); }
      } else {
        // The email link proves your email (sign-in by link within the last 30 minutes) ...
        const amr = Array.isArray(c.amr) ? c.amr : [];
        const viaLink = amr.some((m: any) => (m.method === 'otp' || m.method === 'magiclink') && Date.now() / 1000 - (m.timestamp || 0) < 1800);
        if (!viaLink) return json({ error: 'Open the link from your email first.' }, 403);
        // ... and your password proves it's you
        const pw = typeof body.password === 'string' ? body.password : '';
        const check = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
        const r = await check.auth.signInWithPassword({ email: user.email!, password: pw });
        if (r.error || !r.data.session || r.data.session.user.id !== user.id) { await log(false); return json({ error: 'That password isn’t right.' }, 400); }
        await check.auth.signOut({ scope: 'local' }).catch(() => {});
      }
      // Turn two-step off (and retire the backup codes) so you can sign in and set it up again
      for (const f of factors) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
      await admin.rpc('mfa_codes_store', { p_user: user.id, p_codes: [] });
      await log(true);
      return json({ ok: true, off: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong' }, 500);
  }
});

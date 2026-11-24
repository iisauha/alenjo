import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Finds the website (for the logo) of each bank you've connected that doesn't have one yet.
// The logo.dev search key is secret, so this runs on the server.
const LOGO_SECRET = Deno.env.get('LOGO_DEV_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    // Two-step sign-in, when it's on, must be completed first (server-side check)
    const { data: mfaOk } = await userClient.rpc('mfa_satisfied');
    if (mfaOk !== true) return json({ error: 'Two-step sign-in required' }, 403);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: items } = await admin.from('plaid_items')
      .select('id, institution_name_enc')
      .eq('user_id', user.id)
      .is('institution_logo_domain', null);
    if (!items || items.length === 0) return json({ resolved: 0 });

    let resolved = 0;
    for (const item of items) {
      if (!item.institution_name_enc) continue;
      const { data: name } = await admin.rpc('decrypt_text', { cipher: item.institution_name_enc });
      if (!name) continue;
      // "Chase - Personal Banking" -> "Chase"
      const cleanName = String(name).replace(/\s*-\s*(Personal|Online|Banking|Credit|Checking|Savings).*$/i, '').trim().slice(0, 60);
      try {
        const res = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(cleanName)}`, { headers: { Authorization: `Bearer ${LOGO_SECRET}` } });
        if (!res.ok) continue;
        const results = await res.json();
        const domain = Array.isArray(results) && results[0] && typeof results[0].domain === 'string' ? results[0].domain.toLowerCase() : '';
        // Only a plain hostname: the app puts this inside an image URL
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) continue;
        await admin.from('plaid_items').update({ institution_logo_domain: domain }).eq('id', item.id).eq('user_id', user.id);
        resolved++;
      } catch (e) {
        console.error('logo search failed:', e);
      }
    }
    return json({ resolved });
  } catch (err) {
    console.error('resolve-logos error:', err);
    return json({ error: 'Internal error' }, 500);
  }
});

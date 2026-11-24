import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Brand search for the logo picker. The logo.dev search key is secret, so the
// browser asks this function instead of calling logo.dev directly.
const LOGO_SECRET = Deno.env.get('LOGO_DEV_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 60);
    if (q.length < 2) return json({ results: [] });

    const res = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${LOGO_SECRET}` } });
    if (!res.ok) return json({ results: [] });
    const data = await res.json();
    const results = (Array.isArray(data) ? data : [])
      .filter((r: any) => r && typeof r.domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(r.domain))
      .slice(0, 9)
      .map((r: any) => ({ name: String(r.name || r.domain).slice(0, 60), domain: r.domain.toLowerCase() }));
    return json({ results });
  } catch (_e) {
    return json({ results: [] });
  }
});

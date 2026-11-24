import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// cache-logos: { items: [{ key, url }] } from the signed-in app.
// Fetches each bank or store logo once (server side, so the browser's cross-site rules don't
// matter), and saves it to image_cache as a small data URL. A logo that doesn't exist is saved
// as 'none' so the app shows the letter without asking again. Only logo.dev and Plaid's logo
// host are fetched; anything else is ignored.
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const HOSTS = new Set(['img.logo.dev', 'plaid-merchant-logos.plaid.com']);
const MAX_BYTES = 90_000;

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function grab(raw: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
  if (url.hostname === 'img.logo.dev') {
    // A small WebP is plenty for a logo circle
    url.searchParams.set('size', '64'); url.searchParams.set('retina', 'true');
    url.searchParams.set('format', 'webp'); url.searchParams.set('fallback', '404');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status === 404 || res.status === 400) return 'none';
    if (!res.ok) return null;                       // a hiccup: try again another time
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type)) return 'none';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return 'none';
    if (bytes.length > MAX_BYTES) return null;
    return 'data:' + type + ';base64,' + b64(bytes);
  } catch { return null; } finally { clearTimeout(t); }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40)
      .filter((i: any) => i && typeof i.key === 'string' && i.key.length < 300 && typeof i.url === 'string' && i.url.length < 1000);
    const out: Record<string, string> = {};
    await Promise.all(items.map(async (i: any) => { const d = await grab(i.url); if (d) out[i.key] = d; }));
    const rows = Object.keys(out).map((k) => ({ user_id: u.user!.id, key: k, data: out[k], updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await admin.from('image_cache').upsert(rows, { onConflict: 'user_id,key' });
      if (error) console.error('save', error.message);
    }
    return json({ images: out });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong' }, 500);
  }
});

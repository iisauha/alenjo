import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { plaidRequest } from "./plaid.js";

// Deletes the signed-in user's whole account:
// 1. tells Plaid to disconnect every bank (free, and stops the monthly fee for them)
// 2. removes their profile photo, card images and uploaded logos
// 3. deletes the user, which deletes every row of theirs (all tables cascade)
const CONFIRM_PHRASE = 'i want to delete my account';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const typed = String(body?.confirm || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (typed !== CONFIRM_PHRASE) return json({ error: 'Confirmation missing' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Disconnect banks at Plaid
    const { data: items } = await admin.rpc('get_user_plaid_items', { p_user_id: user.id });
    for (const item of (items || [])) {
      try {
        await plaidRequest('/item/remove', { access_token: item.access_token });
      } catch (e) { console.error('item/remove failed', e); }
    }

    // 2. Photos, card images and uploaded logos (stored under a folder named with the user id)
    for (const bucket of ['avatars', 'card-designs', 'logos']) {
      const { data: files } = await admin.storage.from(bucket).list(user.id, { limit: 1000 });
      if (files && files.length) await admin.storage.from(bucket).remove(files.map((f) => `${user.id}/${f.name}`));
    }

    // 3. The account itself; every table of theirs cascades from here
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) { console.error('deleteUser failed', error); return json({ error: 'Could not delete the account' }, 500); }

    return json({ deleted: true });
  } catch (e) {
    console.error('delete-account error', e);
    return json({ error: 'Could not delete the account' }, 500);
  }
});

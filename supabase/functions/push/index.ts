import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendToUser, flushQueues, vapidConfig } from "./notify.js";
import { sendBillReminders } from "./bills.js";

// push: { action: 'test' }  signed-in user -> "Notifications are on" to this device (or all)
//       { action: 'flush' } cron (x-cron-secret) -> send what quiet hours held
//       { action: 'bills' } cron (x-cron-secret) -> card and loan payment due reminders
//                           (dry: true reports what would go out; asOf: 'YYYY-MM-DD' with dry)
//       { action: 'key' }   anyone -> the public key the app subscribes with
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://alenjo.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'key') return json({ key: (await vapidConfig(admin)).publicKey });

    if (body.action === 'flush') {
      const cfg = await vapidConfig(admin);
      if (!same(req.headers.get('x-cron-secret') || '', cfg.cronSecret)) return json({ error: 'Unauthorized' }, 401);
      return json(await flushQueues(admin));
    }

    if (body.action === 'bills') {
      const cfg = await vapidConfig(admin);
      if (!same(req.headers.get('x-cron-secret') || '', cfg.cronSecret)) return json({ error: 'Unauthorized' }, 401);
      const dry = body.dry === true;
      const asOf = dry && typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : null;
      return json(await sendBillReminders(admin, { dry, asOf }));
    }

    // Everything else needs the signed-in user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    if (body.action === 'test') {
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint : undefined;
      const r = await sendToUser(admin, user.id, [{ title: 'Notifications are on', body: 'You’ll hear from Alenjo when new purchases and deposits show up, and before payments are due.', tag: 'test', url: '/?tab=settings' }], endpoint);
      return json(r);
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('push error', e);
    return json({ error: 'Internal error' }, 500);
  }
});

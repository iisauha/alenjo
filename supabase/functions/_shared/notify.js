// Turns new transactions into notifications: applies your settings, makes
// sure each transaction notifies once, holds them during quiet hours, and
// sends to every device where you allowed notifications.
import { sendPush } from './webpush.js';

const DEFAULTS = { purchases: true, deposits: true, min_amount: 0, quiet: true, quiet_start: 22, quiet_end: 7, tz: 'America/New_York' };

let vapidCache = null;
export async function vapidConfig(admin) {
  if (vapidCache) return vapidCache;
  const { data, error } = await admin.rpc('get_push_config');
  if (error || !data) throw new Error('push config unavailable');
  const m = Object.fromEntries(data.map((r) => [r.name, r.secret]));
  vapidCache = { privateJwk: JSON.parse(m.vapid_private_jwk), publicKey: m.vapid_public_key, subject: 'https://alenjo.com', cronSecret: m.push_cron_secret };
  return vapidCache;
}

export async function settingsFor(admin, userId) {
  const { data } = await admin.from('notification_settings').select('*').eq('user_id', userId).maybeSingle();
  return { ...DEFAULTS, ...(data || {}) };
}

function localHour(tz) {
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); }
  catch (_) { return new Date().getUTCHours(); }
}
export function inQuietHours(s) {
  if (!s.quiet || s.quiet_start === s.quiet_end) return false;
  const h = localHour(s.tz);
  return s.quiet_start > s.quiet_end ? (h >= s.quiet_start || h < s.quiet_end) : (h >= s.quiet_start && h < s.quiet_end);
}

const money = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Plaid amounts: positive = money out, negative = money in
const isDeposit = (t) => t.amount < 0;
function line(t) { return (isDeposit(t) ? '+' : '') + money(t.amount); }

// One notification per transaction for one or two; grouped for three or more.
export function buildMessages(items, overnight) {
  if (!items.length) return [];
  const url = '/?tab=transactions';
  if (items.length <= 2 && !overnight) {
    return items.map((t) => ({
      title: t.name,
      body: line(t) + ' · ' + t.account + (t.pending ? ' · Pending' : ''),
      tag: 'tx-' + t.id, url,
    }));
  }
  const buys = items.filter((t) => !isDeposit(t)), ins = items.filter(isDeposit);
  const spent = buys.reduce((s, t) => s + t.amount, 0);
  let title = buys.length && !ins.length ? buys.length + ' new purchase' + (buys.length === 1 ? '' : 's') + ' · ' + money(spent)
    : ins.length && !buys.length ? ins.length + ' new deposit' + (ins.length === 1 ? '' : 's') + ' · +' + money(ins.reduce((s, t) => s + t.amount, 0))
    : items.length + ' new transactions';
  if (overnight) title = 'Overnight · ' + title;
  const shown = items.slice(0, 3).map((t) => t.name + ' ' + line(t)).join(', ');
  return [{ title, body: shown + (items.length > 3 ? ' + ' + (items.length - 3) + ' more' : ''), tag: 'tx-group-' + Date.now(), url }];
}

// SA-011: only ever POST to real browser push services
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
export function isPushService(endpoint) {
  try {
    const u = new URL(endpoint);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.port && (PUSH_HOSTS.includes(h) || h.endsWith('.push.apple.com') || h.endsWith('.notify.windows.com'));
  } catch (_) { return false; }
}

export async function sendToUser(admin, userId, messages, onlyEndpoint) {
  if (!messages.length) return { sent: 0, devices: 0 };
  const vapid = await vapidConfig(admin);
  let q = admin.from('push_devices').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  if (onlyEndpoint) q = q.eq('endpoint', onlyEndpoint);
  const { data: devices } = await q;
  let sent = 0;
  for (const d of devices || []) {
    if (!isPushService(d.endpoint)) { console.error('skipped non-push endpoint'); continue; }
    for (const m of messages) {
      try {
        const status = await sendPush(d, m, vapid);
        if (status === 404 || status === 410) { await admin.from('push_devices').delete().eq('id', d.id); break; }   // device gone
        if (status >= 200 && status < 300) { sent++; await admin.from('push_devices').update({ last_success_at: new Date().toISOString() }).eq('id', d.id); }
        else console.error('push failed', status);
      } catch (e) { console.error('push error', e); }
    }
  }
  return { sent, devices: (devices || []).length };
}

// items: [{ id, pending_id, name, amount, account, pending }]
export async function deliver(admin, userId, items) {
  if (!items.length) return { sent: 0 };
  // A posted transaction whose pending version already notified stays quiet
  const pendIds = items.map((t) => t.pending_id).filter(Boolean);
  let seenPending = new Set();
  if (pendIds.length) {
    const { data } = await admin.from('notified_transactions').select('transaction_id').in('transaction_id', pendIds);
    seenPending = new Set((data || []).map((r) => r.transaction_id));
  }
  // Claim each id once; if another sync already claimed it, skip it
  const { data: claimed } = await admin.from('notified_transactions')
    .upsert(items.map((t) => ({ transaction_id: t.id, user_id: userId })), { onConflict: 'transaction_id', ignoreDuplicates: true })
    .select('transaction_id');
  const fresh = new Set((claimed || []).map((r) => r.transaction_id));
  const s = await settingsFor(admin, userId);
  const due = items.filter((t) => fresh.has(t.id) && !(t.pending_id && seenPending.has(t.pending_id)))
    .filter((t) => (isDeposit(t) ? s.deposits : s.purchases) && Math.abs(t.amount) >= Number(s.min_amount || 0));
  if (!due.length) return { sent: 0 };
  if (inQuietHours(s)) {
    await admin.from('push_queue').insert(due.map((t) => ({ user_id: userId, item: t })));
    return { queued: due.length };
  }
  return sendToUser(admin, userId, buildMessages(due, false));
}

// Morning: send what was held overnight as one summary
export async function flushQueues(admin) {
  const { data: rows } = await admin.from('push_queue').select('id, user_id, item').order('created_at');
  const byUser = {};
  for (const r of rows || []) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
  let users = 0;
  for (const uid of Object.keys(byUser)) {
    const s = await settingsFor(admin, uid);
    if (inQuietHours(s)) continue;
    const list = byUser[uid];
    await admin.from('push_queue').delete().in('id', list.map((r) => r.id));
    await sendToUser(admin, uid, buildMessages(list.map((r) => r.item), true));
    users++;
  }
  return { users };
}

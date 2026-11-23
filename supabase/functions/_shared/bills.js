// Payment due reminders for credit cards and loans: one two days before the
// due date and one on the day, sent in the morning (9 AM your time, after
// quiet hours). Due dates and amounts come from Plaid Liabilities, which the
// sync already saves. A bill that is paid, or that has nothing owed, stays quiet.
import { settingsFor, inQuietHours, sendToUser } from './notify.js';

export const SEND_HOUR = 9;
const DAY = 86400000;

// Student loan statuses with no payment to make
const NO_PAYMENT = new Set(['deferment', 'forbearance', 'in grace', 'in school', 'in military', 'paid in full',
  'cancelled', 'discharged', 'consolidated', 'transferred', 'refunded', 'charged off', 'claim', 'not fully disbursed']);
// What a payment looks like on a card or loan account (refunds use the store's category)
const PAYMENT_CATS = new Set(['LOAN_PAYMENTS', 'TRANSFER_IN']);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const money = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY);
const addDays = (d, n) => new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10);
const shortDate = (d) => new Date(toUtc(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function localToday(tz, now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch (_) { return now.toISOString().slice(0, 10); }
}
export function localHour(tz, now = new Date()) {
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now)); }
  catch (_) { return now.getUTCHours(); }
}

// row: one card or loan (see get_bill_reminder_rows). payments: that account's
// money-in transactions [{ date, amount, category }]. today: 'YYYY-MM-DD' in the user's time zone.
// Returns { kind: 'soon' | 'due', title, body, ... } or { skip: reason }.
export function reminderFor(row, payments, today) {
  const due = row.next_payment_due_date;
  if (!due) return { skip: 'no due date' };
  const days = daysBetween(today, due);
  const kind = days === 0 ? 'due' : days === 1 || days === 2 ? 'soon' : null;
  if (!kind) return { skip: days < 0 ? 'due date passed' : 'due in ' + days + ' days' };
  if (row.is_hidden || row.closed_at) return { skip: 'hidden or closed' };

  const isCard = row.liability_type === 'credit';
  // Payments made for this bill: after the statement for a card, the last few weeks for a loan.
  // Cards always give at least 21 days between statement and due date.
  const since = isCard ? (row.last_statement_issue_date || addDays(due, -21)) : addDays(due, -28);
  const fromTx = (payments || [])
    .filter((p) => p.date > since && p.date <= today && Number(p.amount) < 0 && PAYMENT_CATS.has(p.category))
    .reduce((s, p) => s - Number(p.amount), 0);
  const fromPlaid = row.last_payment_date && row.last_payment_date > since ? (num(row.last_payment_amount) || 0) : 0;
  const paid = Math.max(fromTx, fromPlaid);

  let body;
  if (isCard) {
    const stmt = num(row.last_statement_balance) || 0, min = num(row.minimum_payment_amount) || 0;
    if (stmt <= 0 && min <= 0) return { skip: 'nothing owed' };
    const left = Math.max(stmt, min) - paid;
    if (left <= 0.005) return { skip: 'paid' };
    body = paid > 0 ? money(left) + ' left of ' + money(stmt) + ' statement' : 'Statement balance ' + money(stmt);
    if (min > 0) body += paid >= min - 0.005 ? ' · Minimum paid' : ' · Minimum ' + money(min - paid);
  } else {
    if (row.loan_status && NO_PAYMENT.has(String(row.loan_status).replace(/_/g, ' ').toLowerCase())) return { skip: 'no payment (' + row.loan_status + ')' };
    const amt = num(row.minimum_payment_amount) ?? num(row.next_monthly_payment);
    if (amt === 0) return { skip: 'nothing owed' };
    if (amt && paid >= amt - 0.005) return { skip: 'paid' };
    body = amt ? 'Payment ' + money(amt - paid) : 'Payment due';
  }
  const label = row.label || (isCard ? 'Card' : 'Loan');
  const when = kind === 'due' ? 'today' : days === 1 ? 'tomorrow' : 'in 2 days';
  if (kind === 'soon') body += ' · Due ' + shortDate(due);
  return { kind, days, title: label + ' payment due ' + when, body, tag: 'bill-' + row.liability_id + '-' + due, url: '/?tab=snapshot' };
}

// Cron (hourly): send what's due for everyone whose morning it is.
// dry: report what would be sent without sending or recording anything.
// asOf ('YYYY-MM-DD', dry only): pretend it's that day, to check upcoming reminders.
export async function sendBillReminders(admin, { dry = false, asOf = null, now = new Date() } = {}) {
  const today0 = asOf || now.toISOString().slice(0, 10);
  const { data: rows, error } = await admin.rpc('get_bill_reminder_rows', { p_from: addDays(today0, -2), p_to: addDays(today0, 4) });
  if (error) throw new Error('bill rows unavailable: ' + error.message);
  const byUser = {};
  for (const r of rows || []) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);

  const report = [];
  let sent = 0;
  for (const uid of Object.keys(byUser)) {
    const s = await settingsFor(admin, uid);
    const today = asOf || localToday(s.tz, now);
    if (!dry) {
      if (!s.bills) continue;
      if (localHour(s.tz, now) < SEND_HOUR || inQuietHours(s)) continue;
    }
    const list = byUser[uid];
    const ids = list.map((r) => r.plaid_account_id).filter(Boolean);
    let payments = [];
    if (ids.length) {
      const { data } = await admin.from('synced_transactions').select('plaid_account_id, date, amount, category')
        .eq('user_id', uid).in('plaid_account_id', ids).lt('amount', 0).is('removed_at', null).gte('date', addDays(today, -60));
      payments = data || [];
    }
    const due = [];
    for (const r of list) {
      const rem = reminderFor(r, payments.filter((p) => p.plaid_account_id === r.plaid_account_id), today);
      if (dry) report.push({ account: r.label, due: r.next_payment_due_date, ...(rem.skip ? { skip: rem.skip } : { kind: rem.kind, title: rem.title, body: rem.body }) });
      else if (rem.kind) due.push({ r, rem });
    }
    if (dry || !due.length) continue;

    // Claim each reminder once; another run that already claimed it skips it
    const { data: claimed } = await admin.from('bill_reminders_sent')
      .upsert(due.map(({ r, rem }) => ({ liability_id: r.liability_id, due_date: r.next_payment_due_date, kind: rem.kind, user_id: uid })),
        { onConflict: 'liability_id,due_date,kind', ignoreDuplicates: true })
      .select('liability_id, kind');
    const fresh = new Set((claimed || []).map((c) => c.liability_id + ':' + c.kind));
    const go = due.filter(({ r, rem }) => fresh.has(r.liability_id + ':' + rem.kind));
    if (!go.length) continue;
    const res = await sendToUser(admin, uid, go.map(({ rem }) => ({ title: rem.title, body: rem.body, tag: rem.tag, url: rem.url })));
    if (!res.sent) {
      // Nothing reached a device: let the next hourly run try again
      for (const { r, rem } of go) {
        await admin.from('bill_reminders_sent').delete().eq('liability_id', r.liability_id).eq('due_date', r.next_payment_due_date).eq('kind', rem.kind);
      }
    }
    sent += res.sent;
  }
  return dry ? { dry: true, asOf: asOf || null, reminders: report } : { sent };
}

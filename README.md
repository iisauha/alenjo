# Alenjo

A personal finance app for iPhone, installed from Safari as a Home Screen app (PWA) at
[alenjo.com](https://alenjo.com). It shows balances, transactions, budgets, card and loan
due dates, and investments from banks connected through Plaid.

It does what other finance apps skip: every transaction is yours to correct. You can
recategorize, rename, change the logo, split, adjust, mark as reimbursed, ignore or move
it to another month, and each change applies to that one transaction only. No ads, no
upsells, no guessing.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| App | `index.html`, `app.js`, `style.css` | The whole app, plain JavaScript (no build step). Served by GitHub Pages. |
| Service worker | `sw.js` | Notifications only (no offline caching). |
| Excel export | `xlsx-export.js` | Builds the .xlsx (table, summary with live formulas, charts). Loaded on demand. |
| Info pages | `privacy/`, `security/` | Shown inside the app in a sandboxed frame. |
| Vendored libraries | `vendor/` | supabase-js and Chart.js, pinned copies. `vendor/package.json` lists them so Dependabot can flag updates (not installed with npm). |
| Loaded from the web | | Plaid Link, Google Fonts (Inter, Newsreader), and the photo cropper (cropperjs from jsDelivr, pinned version with an integrity check, loaded only when you crop). |
| Tools | `release.sh`, `tools/` | Version stamp and Content-Security-Policy (`csp.py`), function deploys, migration download. |
| Checks | `.github/` | CodeQL security scan on pushes and pull requests into main, plus weekly; Dependabot for `vendor/` and the workflow actions. |
| Database | Supabase Postgres | Row-level security on every table; two-step sign-in enforced by the database (`mfa_satisfied()`). Bank tokens and account details are encrypted. |
| Server functions | `supabase/functions/` | Supabase Edge Functions (Deno). See below. |
| Bank data | Plaid | Transactions, balances, liabilities, investment holdings. Balances are shown exactly as Plaid sends them (no adjusting for rounding). |

### Server functions

| Function | Called by | Purpose |
|---|---|---|
| `plaid-link` | app | Connect a bank (Link token, token exchange) |
| `sync-transactions` | app, `plaid-webhook` | Pull new transactions, balances, holdings, liabilities |
| `plaid-webhook` | Plaid | Signed webhooks; syncs and sends notifications |
| `push` | app, cron | Test push, quiet-hours flush, payment due reminders |
| `cleanup-items` | app | Remove a bank connection |
| `delete-account` | app | Delete your account and everything in it |
| `mfa-recovery` | app | Backup codes and email recovery for two-step sign-in |
| `validate-beta-code` | app | Sign-up invite code (rate limited) |
| `cache-logos`, `logo-search`, `resolve-logos` | app | Store and bank logos (logo.dev key stays on the server) |

Shared code lives in `supabase/functions/_shared/`: `plaid.js` (the only way the server talks to
Plaid, with the billing guard below), `notify.js` (who gets notified, quiet hours, retries),
`webpush.js` (Web Push encryption and VAPID) and `bills.js` (payment due reminders).

Scheduled jobs (pg_cron): `push-flush-quiet-hours` every 15 minutes, `bill-reminders` hourly.

Function secrets (set in Supabase, never in this repo): `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`PLAID_ENV`, `PLAID_REDIRECT_URI`, `LOGO_DEV_SECRET`, `BETA_CODE`. Supabase provides `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself. The push keys (VAPID) and the cron
secret live in Supabase Vault.

### Plaid costs

Plaid bills per connected bank, per product, each calendar month. `plaid.js` refuses any endpoint
that is billed per call or would add a product (`/accounts/balance/get`, `/transactions/refresh`,
`/investments/refresh`, `/investments/transactions/get`, Auth, Identity, Enrich and so on), so the
app only ever uses Transactions, Liabilities and Investments Holdings plus Plaid's free calls.
Reconnecting (update mode) and Manage are free; removing a bank and adding it again bills twice that
month. Settings → Billing explains this in the app.

### Notifications

Plaid webhook → `sync-transactions` → `notify.js`. Everything that shows up in Activity
notifies (ignoring a transaction only hides it from totals), including money in that Plaid files
as a transfer, such as a Venmo or Zelle deposit. Settings has switches for purchases, deposits,
card payments, transfers between your own accounts, a minimum amount, payment due reminders and
quiet hours (10 PM to 7 AM). What arrives in quiet hours waits for one "Overnight" summary when
they end. A send that doesn't reach the phone is retried every 15 minutes for up to a day.

Payment due reminders (`bills.js`) cover credit cards and loans, using the due dates and amounts
from Plaid Liabilities: one two days before the due date and one on the day, at 9 AM your time.
A bill that is already paid, or has nothing owed, stays quiet.

### History and "counts from"

Your first connection brings in history from the month before you joined, and all of it counts.
Every account added later (a new card through Manage, another bank, a partner's accounts) is marked
`added_later` by a database trigger, and Alenjo asks where it should start counting:

- **From today** (recommended after your first 30 days)
- **From the start of this month**
- **All history** (recommended in your first 30 days, while you're still setting up; otherwise it
  carries a warning because it changes months you've already budgeted)

Purchases before the chosen day are kept but hidden everywhere (Activity, totals, budgets, charts,
export). Nothing ever goes back further than the month before you joined, or Plaid's two years.
Until you answer, the recommended choice applies and the question comes back next time. Reconnecting
a bank keeps each account's choice.

### Show-off mode

Settings → Show-off mode swaps in made-up names, accounts and transactions (new each time) so
the app can be shown to someone. It is a layer around the Supabase client in `app.js`: reads of
personal data come from fake data built on the phone, every write and server function call is
dropped, and local copies (name, photo, settings summaries) go to a temporary store. It only
lives in memory: closing the app, auto-lock or sign-out ends it, and turning it off restarts
the app (Face ID before real numbers come back).

## Making changes

**App:** edit, then run `./release.sh` before committing. It stamps a new version (installed
copies update themselves) and refreshes the Content-Security-Policy hashes in `index.html`.

**Server function:** `./tools/deploy-function.sh <name>` (needs the Supabase CLI). It copies
the shared files the function imports next to it, then deploys.

**Database:** add a file to `supabase/migrations/` named `<UTC timestamp>_<name>.sql` and
apply it. File names match the versions recorded in the live project.

## Repo status

`supabase/migrations/` holds the changes since November 21, 2026, with comments. The earlier
history (April to November 2026) is recorded in the live project; run
`./tools/pull-migrations.sh` once with the Supabase CLI to download it here, then commit.

Seven old functions (`ai-chat`, `backfill-institutions`, `item-products-check`,
`refresh-balances`, `remove-orphan-items`, `resync-once`, `test-plaid-env`) are still deployed as
stubs that do nothing (410 Gone) and aren't in this repo. Delete them from the Supabase dashboard
to remove them entirely.

The security scan is the workflow in `.github/workflows/security-scan.yml`. GitHub's built-in
CodeQL "default setup" must stay off (Settings → Advanced Security), or GitHub rejects this
workflow's results and the scan fails.

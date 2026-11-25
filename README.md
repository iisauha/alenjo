# Alenjo

A personal finance app for iPhone, installed from Safari as a Home Screen app (PWA) at
[alenjo.com](https://alenjo.com). It shows balances, transactions, budgets, card and loan
due dates, and investments from banks connected through Plaid.

It does what other finance apps skip: every transaction is yours to correct. You can
recategorize, rename, change the logo, split, adjust, mark as reimbursed, ignore or move
it to another month, and each change applies to that one transaction only. No ads, no
upsells, no guessing.

Design: colors, type, components and the design philosophy are in [DESIGN.md](DESIGN.md).

## Contents

[How it fits together](#how-it-fits-together) · [Repo layout](#repo-layout) ·
[Inside app.js](#inside-appjs) · [Database](#database) · [Server functions](#server-functions) ·
[Plaid costs](#plaid-costs) · [Notifications](#notifications) · [Sign-in and security](#sign-in-and-security) ·
[History and "counts from"](#history-and-counts-from) · [Show-off mode](#show-off-mode) ·
[Making changes](#making-changes) · [Repo status](#repo-status)

## How it fits together

| Part | Where | What it does |
|---|---|---|
| App | `index.html`, `app.js`, `style.css` | The whole app, plain JavaScript (no build step). Served by GitHub Pages from `main` at alenjo.com (`CNAME`). |
| Service worker | `sw.js` | Notifications only (no offline caching, so it never serves an old version). |
| Excel export | `xlsx-export.js` | Builds the .xlsx (table, summary with live formulas, charts). Loaded on demand. |
| Vendored libraries | `vendor/` | supabase-js and Chart.js, pinned copies. `vendor/package.json` lists them so Dependabot can flag updates (not installed with npm). |
| Loaded from the web | | Plaid Link, Google Fonts (Inter, Newsreader), and the photo cropper (cropperjs from jsDelivr, pinned version with an integrity check, loaded only when you crop). |
| Database | Supabase Postgres | Row-level security on every table; two-step sign-in enforced by the database (`mfa_satisfied()`). Bank tokens and account details are encrypted. |
| Server functions | `supabase/functions/` | Supabase Edge Functions (Deno). See below. |
| Bank data | Plaid | Transactions, balances, liabilities, investment holdings. Balances are shown exactly as Plaid sends them (no adjusting for rounding). |
| Logos | logo.dev | Store and bank logos. The publishable key is in `app.js`; the secret key stays on the server. |

## Repo layout

| Path | What it is |
|---|---|
| `index.html` | Every screen and popup, the Content-Security-Policy, and small inline scripts (theme before first paint, version, error fallback). |
| `app.js` | All app code in one file, wrapped in one function. See [Inside app.js](#inside-appjs). |
| `style.css` | All styles. Theme colors are CSS variables at the top (`:root` and `:root[data-theme="dark"]`). |
| `xlsx-export.js`, `sw.js` | Excel export and the notification service worker. |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png`, `favicon.ico`, `alenjo*.png` | Home Screen app details, icons and the logo. |
| `privacy/`, `security/` | Public copies of the Privacy and Security pages, linked from the sign-in screen. |
| `version.json` | Current version. Installed apps check it and update themselves. |
| `release.sh` | Stamps a new version and refreshes the CSP. Run before every app commit. |
| `tools/csp.py` | Writes the CSP into `index.html` (inline scripts allowed only by their sha256). |
| `tools/deploy-function.sh` | Deploys one server function with the shared files it imports. |
| `tools/pull-migrations.sh` | Downloads the older migrations from the live project (see Repo status). |
| `supabase/functions/` | Server functions; shared code in `_shared/`. |
| `supabase/migrations/` | Database changes, one commented SQL file each. |
| `.github/` | CodeQL security scan (`workflows/security-scan.yml`) and Dependabot (`dependabot.yml`). |
| `DESIGN.md`, `CLAUDE.md`, `.impeccable.md` | Design system, notes for Claude, and the design brief the impeccable design tool reads. |

## Inside app.js

One file, split by `// ====` section headers, in this order:

| Section | What it does |
|---|---|
| Supabase init, Show-off mode | The Supabase client, and the fake-data layer around it (see Show-off mode). |
| Beta gate + signup, Auth, Password reset | Invite code, sign-up, sign-in with password or Face ID, two-step code, reset link. |
| Auto-update | Compares `version.json` with the running version and reloads when it changes. |
| Face ID, Resume, Auto logout | Passkeys, the lock screen when you come back, and locking after you step away. |
| Screens & tabs, Settings pages | Home, Activity and Settings tabs; Settings is a short list that opens one page per row. |
| Private photos, Pictures kept with the app's data | Signed URLs for your photo and card images; logos and art cached in `image_cache`. |
| Profile, Card designs, Balance toggle | Name and photo, card art (crop and clean up), long-press to hide amounts. |
| Settings → Accounts, Appearance, Notifications | Account order and totals, Light / Dark / Adaptive, Web Push setup and switches. |
| Plaid Link, Load accounts, Bank connection health | Connecting and reconnecting banks, loading accounts, banks that need you to sign in again. |
| Logo.dev, Balance helpers, Render accounts | Logos, which balance to show, and the Home cards. |
| Home insights, Investment holdings | 30-day trend, this month's spending, budgets, holdings and loans. |
| Transactions | Activity: month view, chart, category pills, list, search, export. |
| Add manual transaction, Transaction action sheet | Adding one by hand, and the popup where you edit a single transaction. |
| Utils | Dates, money formatting and small helpers. |

## Database

Supabase Postgres, project `itkufrockebnlzcroigc`. Every table has row-level security, and reads
and writes need a session that passed two-step sign-in. The main tables:

| Table | Holds |
|---|---|
| `profiles` | Your name, photo and tab order. |
| `plaid_items` | One row per connected bank: encrypted Plaid token, sync cursor, errors and notices. |
| `plaid_link_sessions` | Plaid Link sessions in progress (connect or reconnect). |
| `accounts` | Each account: name, number and balances (encrypted, as Plaid sent them), your nickname, order, totals choice, card design, sign-up bonus and "counts from". |
| `synced_transactions` | Transactions from Plaid (kept when the bank removes one, marked `removed_at`). |
| `transaction_actions` | Your edits to one transaction: category, name, logo, amount, date, split, reimbursed, ignored, note. |
| `user_category_map` | Your renamed, deleted and added categories. |
| `category_budgets` | Monthly budgets per category, money out and money in. |
| `liabilities` | Card and loan details from Plaid Liabilities (due dates, minimums, rates). |
| `investment_holdings`, `investment_securities` | Holdings and the securities they refer to. |
| `card_designs`, `custom_logos`, `image_cache` | Card art, logos you uploaded, and cached pictures. |
| `notification_settings`, `push_devices`, `push_queue`, `notified_transactions`, `bill_reminders_sent` | Notification switches, devices, held messages, and what was already sent. |
| `mfa_backup_codes`, `mfa_recovery_log` | Two-step sign-in backup codes (hashed) and the recovery log. |
| `signup_tickets`, `beta_code_attempts` | Sign-up with an invite code, and its rate limit. |
| `info_pages` | Privacy, Security and FAQ pages shown inside the app (signed in only). |

Two tables are no longer used by any code: `merchant_logos` (store-wide logo picks, replaced by
per-transaction logos on November 24, 2026) and `mfa_recovery_codes` (empty, replaced by
`mfa_backup_codes`). They are left in place until someone decides to drop them.

## Server functions

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

Scheduled jobs (pg_cron) call `push` with a secret from Vault: `push-flush-quiet-hours` every
15 minutes and `bill-reminders` every hour (each person's reminders go out at 9 AM their time).

Function secrets (set in Supabase, never in this repo): `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`PLAID_ENV`, `PLAID_REDIRECT_URI`, `LOGO_DEV_SECRET`, `BETA_CODE`. Supabase provides `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself. The push keys (VAPID) and the cron
secret live in Supabase Vault.

## Plaid costs

Plaid bills per connected bank, per product, each calendar month. `plaid.js` refuses any endpoint
that is billed per call or would add a product (`/accounts/balance/get`, `/transactions/refresh`,
`/investments/refresh`, `/investments/transactions/get`, Auth, Identity, Enrich and so on), so the
app only ever uses Transactions, Liabilities and Investments Holdings plus Plaid's free calls.
Reconnecting (update mode) and Manage are free; removing a bank and adding it again bills twice that
month. Settings → Billing explains this in the app.

## Notifications

Plaid webhook → `sync-transactions` → `notify.js`. Everything that shows up in Activity
notifies (ignoring a transaction only hides it from totals), including money in that Plaid files
as a transfer, such as a Venmo or Zelle deposit. Settings has switches for purchases, deposits,
card payments, transfers between your own accounts, a minimum amount, payment due reminders and
quiet hours (10 PM to 7 AM). What arrives in quiet hours waits for one "Overnight" summary when
they end. A send that doesn't reach the phone is retried every 15 minutes for up to a day.

Payment due reminders (`bills.js`) cover credit cards and loans, using the due dates and amounts
from Plaid Liabilities: one two days before the due date and one on the day, at 9 AM your time.
A bill that is already paid, or has nothing owed, stays quiet.

## Sign-in and security

- **Accounts:** new accounts need an invite code (`validate-beta-code`, rate limited). Sign in
  with email and password or with Face ID (passkeys, which only work on alenjo.com).
- **Two-step sign-in:** a code from an authenticator app is required, and the database itself
  refuses data to a session that skipped it (`mfa_satisfied()`, session level `aal2`). You can
  trust a device for 30 days. Backup codes and an email recovery live in `mfa-recovery`.
- **Lock:** Alenjo locks after you step away (1, 5 or 15 minutes, set in Settings) and asks for
  Face ID to come back; without Face ID on this device it reloads to the sign-in screen. Long-press the Available number to hide every amount.
- **Content-Security-Policy:** set in `index.html` by `tools/csp.py`. Scripts load only from this
  site, Plaid and jsDelivr (the cropper), and inline scripts only by their sha256.
- **Info pages:** Privacy, Security and FAQ inside the app come from the `info_pages` table
  (gzip + base64, signed in only). `privacy/` and `security/` are the public copies linked from
  the sign-in screen, so a change to either page goes in both places.

## History and "counts from"

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

## Show-off mode

Settings → Show-off mode swaps in made-up names, accounts and transactions (new each time) so
the app can be shown to someone. It is a layer around the Supabase client in `app.js`: reads of
personal data come from fake data built on the phone, every write and server function call is
dropped, and local copies (name, photo, settings summaries) go to a temporary store. It only
lives in memory: closing the app, auto-lock or sign-out ends it, and turning it off restarts
the app (Face ID before real numbers come back).

## Making changes

**Try it:** there is no build step. Serve the folder with any static server (for example
`python3 -m http.server 8000`) and open it. It talks to the live Supabase project, so sign in
with a real account; Face ID won't work away from alenjo.com.

**Check it:** there's no linter or test suite. Run `node --check app.js` (and any other file you
touched). CodeQL runs on every pull request into main.

**App:** edit, then run `./release.sh` before committing. It stamps a new version in
`index.html` and `version.json` (installed copies update themselves) and refreshes the
Content-Security-Policy hashes. Merging into `main` publishes it: GitHub Pages deploys
alenjo.com within a few minutes.

**Server function:** `./tools/deploy-function.sh <name>` (needs the Supabase CLI). It copies
the shared files the function imports next to it, then deploys with `--no-verify-jwt`, because
every function checks the sign-in (or the Plaid signature, or the cron secret) itself. Merging
doesn't deploy functions; deploy the ones you changed.

**Database:** add a file to `supabase/migrations/` named `<UTC timestamp>_<name>.sql` and
apply it. File names match the versions recorded in the live project. Never put secrets in a
migration; they go in Supabase function secrets or Vault.

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

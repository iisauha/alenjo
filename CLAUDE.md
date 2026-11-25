## Design Context

The short version. [DESIGN.md](DESIGN.md) is the full design system (every color, size, component and the
writing rules) and wins if the two disagree.

### Users
Alenjo is a personal finance manager aimed at a broader consumer audience. Users check it on their phones, often quickly and on the go, to see balances, review transactions, track recurring charges, and understand spending. They want clarity about their money without friction or noise.

### Brand Personality
**Clean, friendly, simple.** Alenjo should feel like a trusted, well-made tool: not a bank, not a toy. Confident without being cold. Approachable without being juvenile. The interface should get out of the way and let the numbers speak.

### Aesthetic Direction
- **Visual tone**: Robinhood-style minimalism (big numbers, restrained color, generous space) with Apple Wallet's native polish (system-like feel, clean card metaphors, tactile confidence), in a warm, paper-like palette.
- **Theme**: Light, Dark or Adaptive (follows the phone, the default) in Settings → Appearance. Light is a warm cream background (`--bg` #E6E2D8, cards #EEEAE1) with dark warm text (#33312C). A warm dark theme (`:root[data-theme="dark"]`, background #1C1B17) mirrors it. Always use the CSS variables in `style.css`, never hard-coded colors.
- **Typography**: Newsreader (serif, `--serif`) for page titles, names and the big amounts; Inter for everything else. Tabular-nums for financial figures.
- **Color**: Forest green accent (`--accent` #2E6B4D; #86C6A2 in dark) used sparingly: actions, links, switches. Semantic `--success` / `--danger` for money in / problems. Category colors only in charts and legends.
- **Anti-references**: No ad-cluttered layouts (Mint/NerdWallet). No corporate blandness (generic banking apps). No cartoon-ish playfulness (too many colors, illustrations, mascots). No promotions or upsells in the UI.

### Design Principles
1. **Numbers first** Financial data is the content. Typography, spacing, and hierarchy should make balances and amounts instantly scannable. Decoration is secondary.
2. **Quiet confidence** The UI should feel premium through restraint, not through effects. Subtle borders, muted secondary text, and generous whitespace over gradients, glows, or heavy shadows.
3. **Mobile-native feel** Every interaction should feel like it belongs on iOS. Proper safe areas, touch targets (44px minimum), smooth transitions, and respect for system conventions.
4. **Information density without clutter** Show what matters, hide what doesn't. Progressive disclosure over overwhelming dashboards. One clear action per context.
5. **No noise** No badges, banners, promotions, or gamification. The app exists to show your money, not to sell you something.
6. **You're in control** Never guess on the user's behalf. Edits to a transaction (category, name, logo, amount, date) apply to that one transaction only. Nothing is silently hidden: ignoring only takes a transaction out of totals.

## Working on the code

Start with README.md: it maps the repo, the sections of `app.js`, the database tables, the
server functions and how notifications, Plaid costs and sign-in work.

### Shipping
- No build step, linter or test suite. Check syntax with `node --check app.js` (and any other file you touched).
- Run `./release.sh` before committing app changes: new version (installed apps update themselves) and fresh CSP hashes. Any edit to an inline `<script>` in `index.html` needs it too, or the browser blocks that script.
- Merging into `main` publishes alenjo.com through GitHub Pages. Server functions don't deploy on merge: run `./tools/deploy-function.sh <name>` for each one you changed (shared code lives in `supabase/functions/_shared/` and is copied in at deploy time).
- New database changes go in `supabase/migrations/<UTC timestamp>_<name>.sql`, with a comment saying why. Never drop a table, column or data without the owner's say-so.
- Keep README.md and DESIGN.md true: if a change makes either one wrong, fix it in the same pull request.
- Keep GitHub's built-in CodeQL default setup off; the repo's own `.github/workflows/security-scan.yml` is the scan.

### Rules the code depends on
- Show balances and amounts exactly as Plaid sends them. Don't recalculate to fix rounding (Robinhood and Amex send whole dollars).
- Every Plaid call goes through `plaidRequest` in `_shared/plaid.js`. Don't add an endpoint to its allow list that Plaid bills per call or that adds a product (see README, Plaid costs).
- An edit to a transaction (category, name, logo, amount, date) is saved in `transaction_actions` for that one transaction only.
- Talk to Supabase through `sb` (and server functions through `fetch`), never a second client for data: Show-off mode wraps both to serve fake data and drop writes.
- Colors come from the CSS variables in `style.css`, never hex values in new code.
- No secrets in the repo. The Supabase anon key, the VAPID public key and the logo.dev publishable key in `app.js` are public by design; everything else is a function secret or in Vault.

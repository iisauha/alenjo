## Design Context

### Users
Alenjo is a personal finance manager aimed at a broader consumer audience. Users check it on their phones -- often quickly, on the go -- to see balances, review transactions, track recurring charges, and understand spending. They want clarity about their money without friction or noise.

### Brand Personality
**Clean, friendly, simple.** Alenjo should feel like a trusted, well-made tool -- not a bank, not a toy. Confident without being cold. Approachable without being juvenile. The interface should get out of the way and let the numbers speak.

### Aesthetic Direction
- **Visual tone**: Robinhood-style minimalism (big numbers, restrained color, generous space) with Apple Wallet's native polish (system-like feel, clean card metaphors, tactile confidence), in a warm, paper-like palette.
- **Theme**: Light by default: warm cream background (`--bg` #E6E2D8, cards #EEEAE1) with dark warm text (#33312C). A warm dark theme (`:root[data-theme="dark"]`, background #1C1B17) mirrors it. Always use the CSS variables in `style.css`, never hard-coded colors.
- **Typography**: Newsreader (serif, `--serif`) for page titles, names and the big amounts; Inter for everything else. Tabular-nums for financial figures.
- **Color**: Forest green accent (`--accent` #2E6B4D; #86C6A2 in dark) used sparingly: actions, links, switches. Semantic `--success` / `--danger` for money in / problems. Category colors only in charts and legends.
- **Anti-references**: No ad-cluttered layouts (Mint/NerdWallet). No corporate blandness (generic banking apps). No cartoon-ish playfulness (too many colors, illustrations, mascots). No promotions or upsells in the UI.

### Design Principles
1. **Numbers first** -- Financial data is the content. Typography, spacing, and hierarchy should make balances and amounts instantly scannable. Decoration is secondary.
2. **Quiet confidence** -- The UI should feel premium through restraint, not through effects. Subtle borders, muted secondary text, and generous whitespace over gradients, glows, or heavy shadows.
3. **Mobile-native feel** -- Every interaction should feel like it belongs on iOS. Proper safe areas, touch targets (44px minimum), smooth transitions, and respect for system conventions.
4. **Information density without clutter** -- Show what matters, hide what doesn't. Progressive disclosure over overwhelming dashboards. One clear action per context.
5. **No noise** -- No badges, banners, promotions, or gamification. The app exists to show your money, not to sell you something.
6. **You're in control** -- Never guess on the user's behalf. Edits to a transaction (category, name, logo, amount, date) apply to that one transaction only. Nothing is silently hidden: ignoring only takes a transaction out of totals.

## Working on the code

- See README.md for how the app, database and server functions fit together.
- Run `./release.sh` before committing app changes (new version + CSP hashes).
- Deploy a server function with `./tools/deploy-function.sh <name>`; shared code lives in `supabase/functions/_shared/`.
- New database changes go in `supabase/migrations/<UTC timestamp>_<name>.sql`.
- No build step, linter or test suite: check syntax with `node --check app.js` before committing.
- Show balances and amounts exactly as Plaid sends them. Don't recalculate to fix rounding (Robinhood and Amex send whole dollars).
- Plaid calls go through `plaidRequest` in `_shared/plaid.js` only; its allow list keeps per-call and new-product billing out (see README, Plaid costs).
- Keep GitHub's built-in CodeQL default setup off; the repo's own `security-scan.yml` is the scan.

# Alenjo design system

How Alenjo looks, moves and talks, and why. Every value here is read from `style.css`,
`index.html` and `app.js` as they are today, so this file describes the app, not a wish list.
If the code and this file disagree, fix one of them in the same change.

Contents: [Philosophy](#design-philosophy) · [Color](#color) · [Type](#type) ·
[Spacing, radius and size](#spacing-radius-and-size) · [Layout](#layout) · [Motion](#motion) ·
[Icons](#icons) · [Components](#components) · [Accessibility](#accessibility) ·
[Writing](#writing-for-money-screens) · [Cleanup notes](#cleanup-notes)

## Design philosophy

Alenjo is a phone app you open for a few seconds to see where your money stands. Everything
below follows from that.

1. **The numbers are the content.** Balances and amounts get the biggest type on the screen, in
   a serif (Newsreader) so they read like a printed statement. Everything around them is quiet
   Inter. Figures are always tabular so columns of amounts line up.
2. **Paper, not glass.** Warm cream backgrounds, flat surfaces, hairline dividers. No gradients,
   glows or heavy shadows. The one real shadow is under a bottom sheet, because a sheet sits on
   top of the page.
3. **Color means something.** Green is the accent (things you can tap) and means money in.
   Red is for real problems only, so money going out stays in plain text; the minus sign already
   says it. Pending is orange, not red. Category colors live in charts and legends and never use
   green.
4. **Group, don't box.** Related settings and details sit together in one rounded group on a
   lighter fill, separated by hairlines, the way iOS Settings does it. Small grey headings above
   a group say what it is. Nothing hides behind a collapsed header without a reason.
5. **Say it plainly.** Labels are short, everyday words ("Counts from", "Payments due"), not
   jargon or marketing. A hint under a row explains what a switch does before you flip it.
6. **Feels like iOS.** 44px minimum tap targets, safe areas respected, inputs at 16px or larger
   so the phone doesn't zoom, switches that look like the system ones, sheets that slide up.
7. **You're in control.** Edits to a transaction apply to that one transaction. Nothing is
   silently hidden. No badges, banners, promotions or upsells.

What Alenjo is not: an ad-filled budget site, a generic bank app, or a playful app with mascots
and confetti.

### Signature at a glance

- **Colors:** forest green `#2E6B4D` on warm paper `#E6E2D8`, ink text `#33312C`. At night: mint
  `#86C6A2` on espresso `#1C1B17`, cream text `#DCD6CA`.
- **Fonts:** Newsreader 500 for titles and big numbers, Inter for everything else.
- **Shape:** rounded groups (radius 16), round pills and switches, 52px rows, no card shadows.

## Color

Always use the CSS variables, never a hex value. There are three theme choices in Settings →
Appearance: **Light**, **Dark** and **Adaptive** (follows the phone, the default). A small inline
script in `index.html` sets `data-theme="light"` or `"dark"` on `<html>` before the page draws,
so there is no flash. Dark values live under `:root[data-theme="dark"]`.

### Surfaces

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#E6E2D8` | `#1C1B17` | Page background, header, tab bar |
| `--bg-card` | `#EEEAE1` | `#24221D` | Sign-in card, outlined pills and tiles |
| `--bg-input` | `#EEEAE1` | `#24221D` | Plain input fill outside sheets |
| `--bg-elevated` | `#DCD7CB` | `#2E2B25` | Toasts, plain tags, raised chips, active sidebar item, missing-logo circle |
| `--sheet-bg` | `#E9E5DC` | `#201E1A` | Bottom sheets and popups |
| `--group-bg` | `#F6F3EC` | `#2B2924` | Grouped lists in Settings and sheets, secondary buttons, inputs in sheets |
| `--scrim` | `rgba(28,27,25,.35)` | `rgba(0,0,0,.55)` | Behind a sheet or popup |

In both themes a group is lighter than the page, so it reads as raised without a shadow.

### Text and lines

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--text` | `#33312C` | `#DCD6CA` | Main text, amounts going out, the Home totals |
| `--text-muted` | `#67625A` | `#A0998C` | Labels, hints, dates, values on the right of a row, inactive tabs |
| `--text-dim` | `#6F6A61` | `#958E81` | Older screens; treat as muted |
| `--border` | `#D2CCBF` | `#34312A` | Outlines, ledger dividers on Home and Activity |
| `--hairline` | `--text` at 10% | same | Dividers inside a group |
| `--track` | `#D6D0C4` | `#34312A` | Switch when off, progress tracks, accounts with no color |

### Accent and status

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--accent` | `#2E6B4D` | `#86C6A2` | Primary buttons, links, switches on, active tab, focused input border, Reconnect |
| `--accent-hover` | `#26593F` | `#9AD2B3` | Primary button hover (laptop) |
| `--accent-subtle` | `#D5DFD2` | `#213028` | Selected pill, icon tiles, Face ID button, Edited tag |
| `--on-accent` | `#F1EEE6` | `#1C1B17` | Text on a green button |
| `--success` | `#2A6E4D` | `#86C6A2` | Money in, trend up |
| `--danger` | `#A23A26` | `#E8917E` | Errors, over budget, a bank that needs reconnecting, delete |
| `--warning` | `#9A6A12` | `#E0B45E` | Heads-up states |
| `--pending` | `#A95E0C` | `#EE9A45` | Pending transactions, bank alerts that are a warning rather than an error |

Tinted backgrounds are made with `color-mix()`, not new colors. A bank alert is `--danger` at 10%
over `--bg-card` with a 30% border (`--pending` for a warning); a colored tag is its color at 16%.

### Chart colors (`app.js`)

- **Spending categories** (`CATEGORY_COLORS`, assigned biggest first): `#4F6BD8` `#D98A2B`
  `#8A5CC2` `#C2524A` `#3E8CC7` `#B0679A` `#B8913A` `#6D6AC9` `#D46A5A` `#5E7FA3` `#7D4E8F`
  `#9C5B3C` `#C04F86` `#A8956B` `#8C6A4F`. Never green.
- **Income sources** (`INCOME_COLORS`): `var(--success)` `#4E9A73` `#3F7F86` `#7FB08F` `#5C8A5A`
  `#2F5F6E`. Greens and teals only.
- Chart colors are the same in light and dark mode.

### Color do and don't

- Do use `--success` only for money coming in. Don't use green for a category, a badge or decoration.
- Do keep money going out in `--text` with a minus sign. Don't make spending red.
- Do use `--danger` for something that needs fixing. Don't use it for emphasis.
- Do add a new color as a variable in both theme blocks at the top of `style.css`. Don't write a
  hex value in a component.

## Type

Two families from Google Fonts: **Newsreader** (weights 400 and 500, optical sizes 6 to 72) for
titles, names and big amounts, and **Inter** (400 to 700) for everything else. Fallbacks:
`Georgia, serif` and `-apple-system, BlinkMacSystemFont, sans-serif`. `body` sets
`font-variant-numeric: tabular-nums`, so every figure in the app lines up.

| Role | Font | Size | Line / tracking | Where |
|---|---|---|---|---|
| Hero amount | Newsreader 500 | 41.6px (54.4px on laptop) | 1.05 / -2% | Home totals (`.hero-stat-value`) |
| Page title | Newsreader 500 | 32px | normal | `.page-title` |
| Sheet amount | Newsreader 500 | 32px | 1.1 | Top of a transaction (`.txs-amt`) |
| Sign-in title | Newsreader 500 | 30.4px | -1% | `.login-title` |
| Update title | Newsreader 500 | 28px | 1.2 | `.update-card h2` |
| Sheet title | Newsreader 500 | 26px | -1% | Popup titles |
| Name | Newsreader 500 | 20px | normal | Greeting in the header |
| Button | Inter 600 | 17px | normal | `.btn-primary` |
| Secondary button | Inter 600 | 16px | normal | `.btn-secondary-sm`, sheet Cancel |
| Input | Inter 400 | 16px minimum | normal | Anything you type in |
| Body | Inter 400 | 15px | normal | Settings and sheet rows |
| Row name | Inter 500 | 15px | normal | Transaction names |
| Amount in a list | Inter 600 | 15px | tabular | `.act-row-amt` |
| Pill | Inter 500 (600 selected) | 14px | normal | Category pills |
| Group heading | Inter 600, muted | 13px | normal | `.set-heading` above a group |
| Hint | Inter 400, muted | 13px | 1.45 | `.set-hint`, `.set-footnote` |
| Section caps | Inter 600, muted, uppercase | 12px | +5% | `.sheet-sec` inside sheets |
| Day header | Inter 600, muted | 12px | normal | `.act-day-head` |
| Meta | Inter 400, muted | 12px | normal | Dates, account names, tab labels |
| Small | Inter 400, muted | 11px | normal | Under an amount |
| Tag | Inter 600 | 11px | normal | Pending, Split, Adjusted, Edited, Moved |

### Type do and don't

- Do use Newsreader for one thing per screen: the title or the big number. Don't set body text,
  buttons or labels in it.
- Do keep amounts tabular. Don't turn tabular figures off for a "nicer" look.
- Don't go below 16px in an input (iOS zooms the page) or below 11px anywhere.
- Don't use uppercase except the small section caps in sheets.

## Spacing, radius and size

- **Spacing scale:** 4 (`--space-xxs`), 8 (`--space-xs`), 12 (`--space-sm`), 16 (`--space-md`,
  `--pad`), 24 (`--space-lg`), 32 (`--space-xl`). Page sides and row padding are 16. Gaps inside
  a row are 12; between pills 8; a group heading sits 24 above its group and 8 above the rows.
- **Radius:** 4 to 6 (tags), 8 (icon tiles), 10 (`--radius-sm`: small controls, sidebar items),
  12 (inputs, split fields, logo tiles), 14 (`--radius`: buttons, bank alerts), 16 (grouped
  lists, popups), 18 (sign-in card), 24 (top corners of a bottom sheet), fully round (pills,
  switches, avatars, logos, the Reconnect button).
- **Heights:** tap targets 44 minimum; settings rows 52; rows with an icon 54; sheet rows 48 to
  52; transaction rows 60; primary button 52; secondary button and inputs 48; category pills 38;
  Reconnect button 36.
- **Shadows:** bottom sheets `0 -8px 40px rgba(0,0,0,0.12)`; switch knob
  `0 1px 2px rgba(0,0,0,0.2)`. Nothing else casts a shadow. Selected tiles use an inset 1px
  accent ring instead.

## Layout

- **Phone first.** One column, 16px sides, content scrolls under a plain header (logo and
  greeting) and above a three-tab bar (Home, Activity, Settings). Safe areas are respected with
  `env(safe-area-inset-*)` on the header, tab bar, sheets and full-screen pages.
- **Laptop, 900px and wider:** the tab bar becomes a 220px sidebar on the left with the Alenjo
  name on top, and content is centered at up to 1080px wide with 40px sides. The hero number grows
  to 54.4px. This is the only breakpoint (`max-width: 899px` is its phone side).
- **Sheets** slide up from the bottom, full width on a phone (up to 500px on wider screens),
  never taller than the screen minus the status bar, with a sticky Cancel above the home
  indicator. Popups are centered cards up to 320px; on phones some (like editing an account)
  open as a bottom sheet instead.
- **Full-screen pages** (privacy, security, update required) cover everything and slide in from
  the right or fade in.
- Hover styles are wrapped in `@media (hover: hover)` so they don't stick after a tap.

## Motion

Motion is short and quiet. It shows where something came from; it never decorates.

| What | Duration and curve |
|---|---|
| Color, border, background changes | 0.15 to 0.2s, ease |
| Switch knob | 0.2s |
| Tab change, screen change | 0.18s fade (`tabFadeIn`, `screenIn`) |
| New transaction rows | 0.2s fade (`txFadeIn`) |
| Scrim fade | 0.3s, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Bottom sheet up | 0.5s, `cubic-bezier(0.34, 1.56, 0.64, 1)` (a small overshoot) |
| Popup in | 0.45s with the same spring, from 92% scale |
| Popup as a phone sheet, side pages | 0.28 to 0.35s, `cubic-bezier(0.22, 1, 0.36, 1)` (no overshoot) |
| Card flip | 0.17s out, 0.24s in |
| Toast | 0.15s fade, 0.4s spring up |
| Pull to refresh | logo pulses, 1.1s loop |
| Spinner | 0.7s linear loop |

`prefers-reduced-motion: reduce` cuts every animation and transition to almost nothing, and the
pull-to-refresh pulse becomes a gentle fade. Keep it that way: any new animation must also stop
under that setting.

## Icons

- Line icons drawn inline as SVG on a 24 by 24 grid, `fill="none"`, `stroke="currentColor"`,
  round caps and joins, so they take the color of the text around them.
- Sizes: 22 in the tab bar, 18 in rows and buttons (the most common), 16 and 14 for small
  inline marks.
- Stroke: 1.8 in the tab bar, 1.9 to 2.2 in rows. Heavier strokes (2.5) are only for tiny check marks.
- Settings links put the icon in a 30px tile, radius 8, `--accent-subtle` fill, green icon.
- No icon fonts, no emoji in the interface, no filled or two-color icon sets.
- Store and bank logos are real logos in circles (32px in lists, 44px in a transaction), on white
  so transparent logos look right. A missing logo shows the first letter on `--bg-elevated`.

## Components

Each component lists its look, its states, and the rules that keep it consistent.

### Primary button (`.btn-primary`)
- Full width, `--accent` fill, `--on-accent` text, Inter 600 17px, radius 14, 52 tall, no shadow.
- Hover: `--accent-hover`. Disabled: 30% opacity. Busy: the label says what is happening.
- Do: one per screen, for the main action. Don't: put two green buttons side by side.

### Secondary button (`.btn-secondary-sm`, `.btn-secondary-full`, sheet Cancel)
- `--group-bg` fill, `--text`, Inter 600 16px, radius 14, 48 tall, no border.
- Do: use it for Cancel and lesser actions. Don't: outline it; the old outlined look is retired.

### Text link (`.signin-link`, `.set-row-action`)
- `--accent`, Inter 500 or 600, padded to at least 40 tall to keep the tap target.
- Destructive links (Delete account) use `--danger` and stay small and centered under the content.

### Grouped list (`.set-group`, `.txs-group`, `.manage-group`)
- `--group-bg`, radius 16, no border, no shadow, `overflow: hidden`.
- Rows are separated by a `--hairline` that starts 16px in from the left (58px when rows have an
  icon tile), the way iOS does it.
- A 13px muted heading (`.set-heading`) names the group; an optional 13px footnote under it explains it.
- Do: keep related settings in one group. Don't: nest a group in a group, or hide a group behind
  a collapsing header.

### Settings row (`.set-row`)
- 52 tall, 16 padding, label in Inter 15 on the left.
- Right side, one of: a switch; a muted value with a chevron (opens a picker or sheet); nothing
  (the whole row is a button).
- Action row: the label itself in `--accent` 600 ("Connect a bank").
- Pressed: background `--text` at 5%.
- A two-line row puts a 13px muted hint under the label.

### Settings link with icon (`.set-nav`)
- 54 tall, 30px icon tile, label, chevron on the right. Opens a page of its own.

### Switch (`.set-switch`)
- 46 by 28, fully round. Off: `--track`. On: `--accent`. White 24px knob with a small shadow,
  sliding 18px in 0.2s.
- Focus: 2px accent outline, 2px offset.
- Do: a switch takes effect at once. Don't: put a switch in a form that needs Save.

### Input (`.app-input`)
- In sheets and groups: filled, radius 12, 48 tall, no outline. Focused: 1.5px `--accent` border.
- On the sign-in card: no box at all, just a bottom border that turns green on focus.
- Text is 16px or more. Placeholders are muted and say what goes there ("Name"), not an example.

### Transaction row (`.act-row`)
- 60 tall, ledger style: rows sit on the page with a `--border` line under each, no card.
- Left: 32px round logo. Middle: name (15/500) over meta (12, muted: the account's color dot,
  account, category). Right: amount (15/600, tabular) over a small line or tags.
- Amount color: out `--text` with "−", in `--success` with "+", pending `--pending`.
- Day headers (`.act-day-head`): 12px 600 muted with a `--border` line under them.
- Rows can be swiped for quick actions; a tap opens the transaction sheet.

### Transaction sheet (`.txs-*`)
- Logo and editable name on top, the amount in Newsreader 32px under it, then grouped rows
  (category, date, account, note), then toggles, then small links.
- Every field is editable in place; each edit applies to this one transaction.

### Category pill (`.cat-pill`)
- 38 tall, fully round, 14 sides, `--bg-card` with a `--border` outline, Inter 500 14px.
- Selected: `--accent-subtle` fill, no outline, `--accent` 600 text.
- Pills wrap in rows with 8px gaps.

### Tag (`.act-tag`, `.act-tag-*`, `.txs-adj`)
- 11px Inter 600, about 2 by 6 padding, small radius.
- Plain tags (Moved): `--bg-elevated` with muted text. Colored tags: their color at 16% behind
  text in that color. Pending: `--pending`. Edited: `--accent` on `--accent-subtle`. Split: blue.
  Adjusted: purple (purple because green is only for money in).

### Bank alert (`.bank-alert`)
- A row on Home when a bank needs attention: 8px dot, one sentence, and a small fully round green
  Reconnect button (36 tall). Radius 14. Error uses the `--danger` tint, warning the `--pending` tint.

### Bottom sheet (`.action-sheet`)
- `--sheet-bg`, radius 24 on top, 40 by 5 grab handle, 16px sides, the sheet shadow.
- Cancel sticks to the bottom, above the home indicator. Long sheets scroll inside.
- Content inside uses grouped lists and 12px uppercase section labels.

### Popup (`.modal-card`)
- Centered, up to 320px, radius 16, springs in from 92%. On phones some popups open as a bottom
  sheet instead.

### Toast (`.toast`)
- Small pill above the tab bar on `--bg-elevated`, one short sentence, disappears on its own.
- Do: confirm a result ("Show-off mode is on") or say what failed and what to do. Don't: use a
  toast for anything the person must act on.

### Tab bar (`.bottom-nav`)
- Three tabs: Home, Activity, Settings. 22px line icons, 12px labels, `--text-muted`, active tab
  `--accent`. `--bg` with a `--border` line on top.
- Laptop: a sidebar; the active item gets a `--bg-elevated` fill instead of the green.

### Home totals (`.hero-stats`)
- Labels in muted text over Newsreader 41.6px numbers, left aligned, no card behind them.
  Totals stay `--text` whether positive or negative; the sign carries the meaning.

## Accessibility

Contrast ratios (WCAG) for the main pairs, worked out from the values above:

| Pair | Light | Dark |
|---|---|---|
| `--text` on `--bg` | 10.0 | 11.9 |
| `--text-muted` on `--bg` | 4.7 | 6.1 |
| `--text-muted` on `--group-bg` | 5.5 | 5.1 |
| `--text-dim` on `--bg` | 4.2 (below 4.5) | 5.3 |
| `--accent` on `--bg` | 4.9 | 8.7 |
| `--on-accent` on `--accent` (button) | 5.4 | 8.7 |
| `--success` on `--bg` | 4.7 | 8.7 |
| `--danger` on `--bg` | 5.1 | 7.2 |
| `--pending` on `--bg` | 3.8 (below 4.5) | 7.7 |
| `--warning` on `--bg` | 3.7 (below 4.5) | 8.9 |
| `--track` (switch off) on `--group-bg` | 1.4 (below 3) | 1.1 (below 3) |

Rules the app follows, and should keep following:

- Touch targets are at least 44 by 44 (rows 48 to 60, buttons 48 to 52, links padded to 40 to 44).
- Inputs are 16px or larger so iOS doesn't zoom, and fields you type in stay selectable even
  though the rest of the interface isn't.
- Focus rings use `:focus-visible` with a 2px `--accent` outline and a 2px offset.
- Reduced motion is respected everywhere (see Motion).
- Decorative SVGs carry `aria-hidden="true"`; icon-only buttons need an `aria-label`.
- Never rely on color alone: amounts carry a "+" or "−", pending rows carry a Pending tag,
  alerts carry words.

## Writing for money screens

- **Amounts:** US dollars with cents, always (`$1,234.56`), from `Intl.NumberFormat`. Signs are
  added separately: "+" for money in, a true minus "−" (not a hyphen) for money out. With Hide
  amounts on, every amount shows `****`.
- **Show what the bank sends.** Balances appear exactly as Plaid reports them; the app doesn't
  round or adjust them.
- **Short labels in sentence case:** "Payments due", "Counts from", "Show-off mode". No Title
  Case, no exclamation marks, no emoji.
- **Say what happens, then the choice.** Hints explain the effect in one plain sentence before the
  person decides. A choice that isn't recommended says why ("Not recommended: this changes months
  you've already budgeted.").
- **Errors say what failed and what to do:** "Couldn't save that. Try again." Not an error code,
  and not just "Delete failed".
- **Empty states say what's missing and how to fix it,** with the button to fix it right there.
- **Talk to one person** ("your accounts"), in the present tense. No "Oops", no "Awesome", no
  selling, no upgrade prompts.

## Cleanup notes

Found while writing this and still open. (Already fixed: `--pending` declared twice, the unused
`ACCOUNT_COLORS`, the `#ef4444` fallback, and early rules that a later rule fully overrode.)

- `--bg-input` is identical to `--bg-card`.
- `--text-dim` and `--text-muted` are almost the same grey, and `--text-dim` fails contrast on
  `--bg` in light mode (4.2). Replacing it with `--text-muted` would fix both.
- `--pending` and `--warning` are below 4.5 on the light background. They pass in dark mode.
  Darkening them a step in light mode would make pending amounts easier to read.
- The switch's off track is almost invisible against its group (1.4 light, 1.1 dark; 3 is the
  usual minimum for controls). The knob carries it today; a slightly darker track would help.
- `--sheet-bg`, `--group-bg`, `--hairline` and `--pending` are declared halfway down the file
  instead of with the other theme variables at the top.
- About 180 font sizes are written as literal rem values; the `--text-*` sizes are used about
  55 times. `--text-hero` (36px) is not the hero size actually used (41.6px).
- Radii 4, 6, 8, 9, 12, 16, 18, 19, 20, 22 and 24 are written out by hand; only 10 and 14 have
  variables. The `--space-*` variables are defined but not used anywhere.
- Hard-coded colors: Split tag blue (`#5B7FD6` / `#8EA8EA`), Adjusted tag purple (`#A07FE0`, no
  dark version), white text on delete buttons and the switch knob.
- In dark mode `--accent` and `--success` are the same color, so "tap this" and "money in" look
  identical. In light mode they differ by a hair.
- Icon stroke widths drift (1.8, 1.9, 2, 2.2, 2.5) for icons of the same size.
- Error toasts are worded several ways ("Delete failed", "Could not save order", "Couldn't save
  that. Try again.").

# Alenjo design system

How Alenjo looks and why. Every value here is taken from `style.css` and `app.js` as they are
today, so this file describes the app, not a wish list. If the code and this file disagree, fix
one of them in the same change.

Figma: [Alenjo Design System](https://www.figma.com/design/M8RyMyGrvamfjZRzeNjV8Z). It holds the
same colors, sizes and text styles as Figma variables and styles. The pages for components and
this philosophy are still empty (see "Figma file" at the end).

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
5. **Say it plainly.** Labels are short sentences in everyday words ("Counts from", "Payments
   due"), not jargon or marketing. Hints under a row explain what a switch does before you flip it.
6. **Feels like iOS.** 44px minimum tap targets, safe areas respected, inputs at 16px or larger
   so the phone doesn't zoom, switches that look like the system ones, sheets that slide up.
7. **You're in control.** Edits to a transaction apply to that one transaction. Nothing is
   silently hidden. No badges, banners, promotions or upsells.

What Alenjo is not: an ad-filled budget site, a generic bank app, or a playful app with
mascots and confetti.

## Color

Always use the CSS variables, never a hex value. Light is the default; dark is
`:root[data-theme="dark"]`.

### Surfaces

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#E6E2D8` | `#1C1B17` | Page background |
| `--bg-card` | `#EEEAE1` | `#24221D` | Cards, sign-in card, outlined pills |
| `--bg-input` | `#EEEAE1` | `#24221D` | Plain input fill (same as card) |
| `--bg-elevated` | `#DCD7CB` | `#2E2B25` | Raised chips, badges, active sidebar item |
| `--sheet-bg` | `#E9E5DC` | `#201E1A` | Bottom sheets and popups |
| `--group-bg` | `#F6F3EC` | `#2B2924` | Grouped lists in Settings and sheets, secondary buttons |
| `--scrim` | `rgba(28,27,25,.35)` | `rgba(0,0,0,.55)` | Behind a sheet |

### Text and lines

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--text` | `#33312C` | `#DCD6CA` | Main text, amounts going out |
| `--text-muted` | `#67625A` | `#A0998C` | Labels, hints, dates, values on the right of a row |
| `--text-dim` | `#6F6A61` | `#958E81` | Older screens; treat as muted |
| `--border` | `#D2CCBF` | `#34312A` | Outlines, ledger dividers on Home and Activity |
| `--hairline` | `--text` at 10% | same | Dividers inside a group |
| `--track` | `#D6D0C4` | `#34312A` | Switch when off, progress tracks |

### Accent and status

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--accent` | `#2E6B4D` | `#86C6A2` | Buttons, links, switches, active tab |
| `--accent-hover` | `#26593F` | `#9AD2B3` | Primary button hover |
| `--accent-subtle` | `#D5DFD2` | `#213028` | Selected pill, icon tiles, Face ID button |
| `--on-accent` | `#F1EEE6` | `#1C1B17` | Text on a green button |
| `--success` | `#2A6E4D` | `#86C6A2` | Money in |
| `--danger` | `#A23A26` | `#E8917E` | Errors, over budget, delete |
| `--warning` | `#9A6A12` | `#E0B45E` | Heads-up states |
| `--pending` | `#A95E0C` | `#EE9A45` | Pending transactions |

### Chart colors (`app.js`)

- **Spending categories** (`CATEGORY_COLORS`, in order): `#4F6BD8` `#D98A2B` `#8A5CC2` `#C2524A`
  `#3E8CC7` `#B0679A` `#B8913A` `#6D6AC9` `#D46A5A` `#5E7FA3` `#7D4E8F` `#9C5B3C` `#C04F86`
  `#A8956B` `#8C6A4F`. Never green.
- **Income sources** (`INCOME_COLORS`): `var(--success)` `#4E9A73` `#3F7F86` `#7FB08F` `#5C8A5A`
  `#2F5F6E`. Greens and teals only.
- **Accounts** (`ACCOUNT_COLORS`): `#2F6FDB` `#0F8A95` `#7A4CC2` `#C27A1A` `#B0476A` `#3E8E5E`
  `#5E7FA3` `#9C5B3C`. Each account keeps its color everywhere.

## Type

Two families, loaded from Google Fonts: **Newsreader** (500) for titles, names and big amounts,
**Inter** (400 to 700) for everything else. `body` sets `font-variant-numeric: tabular-nums`.

| Role | Font | Size | Where |
|---|---|---|---|
| Hero amount | Newsreader 500, -2% tracking, 1.05 line | 41.6px (54.4px on laptop) | Home totals (`.hero-stat-value`) |
| Page title | Newsreader 500 | 32px | `.page-title` |
| Sheet amount | Newsreader 500 | 32px | Top of a transaction (`.txs-amt`) |
| Sheet title | Newsreader 500, -1% | 26px | Popup titles |
| Name | Newsreader 500 | 20px | Greeting in the header |
| Button | Inter 600 | 17px (16px secondary) | `.btn-primary` |
| Body | Inter 400 | 15px | Settings and sheet rows |
| Row name | Inter 500 | 15px | Transaction names |
| Amount in a list | Inter 600, tabular | 15px | `.act-row-amt` |
| Group heading | Inter 600, muted | 13px | `.set-heading` above a group |
| Section caps | Inter 600, uppercase, +5% | 12px | `.sheet-sec` inside sheets |
| Hint | Inter 400, muted, 1.45 line | 13px | `.set-hint`, `.set-footnote` |
| Meta | Inter 400, muted | 12px | Dates, account names, tab labels |
| Small | Inter 400, muted | 11px | Under an amount, tags (600) |
| Input text | Inter 400 | 16px minimum | Anything you type in |

## Spacing, radius and size

- **Spacing:** `--space-xxs` 4, `--space-xs` 8, `--space-sm` 12, `--space-md` 16, `--space-lg` 24,
  `--space-xl` 32, `--pad` 16. Page sides and row padding are 16.
- **Radius:** 10 (`--radius-sm`, small controls), 12 (inputs, split fields), 14 (`--radius`,
  buttons), 16 (grouped lists), 18 (sign-in card), 24 (top of a bottom sheet), fully round for
  pills and avatars.
- **Heights:** tap targets 44 minimum, settings rows 52, rows with an icon 54, transaction rows 60,
  primary button 52, secondary button and inputs 48.
- **Shadow:** bottom sheets only, `0 -8px 40px rgba(0,0,0,0.12)`. Switch knob `0 1px 2px rgba(0,0,0,0.2)`.

## Components

- **Primary button** (`.btn-primary`): full width, green fill, `--on-accent` text, radius 14,
  52 tall, no shadow. One per screen. Disabled is 30% opacity.
- **Secondary button** (`.btn-secondary-sm`, `.btn-secondary-full`, sheet Cancel): `--group-bg`
  fill, `--text`, 600 weight, radius 14, 48 tall, no border.
- **Grouped list** (`.set-group`, `.txs-group`, `.manage-group`): `--group-bg`, radius 16, no
  border. Rows are 52 tall with 16 side padding; a hairline starts 16 in from the left (58 when
  the row has an icon tile). A 13px muted heading sits 24 above the group.
- **Settings row** (`.set-row`): label on the left, then on the right one of a switch, a muted
  value with a chevron, or nothing. An action row puts the label itself in green 600.
- **Settings link with icon** (`.set-nav`): 30px tile, radius 8, `--accent-subtle` fill with a
  green line icon, label, chevron.
- **Switch** (`.set-switch`): 46 by 28, white 24px knob, `--track` off, `--accent` on.
- **Input** (`.app-input` in sheets and groups): filled, radius 12, 48 tall, no outline until
  focus, then a 1.5px green border.
- **Transaction row** (`.act-row`): 32px round logo, name (15/500) over meta (12, muted, with the
  account's color dot), amount (15/600) on the right. Out is `--text`, in is `--success`,
  pending is `--pending`. Rows are split by `--border` lines, ledger style.
- **Category pill** (`.cat-pill`): 38 tall, fully round, card fill with a border; selected is
  `--accent-subtle` with green 600 text. Pills wrap in rows with 8px gaps.
- **Tag** (`.act-tag-*`, `.txs-adj`): 11px 600 text on the same color at 16%, radius 6.
- **Bottom sheet** (`.action-sheet`): `--sheet-bg`, radius 24 on top, 40 by 5 grab handle,
  sticky Cancel at the bottom clear of the home indicator.
- **Tab bar** (`.bottom-nav`): three tabs (Home, Activity, Settings), 22px line icons at 1.8
  stroke, 12px labels, muted with the active one green. On screens 900px and wider it becomes a
  220px sidebar.

## Cleanup notes

Found while writing this. None of it is changed yet.

- `.impeccable.md` still describes the old look (navy-black background, DM Sans, blue accent).
  The Design Context in `CLAUDE.md` is the current one.
- `--pending` is declared twice (`#B5582F` then `#A95E0C`); the second wins.
- `--accent-glow` is identical to `--accent-subtle`, and `--bg-input` to `--bg-card`.
- `--text-dim` and `--text-muted` are almost the same grey. One would do.
- `--sheet-bg`, `--group-bg`, `--hairline` and `--pending` are declared halfway down the file
  instead of with the other theme variables at the top.
- About 200 font sizes are written as literal rem values; the `--text-*` sizes are used about
  100 times. `--text-hero` (36px) is not the hero size actually used (41.6px).
- Radii 6, 8, 9, 12, 16, 18, 19, 20, 22 and 24 are written out by hand; only 10 and 14 have
  variables. Spacing variables are used 7 times.
- Hard-coded colors: Split tag blue (`#5B7FD6` / `#8EA8EA`), Adjusted tag purple (`#A07FE0`, no
  dark version), white text on the delete button, the switch knob, and a `#ef4444` fallback left
  from the old red.
- `ACCOUNT_COLORS` includes a green (`#3E8E5E`), which breaks "green means money in".
- In dark mode `--accent` and `--success` are the same color, so "tap this" and "money in" look
  identical. In light mode they differ by a hair.
- Several components are styled twice: an early rule and a later "design refresh" rule that
  overrides it (`.set-group`, `.btn-primary`, `.bottom-nav`, `.action-sheet`). The early rules
  are dead weight.

## Figma file

[Alenjo Design System](https://www.figma.com/design/M8RyMyGrvamfjZRzeNjV8Z) has:

- **Variables:** `Color · Light` and `Color · Dark` (the 22 colors above, same names in both),
  `Chart colors` (category, income, account) and `Size` (spacing, radius, type sizes, heights).
  Each has its CSS variable set as web code syntax. Light and dark are two collections instead of
  two modes because the free Figma plan allows one mode per collection.
- **Styles:** 73 color styles (`Light/…`, `Dark/…`, `Chart/…`) bound to those variables, 15 text
  styles, and the two shadows.
- **Pages:** Philosophy, Foundations and Components exist but are empty. The free plan allows
  three pages and a small number of Figma connector calls per month, and the build stopped at
  that limit before drawing components.

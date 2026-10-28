# PerpLog — Pro UI: trading-desk shell, Plan risk ladder, Health and Home

- **Date:** 2026-10-28
- **Status:** Draft for review
- **Supersedes:** the look (tokens, ground, shell) of `docs/specs/2026-10-28-perplog-design-system.md`. That
  document still holds for copy rules, anti-goals and the weekly report image.
- **Builds on:** `docs/specs/2026-10-25-perplog-design.md` (product and behavior). Nothing here changes behavior,
  safety invariants or API semantics, except one new read-only route (§6.3).

---

## 1. Intent

The live app works but reads as a demo: a 976px column floats in the middle of a wide screen, the nav is a rounded
box, every panel is the same card, every label is uppercase, and the Plan screen is a bare form next to an
almost empty preview. A trader opening it next to the dreamDEX order ticket should feel they moved into a
sharper instrument, not a hackathon page.

**PerpLog measures what the exchange UI does not show.** The design makes that literal: one visual device, the
*measurement bracket*, appears wherever PerpLog shows a gap between two numbers. On Health it spans "the app
shows" and "your true net PnL". On Plan it spans entry to stop (your max loss) and stop to liquidation (your
buffer). That bracket is the one memorable element; everything around it stays quiet.

Audience: active perps traders on dreamDEX, and bounty judges who will open the app for a few minutes before
the 2026-11-01 deadline.

## 2. Decisions made with the user (2026-10-28)

| Topic | Decision |
|---|---|
| Visual direction | **Dark trading desk.** Layered dark slate, high information density, numbers lead |
| App shell | **Left sidebar + full-width content** on account pages |
| Plan page | **Order ticket + vertical risk ladder** (entry / stop / liquidation on a price scale), built from the existing quote data; no candle chart |
| Scope | **Shell, tokens, Plan, Health, Home** redesigned. Journal, Leaks, Positions, Report, Evidence and How it works get the new tokens and shell and are fixed where dark breaks them, but keep their layouts |

## 3. Goals, non-goals, anti-goals

**Goals**

1. One token set in `apps/web/app/globals.css`, dark by default, drives every screen.
2. Account pages use a persistent app shell: sidebar navigation, a top bar for the account, range and bot status,
   and content that uses the full width (max ~1600px).
3. Plan shows, before the trader types anything, the live best bid and ask for the selected market; once a
   quote exists it draws entry, stop and liquidation on one price scale with the max loss and the buffer
   measured between them.
4. Health leads with the gap between the two PnL numbers, drawn as the measurement bracket, and gives the
   equity curve real width.
5. Home opens with the same bracket on the sample account, and the address field is the single obvious action.

**Non-goals**

- A light theme or a theme switcher. The app is dark only.
- A candle or price-history chart.
- New product behavior, new data, or changes to sizing, placing, arming or reconciliation.
- Layout redesigns of Journal, Leaks, Positions, Report, Evidence, How it works.
- Changing the weekly report OG image (`app/api/og/report/...`), which is already dark.

**Anti-goals** (a failure even if it works)

- **Breaking e2e or the fixed copy.** Every string, label and `data-testid` used in `apps/web/e2e` stays (see §8).
- **Looking like an official dreamDEX product.** No dreamDEX logo, wordmark or illustrations. The disclaimer
  "Independent tool for dreamDEX traders · not affiliated with dreamDEX" stays visible on Home and account pages.
- **Unreadable data.** Every text and number meets WCAG AA (4.5:1) on the surface it sits on; gain/loss is never
  the only signal (signs and labels stay).
- **A generic dark dashboard:** identical rounded cards with soft shadows, neon-green-on-black, gradient washes,
  uppercase tracked labels above every block.
- **Weakening the safety copy.** The Plan screen still says exactly what the bot will send and what happens on a
  partial or failed fill.

## 4. Tokens

Replace the `:root` and `prefers-color-scheme: dark` blocks in `globals.css` with one dark set (no media query).
Keep the `@theme inline` mapping pattern so components keep using `bg-panel`, `text-muted`, etc.; rename only
where noted.

| Token | Value | Use |
|---|---|---|
| `--page` | `#10151c` | Page ground (body background) |
| `--panel` | `#161c25` | Sidebar, panels |
| `--field` | `#1d2530` | Inputs, segmented controls, hover rows |
| `--line` | `#27303d` | Hairlines, panel borders |
| `--line-strong` | `#364152` | Ghost button borders, ladder axis |
| `--head` | `#f1f5f9` | Headings, primary numbers |
| `--text` | `#c3ccd6` | Body text |
| `--muted` | `#8392a3` | Secondary text (≥4.5:1 on `--panel`) |
| `--gain` | `#3ddc97` | Gains, Long |
| `--loss` | `#ff6b81` | Losses, Short, liquidation |
| `--loss-fill` | `#e5485f` | Filled Short button |
| `--warn` | `#f5b84a` | Warnings |
| `--brand` | `#20ccff` | PerpLog cyan: brand, focus, the bot-held stop, the measurement bracket |
| `--brand-ink` | `#04222c` | Text on brand-filled surfaces |
| `--action` | `#20ccff` | Primary buttons are brand-filled with `--brand-ink` text |
| `--action-hover` | `#5cdbff` | |
| `--testnet` / `-bg` / `-line` | `#ff66e6` / `#3d0a35` / `#7a1f6c` | Testnet badge |
| `--x` | `#000000` | Share-on-X button |

Filled Long/Short segments use dark text (`--page`) on `--gain` / `--loss-fill`, not white.

**Type.** Replace Geist with **IBM Plex Sans** (UI and all numbers, `font-variant-numeric: tabular-nums`) and
**IBM Plex Mono** (addresses and tx hashes only), via `next/font/google`. The `Num` component switches from mono
to sans tabular figures. Scale: 12 / 13 / 14 (body) / 16 / 20 / 28 / 44px; weights 400, 500, 600.

**Labels.** Sentence case, no uppercase or letter-spacing (`Label`, `Field` and the Plan market label change).

**Shape.** Panels: 1px `--line` border, radius 10px, no shadow. Inputs and buttons: radius 8px. The sidebar and
top bar have no radius; they are the frame, not cards. Do not put every block in a panel: on Health and Plan,
sections are separated by hairlines inside one surface where they belong together.

**Motion.** One moment: on Plan, ladder markers and brackets glide to new positions (≈200ms ease-out) when the
quote changes. Existing hover/focus transitions stay. Everything respects `prefers-reduced-motion`.

## 5. App shell

**Routes using the shell:** `/a/[address]` (all tabs). **Routes using the slim top bar:** `/`, `/evidence`,
`/how-it-works`, `/r/[address]/[week]`.

### 5.1 Desktop (≥1024px)

```
┌───────────────┬─────────────────────────────────────────────────────────────┐
│ perplog  Test │ 0x3952…3951 ⧉  [Watch this account]      7D 30D All   ● Bot │
│               ├─────────────────────────────────────────────────────────────┤
│ ◧ Health      │                                                             │
│ ☰ Journal     │                    tab content                              │
│ ◔ Leaks       │                    (padding 24–32px, max-width 1600px)      │
│ ▤ Positions   │                                                             │
│ ⊕ Plan        │                                                             │
│ ⎙ Report      │                                                             │
│               │                                                             │
│ Evidence      │                                                             │
│ How it works  │                                                             │
│               │                                                             │
│               │ Independent tool for dreamDEX traders · not affiliated …   │
└───────────────┴─────────────────────────────────────────────────────────────┘
```

- **Sidebar** (232px, `--panel`, right hairline, sticky full height): wordmark (`perplog`, still a link to `/`
  with that exact accessible name) and Testnet badge; the six account sections as links with a 16px inline SVG
  icon each (current item: `--field` background, 2px `--brand` left bar, `aria-current="page"`); a hairline;
  Evidence and How it works. The disclaimer is a footer at the bottom of the content column at every width
  (11px `--muted`), so it is rendered once.
- **Top bar** (56px, `--page`, bottom hairline, sticky): full address shortened in mono with a copy button
  (copies the full lowercase address, shows "Copied" for 1.5s), the existing Watch button, then right-aligned the
  7D/30D/All range control (shown on the same tabs as today) and the **bot status chip**.
- **Bot status chip:** reads the existing session state. Linked to this account: `● Protected` in `--brand`
  with the bot address in the tooltip. Linked elsewhere or not linked: `○ Protection off` in `--muted`, linking
  to `?tab=plan`. Without a database (`useProtectionAvailable()` false): hidden.
- Tab links keep the existing URL scheme (`?tab=…&range=…`, `scroll={false}`).

### 5.2 Narrow (<1024px)

The sidebar collapses. A top bar holds the wordmark, Testnet badge and a menu button that opens Evidence / How it
works; under it, the account row (address, Watch, bot chip) and a horizontally scrollable tab row (icons +
labels), as today. The range control wraps under the tabs. No horizontal page scroll at 390px.

### 5.3 Slim top bar (non-account pages)

Full-width 56px bar: wordmark, Testnet badge, Evidence, How it works; right side empty. Footer with the
disclaimer at the bottom of the page.

## 6. Plan page

### 6.1 Layout (≥1280px)

```
┌ Protection strip (full width) ─────────────────────────────────────────────────┐
│ ● Protected · bot 0xb0…41 can only close positions        (or the link wizard) │
└────────────────────────────────────────────────────────────────────────────────┘
┌ Ticket 380px ──────────────┐┌ Risk ladder ───────────────────────┐┌ Summary 300px ┐
│ Market  [LIT ▾]            ││                                    ││ Size          │
│ Bid 1.204   Ask 1.206  ⟳   ││  1.300 ┄                           ││ 714 LIT long  │
│ [ Long ][ Short ]          ││  1.206 ━━━━━━ Entry (worst) ─┐     ││ Notional  861 │
│ Max loss if the stop hits  ││  1.205 ── ref                │−25  ││ Leverage  5.0×│
│ [ 25            ] USDso    ││                              │2.9% ││ Liq. est 1.020│
│ Stop price                 ││  1.171 ━━━━━━ Stop · bot ────┘     ││ Max loss −25  │
│ [ 1.171         ] USDso    ││                              ┐     ││               │
│ −1%  −2%  −3%  −5%         ││                              │buf  ││ warnings      │
│ Below the current ask.     ││  1.020 ━━━━━━ Liquidation ───┘12.9%││               │
│ ────────────────────────── ││  0.980 ┄                           ││               │
│ [      Place order      ]  ││                                    ││               │
│ long 714 LIT · stop 1.171  ││                                    ││               │
│ steps / errors / fine print││                                    ││               │
└────────────────────────────┘└────────────────────────────────────┘└───────────────┘
```

Between 1024 and 1279px the summary moves under the ladder. Below 1024px everything stacks: ticket, ladder,
summary.

### 6.2 Ticket

- Market select, then a **book line**: best bid and best ask for the selected market from §6.3, polled every 5s
  while the tab is visible, prices formatted to the market's tick decimals. Unavailable → "—" for that side.
- Side segmented control (Long / Short), unchanged behavior.
- "Max loss if the stop hits" and "Stop price" fields, same ids, labels, units, placeholders and validation.
- **Stop shortcuts:** chips `−1% −2% −3% −5%` for a long (computed from the best ask), `+1% +2% +3% +5%` for a
  short (from the best bid). Clicking fills the stop field with that price snapped away from entry to the
  market's tick and formatted to tick decimals. Hidden when the needed book side is unavailable.
- Hint under the stop keeps today's text and adds the live price when known: "Below the current ask (1.206)."
- The **Place block moves into the ticket**, under a hairline: Place order button, the summary line, place
  errors, plan status step tracker, and the fine print. Same enabling rules as today. Visible only when the
  session is linked to this account, as today.
- Primary button styling: brand-filled. The Long/Short segment is the only place side colors fill a control.

### 6.3 New read-only route: `GET /api/markets/[pool]/book`

Returns `{ "bestBid": string | null, "bestAsk": string | null }` (raw price integers as decimal strings) from the
existing `chain.bookTop(pool)`. 400 `unknown_pool` for a pool not in `chain.markets()`. No DB, no session, no
side effects; works without `DATABASE_URL`. Short cache (`Cache-Control: no-store` is acceptable). This is the only
backend change in this spec.

### 6.4 Risk ladder

An SVG that fills the center column (min height 360px), wrapped in the existing `data-testid="plan-quote"`
element together with the summary column so the size and other quoted values stay inside that test id.

- **Scale:** vertical, linear in price. Domain = min/max of the prices present (best bid, best ask, ref price,
  entry bound, stop, liquidation estimate), padded 12% each side. Price ticks at nice round steps on the left
  axis, formatted to tick decimals; for a short the order is naturally inverted (stop above, liquidation above
  that).
- **Markers** (full-width horizontal rules with a right-aligned label and price):
  - Entry (worst IOC price `priceBound`): `--head`, solid, label "Entry (worst)"; the ref price as a short thin
    tick labeled "ref".
  - Stop: `--brand`, solid 2px, label "Stop · held by PerpLog".
  - Liquidation estimate: `--loss`, dashed, label "Liquidation (est.)". Absent when `liqPriceEst` is null; the
    summary then shows "—".
  - Best bid / ask: faint `--muted` ticks on the axis.
- **Measurement brackets** (the signature): a bracket between entry and stop labeled with the max loss
  (`−25.00 USDso`) and the distance as % of entry; a second bracket between stop and liquidation labeled "Buffer"
  and that distance as % of entry. Brackets draw in `--brand`.
- **States:**
  - No input yet: the axis around the live bid/ask with only those ticks, and centered text "Set your max loss
    and stop to see the plan."
  - Typing / fetching: the previous ladder stays, dimmed to 60%, with "Updating…" in the corner.
  - Quote error: the ladder area shows the existing `WarnBox` copy from `QUOTE_ERRORS`, unchanged.
  - Stop typed but not yet valid against the book (e.g. above the ask for a long): show the error from the server
    as today; no client-side preview of invalid geometry.
- **Accessibility:** the SVG has `role="img"` and an `aria-label` summarizing entry, stop, liquidation and max
  loss; all values are also present as text in the summary column.

### 6.5 Summary column

Size as the large number (`44px`, `--head`) with "LIT · long" beside it; then rows: Notional, Entry (IOC, worst
price), Est. liquidation price, Est. leverage, Risk if the stop hits (in `--loss`), then quote warnings
(`WarnBox`). Same labels and formatting as today's breakdown rows.

### 6.6 Protection strip

Full width above the three columns, one of:

- Linked to this account: one line, `● Protected` in `--brand`, "PerpLog's bot <short address> can only close
  your positions.", the bot address in mono (`data-testid="bot-address"` if it is rendered here; keep wherever
  the e2e currently expects it).
- Not linked: "Protection is off for this account. Placing a plan needs PerpLog's bot key." with the existing
  `LinkWizard` rendered inline below that sentence (unchanged component and test ids, restyled).
- Linked to another account: the existing warning copy.
- No database: the strip is not rendered and there is no Place order button (as today).

## 7. Health page

### 7.1 Layout (≥1280px)

```
┌ Gap band (one surface, full width) ─────────────────────────────────────────────────┐
│ Last 7 days · 24 closed trades                          ✓ Reconciled with chain     │
│                                                          Data as of Oct 28, 12:43 PM │
│ The app shows (realized)   −796.13  ┐                                                │
│                                     │ −182.65 not shown by the app                   │
│ Your true net PnL         −978.78   ┘ USDso                                          │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ Where the 182.65 went:   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ Liquidation fees −187.01           │
│                          ▏Funding +4.36                                              │
│  Realized PnL −796.13 · Funding paid +4.36 · Liquidation fees −187.01 · Net −978.78  │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ Cumulative net PnL, trade by trade (2/3) ──────────┐┌ Top leak (1/3) ───────────────┐
│                                                    ││ Liquidations  −989.64          │
│   equity chart, 320px tall                         ││ 100% of your losses …          │
│                                                    ││ [Protect open positions] [See] │
│                                                    │├────────────────────────────────┤
│                                                    ││ Win rate 54% │ No stop 100% │ 24│
└────────────────────────────────────────────────────┘└────────────────────────────────┘
```

- **Gap band:** the two PnL numbers stacked and left-aligned so their digits line up, with the measurement
  bracket on their right labeled by the difference. The true net PnL is 44px `--head`/`--loss`/`--gain` by sign;
  the app number is 28px `--muted`. `data-testid="health-gap"` wraps this.
- **Where it went:** a single horizontal bar split by the magnitude of each component other than realized PnL
  (funding, liquidation fees, any other existing breakdown rows), each segment colored by its sign (`--loss`
  for money lost, `--gain` for money received) and labeled with its signed value; the bracket above already
  states the net. Then followed by the existing breakdown rows rendered as a compact
  table. `data-testid="health-breakdown"` wraps the rows. Same values and labels as today.
- Reconciliation badge ("✓ Reconciled with chain") and "Data as of" move to the band's top-right.
- **Equity chart** gets 2/3 width and 320px height; restyled to the tokens (cyan line, `--line` grid, `--muted`
  axis text). Keep `data-testid="equity-chart"`.
- **Top leak** keeps `data-testid="top-leak"` and its copy and buttons; stats become one row of three inline
  cells separated by hairlines instead of three cards.
- Below 1280px: band full width, then chart, then leak + stats. Below 640px all single column.

## 8. Home page

```
┌ slim top bar ──────────────────────────────────────────────────────────────────┐
│                                                                                │
│  Your true perps PnL on dreamDEX —            ┌ One account we checked ──────┐ │
│  after funding and liquidation fees.          │ App shows   −609.70  ┐       │ │
│                                               │ True net    −796.80  ┘ −187.10│ │
│  The realized PnL the app shows leaves out…   │ Funding made this loss 31%   │ │
│                                               │ bigger than the app shows.   │ │
│  dreamDEX trading account address             └──────────────────────────────┘ │
│  [ 0x…                                  ] [Analyze]                            │
│ ──────────────────────────────────────────────────────────────────────────── │
│  What we see across dreamDEX perps                                             │
│  77%  of new positions … no stop-loss …    147,313 USDso  in liquidation fees… │
│  Computed from the dreamDEX indexer on …                                       │
│ ──────────────────────────────────────────────────────────────────────────── │
│  How it works: Check → Plan → Protect (three steps, links to /how-it-works)    │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Same headline, body copy, field label, placeholder, button text ("Analyze") and validation messages.
- The sample card uses the measurement bracket (the same component as Health) instead of a highlighted row.
- The two ecosystem stats lead with the number at 28px, then the sentence.
- New: a three-step strip "Check your real PnL → Plan a sized entry → Let PerpLog hold the stop", each step one
  sentence, linking to `/how-it-works`. This is a sequence, so numbering is allowed here.
- Container max-width 1200px, left-aligned text.

## 9. Pages that only get the tokens and shell

Journal, Leaks, Positions, Report (tab and `/r/...`), Evidence, How it works: no layout changes. The builder
checks each in the dark theme and fixes anything that hardcodes light colors (e.g. `bg-white`, recharts default
colors, hardcoded hex in components) so every color comes from a token. Uppercase labels become sentence case
through the shared `Label`/`Field`.

## 10. Constraints

- **e2e copy and test ids stay.** At least: "Analyze", "Enter a valid 0x address", "No perps activity for this
  address.", "Watch this account", "Watching", "✓ Reconciled with chain", "Max loss if the stop hits", "Stop
  price", "Place order", "Enable protection", "Protect", "Arm stop", "Cancel stop", "Trigger price", "Previous
  week", "Next week", "Download PNG", "Share on X", the disclaimer, the `perplog` wordmark link, and the test ids
  `health-gap`, `health-breakdown`, `top-leak`, `equity-chart`, `plan-quote`, `plan-status`, `link-wizard`,
  `bot-address`, `perplog-stop`, `position-row`, `alert-toast`, `report-image`.
- **`e2e/design.spec.ts` changes with this spec:** the "light page background" test becomes "the page background
  is rgb(16, 21, 28)" (no color-scheme emulation). The 390px no-horizontal-scroll test adds `?tab=plan`.
- **e2e for Plan** must mock the new book route (or the ladder tolerates its failure and shows "—"; both bid and
  ask unavailable must not block quoting).
- `apps/web` invariants from `CLAUDE.md` are untouched: no signer, no wallet client, read-only without DB.
- No new runtime dependencies except the two Google fonts through `next/font`. The ladder is hand-written SVG;
  icons are inline SVG.
- Desktop targets 1280–1920px; must work at 390px.

## 11. Left to the builder

- Exact icon drawings, spacing values inside the 4px grid, the nice-step tick algorithm for the ladder.
- Component boundaries (e.g. `AppShell`, `Sidebar`, `TopBar`, `MeasureBracket`, `RiskLadder`, `BookLine`) and
  whether the bracket is SVG or CSS.
- How the equity chart is restyled within recharts.
- Copy for new strings not listed above, following the existing copy rules (sentence case, plain verbs).

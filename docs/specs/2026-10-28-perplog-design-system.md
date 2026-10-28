# PerpLog — Design System and Screen Design

- **Date:** 2026-10-28
- **Status:** Draft for review
- **Applies to:** all of `apps/web`, including the existing screens (Health, Journal, Leaks, Positions, landing) and the Plan 3 screens (Plan, Report, `/evidence`, `/how-it-works`)
- **Builds on:** `docs/specs/2026-10-25-perplog-design.md` (product and behavior). This document decides only how things look and read.
- **Reference mockups (local, git-ignored):** `.superpowers/brainstorm/9716-1793150554/content/`
  - `health-light.html`, option L2;
  - `plan-tab.html`, option P1;
  - `report-evidence.html`: option R2 for the report image, and the evidence page.

---

## 1. Intent

**PerpLog should look like a tool from the dreamDEX ecosystem, so a trader moving between the dreamDEX app and PerpLog feels at home.** It still has to be clearly a separate, independent product.

The Health Check is the screen that has to land first. **A judge or a trader must understand within about three seconds that the number the app shows is not their real result.** Every other element on that screen exists to prove that number (reconciliation) or to act on it (top leak and its fix).

The weekly report image is the growth loop. It has to stand out in an X timeline and still be recognisably part of the dreamDEX world.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One token set drives every screen. Changing `apps/web/app/globals.css` restyles the whole app.
2. The Health Check leads with the gap: "the app shows" next to "your true net PnL", then exactly where the difference went.
3. Plan & Place feels like the dreamDEX order ticket: a form on the left and a live preview on the right.
4. The shared weekly report card is dark and eye-catching.
5. `/evidence` lets a judge verify every PerpLog order on the explorer in one click.

**Non-goals**

- Pixel-matching dreamDEX.
- A theme switcher UI.
- Animations beyond the existing hover and focus transitions.
- Redesigning layouts of existing screens beyond re-skinning them, except the Health Check.

**Anti-goals** (a failure even if it works):

- **Looking like an official dreamDEX product.** Never use the `{d}` logo, the "dreamdex" wordmark, their illustrations or their name as our brand. The footer always says "Independent tool for dreamDEX traders · not affiliated with dreamDEX".
- **Unreadable colors.** dreamDEX's neon mint `#00fa89` on a white background is unreadable. Gains on light surfaces use dark green.
- **Breaking e2e.** The fixed copy and `data-testid`s listed in `CLAUDE.md` and in Plan 3 stay exactly as they are.

## 3. Decisions made with the user

| Topic | Decision |
|---|---|
| Source of inspiration | The dreamDEX **trading app** (app.testnet.dreamdex.io), not the dreamdex.io landing page |
| Scope | The **whole app** |
| Ground | **Light, brighter than dreamDEX's own light theme** (option L2): page `#eef1f5`, white panels |
| Health Check | **Option A, "The gap"** |
| Plan tab | **P1, order ticket** |
| Weekly report card | **R2, dark card** |
| `/evidence` | As mocked, including the "Median stop latency" tile |

## 4. Tokens

These live in `apps/web/app/globals.css` and replace the current paper/sheet/marker tokens. The source values come from the dreamDEX app's own `[data-theme="light"]` and dark themes (read 2026-10-28), plus PerpLog's brand cyan from the dreamDEX palette.

| Token | Light (primary) | Dark (`prefers-color-scheme: dark`) | Use |
|---|---|---|---|
| `--page` | `#eef1f5` | `#0e1217` | page background |
| `--panel` | `#ffffff` | `#1c222a` | panels, nav bar, cards |
| `--field` | `#f2f5f8` | `#14191f` | inputs, segmented controls, chips |
| `--line` | `#d0d7e6` | `#2d323a` | panel borders, dividers |
| `--line-strong` | `#b1b7bf` | `#3a414b` | ghost button borders, chart baselines |
| `--head` | `#0e1217` | `#ffffff` | headings, key numbers |
| `--text` | `#1e242b` | `#c9d1d9` | body |
| `--muted` | `#404852` | `#8d98a3` | labels, hints |
| `--gain` | `#1c634d` | `#00fa89` | profit, long, buy, success |
| `--loss` | `#af0c3d` | `#ec658d` | loss, short, sell text |
| `--loss-fill` | `#dc0b4a` | `#dc0b4a` | loss fills and bars |
| `--warn` | `#a34e00` | `#ff9533` | warnings, the "no stop" figure |
| `--brand` | `#137a99` | `#20ccff` | PerpLog identity: wordmark accent, active tab, links, focus, chart line |
| `--brand-line` | `#1aa3cc` | `#20ccff` | equity chart stroke |
| `--action` | `#514cae` | `#5b55c8` | primary action buttons (Place order, Protect, Arm stop) |
| `--action-hover` | `#5e59b2` | `#6b65d1` | hover state of the primary action |
| `--focus` | `#137a99` | `#20ccff` | `:focus-visible` outline |

**Tints**, used for badges, pills and boxes. Each one is the base color at the given alpha, with a border at about `55` alpha.

| Tint | Color | Use |
|---|---|---|
| Testnet | text `#990080` on `#ffe6fb`, border `#ff99ef` | Testnet badge |
| Reconciled | `--gain` | Reconciled badge |
| Warning | `#a34e00` on `#fff2e6`, border `#ffca99` | warning box |
| Leak | gradient `#fce7ed` → `--panel`, border `#f19db7` | Top leak card |

**Shape and space**
- Radius: panels and cards 12px; inputs, buttons and segmented controls 8px; segments 6px; pills 999px.
- Borders are 1px `--line`. There are no shadows, except a 1px shadow on the active segment in light mode.
- Panel padding 18px, tile padding 14px. The gap between panels is 12px.
- The content max width stays as it is today.

**Typography**
- Load **Geist** and **Geist Mono** through `next/font/google`, replacing Schibsted Grotesk.
- Body text is 14px.
- **Every number uses Geist Mono with `tabular-nums`**: prices, PnL, sizes, percentages, addresses, tx hashes and block numbers.
- Labels: 12px, uppercase, letter-spacing 0.3px, `--muted`.
- Tabs: 12px, 500 weight; the active tab is 600 weight `--head` with a 2px `--brand` underline.
- Key figures:
  - Health "true net PnL": 48px, 600 weight, −1px tracking;
  - Plan size: 44px;
  - stat tiles: 22px;
  - `/evidence` tiles: 24px.

## 5. Components

The names are suggestions, but each component should be one reusable piece.

- **NavBar.** A panel with the wordmark `perp` + `log` (Geist Mono 600, 17px; "log" in `--brand`) and the Testnet badge. Links: Account, Evidence, How it works. On the right: the address chip (mono, `--field`) and the Watch button (ghost). Below 860px the links collapse.
- **Tabs.** Health · Journal · Leaks · Positions · Plan · Report, with an underline style over a 1px `--line` bottom border.
- **Panel, Label, StatTile.** A StatTile is a label plus a mono 22px value.
- **Field.** A 46px-high box in `--field` with a mono value, a unit suffix in `--muted`, and an optional hint line underneath. On focus it gets a `--brand` border and a 3px `--brand` ring at 13% alpha.
- **Segmented control.** Used for the range picker (7d · 30d · All) and the Long/Short switch.
  - The selected range segment is `--panel` with `--head` text.
  - The selected side is filled: Long `--gain` with white text, Short `--loss-fill` with white text.
- **Buttons:**
  - Action: `--action` background, white text, 600 weight.
  - Ghost: `--panel` background with a `--line-strong` border.
  - X: `#0e1217` background, white text, used only for "Share on X".
- **Badge.** 12px, 600 weight, 6px radius, using the tints above.
- **Pill.** In `/evidence`: Stop close uses the `--brand` tint, Plan entry the `--action` tint.
- **Table.** Uppercase 12px headers in `--muted` with a `--line` bottom border; rows have a hairline `#e6ebf0` and a `#f7f9fb` hover; numeric columns are mono and right-aligned.
- **Breakdown row.** A label on the left, a mono value on the right, and a dashed `--line` between rows. The total row is 600 weight in `--head`.
- **WarnBox.** The warning tint, 12px text.
- **StepTracker.** Three equal cells. Done cells use the `--gain` tint with a ✓, the current cell uses the `--brand` tint with a ●, and pending cells use `--field` with `--muted` text.
- **LeakCard.** The leak tint. The title is 17px/600 with the amount in mono `--loss`. It has an action button (the [Fix]) and a ghost button "See trades".
- **Footer.** 11px, centered, `--muted`: "Independent tool for dreamDEX traders · not affiliated with dreamDEX".

## 6. Screens

### 6.1 Health Check (option A, "The gap")

The layout is a two-column grid (1.25fr / 1fr) that becomes one column below 860px.

**Left panel, the gap:**
- a range label and the 7d/30d/All control;
- two figures side by side:
  - "THE APP SHOWS (REALIZED)": `realizedPnlRaw`, 30px mono, colored by sign at 80% opacity;
  - "YOUR TRUE NET PNL": `netPnlRaw`, 48px mono, colored by sign, with a "USDso" suffix;
- a divider;
- "WHERE THE <|realized − net|> WENT" with breakdown rows:
  - Realized PnL;
  - Funding paid;
  - Liquidation fees;
  - Trading & builder fees, shown only when non-zero;
  - Net PnL, as the total row;
- the Reconciled badge (existing `ReconcileBadge` states, restyled), plus a block-number chip when reconciled.

**Right column:**
- the LeakCard for `topLeak`, with its existing [Fix] action;
- three StatTiles: Win rate, No stop (`--warn` when > 50%), Trades;
- the net equity chart: a `--brand-line` stroke with a dashed zero baseline in `--line-strong`, and no fill in this panel.

**Data rule (the builder must add this):**
- `HealthSummary` gains `liquidationFeesRaw` (Σ `costs.liquidationFee`) and `tradingFeesRaw` (Σ `costs.tradingFee + costs.builderFee`), over the same closed trades.
- The breakdown must sum exactly: `realized − fundingPaid − liquidationFees − tradingFees = net`.
- A core unit test pins this identity on the golden fixtures.
- The existing `liquidationCostRaw` (leak L1, which includes realized loss) must **not** be used in the breakdown.

### 6.2 Journal, Leaks, Positions, landing

These are re-skinned only.
- Trade cards and rows move to Panel and Table styles.
- Gains and losses use `--gain`/`--loss`, and numbers are mono.
- The Positions liquidation-distance bar uses `--loss-fill` when the distance is under 10% and `--brand` otherwise.
- LeakCard is shared with Health.
- The landing page keeps its structure: the address form becomes a Field plus an Action button, and the three platform stats become StatTiles.

### 6.3 Plan (P1, order ticket)

The layout is two columns (380px / 1fr) that become one column below 860px.

**Left panel, the form:**
- Market: a select showing the symbol, with "mark <price>" in mono on the right;
- Side: the Long/Short segmented control;
- "MAX LOSS IF THE STOP HITS": the risk Field in USDso, with the hint "<x>% of your <collateral> USDso collateral" when collateral is known;
- "STOP PRICE": a Field, with the hint "<x>% below the ask" for a long, or "above the bid" for a short.

**Right panel, the preview** (`data-testid="plan-quote"`):
- the label "PERPLOG SIZES IT FOR YOU";
- the size in 44px mono with "<base> · long|short";
- breakdown rows: Notional; Entry (IOC, worst price); Est. liquidation price; Est. leverage; "Risk if the stop hits" in `--loss`;
- warnings in a WarnBox, including the cap warning from Plan 3 Task 3. The funding-direction warning from the mockup is optional: add it only if a funding-rate read already exists, otherwise leave it out *(Claude's call)*;
- the Action button, labelled exactly **Place order**, with a secondary line under it: "long 0.0718 BTC · stop 63,900";
- a StepTracker after placing (`data-testid="plan-status"`): *Entry filled → Arming stop… → Protected*. A failure replaces the tracker with a WarnBox in loss colors, carrying the `entry_failed` copy;
- a note: "PerpLog's bot sends one market order with your linked bot key. If it does not fill, nothing is opened and no stop is armed."

When there is no quote yet or the quote fails, the preview shows the error in words (Plan 3 Task 6) in place of the numbers. There are never NaN or zero placeholders.

### 6.4 Report tab and weekly report card (R2, dark)

**The card** is the `next/og` PNG at 1200×630. It **always uses the dark tokens**, whatever the app theme:
- background `#0e1217`, with a faint diagonal `--brand` stripe in the top right;
- the wordmark (with "log" in `#20ccff`) and "WEEK OF <Mon DD> · DREAMDEX PERPS";
- "TRUE NET PNL THIS WEEK", with the net in about 112px mono (colored by sign: `#00fa89` or `#ec658d`) and "USDso";
- one sentence: "App showed **<realized>** realized · biggest leak: **<leak title> <amount>**", or "no leaks this week";
- four cells: Trades, Win rate, Funding, No stop;
- footer: "Reconciled to on-chain balance · Somnia testnet" on the left and "perplog · <short address>" on the right.

The OG route can only use fonts it loads itself. Commit the Geist and Geist Mono TTF files (SIL OFL) under `apps/web/assets/fonts/` and read them in the route; do not fetch them at request time. *(Claude's call.)*

**The Report tab** shows:
- the card image (`data-testid="report-image"`) in a panel;
- a week picker (‹ previous week · next week ›; "this week" is the default);
- the buttons **Share on X** (X style) and **Download PNG** (ghost).

### 6.5 `/evidence`

- A header panel: "Every order PerpLog sent, on-chain", with the subline "Sent by users' linked bot keys on Somnia Tokyo testnet (chain 50383). Nothing here is simulated."
- Four StatTiles: Transactions, Stop closes, Plan entries, **Median stop latency**.
- A table with the columns Time (UTC), Kind (pill), Market, Side (Buy `--gain` / Sell `--loss`), Filled, Avg price, Account (link to `/a/<address>`) and Tx (explorer link ↗, new tab). Each row has `data-testid="evidence-row"`.

**Median stop latency (new requirement):**
- For confirmed `stop_close` executions, take the median of `confirmed_at − stops.triggered_at`. Use `updated_at` of the confirmed execution as `confirmed_at`.
- `/api/executions` returns it as `totals.medianStopLatencyMs`, or `null` when there are no confirmed stop closes. A `null` value shows "—".
- It is computed in SQL or in core, and it is unit-tested.

### 6.6 `/how-it-works`

A single column of Panels with an `h2` each:
1. How linking proves ownership;
2. Why stops are bot-held;
3. What the bot may send (the invariant);
4. Limits.

Body text is 15px at line-height 1.6. Small diagrams are optional and can be cut.

## 7. Responsive and accessibility

- **Responsive:**
  - Below 860px every grid becomes one column, the nav links hide, and tabs scroll horizontally.
  - There is a 16px side gutter and no horizontal page scroll.
  - The Plan preview moves below the form.
- **Contrast (light):** these pairs are at or above the WCAG AA target and must stay so:
  - `--gain` `#1c634d` and `--loss` `#af0c3d` on white for text;
  - `--muted` `#404852` on white and on `#eef1f5`;
  - `--brand` `#137a99` on white, used for 12px and larger.
- **Focus:** keep the `:focus-visible` outline, now `--focus`.
- **Motion:** keep the existing `prefers-reduced-motion` rule.
- **Numbers carry their sign and unit,** so color is never the only signal of gain or loss.

## 8. Left to the builder

- The component file structure and names; Tailwind utility classes versus small CSS modules.
- Exact icon choice, if any icons are needed (none are required).
- The chart library styling details within Recharts, as long as the colors and the baseline match §6.1.
- The micro-copy of empty and error states not quoted here, in English and in the same terse tone.

## 9. Calls made by Claude (please check)

1. The inspiration is the dreamDEX **app**, not the landing page (mono-everything, near-black).
2. PerpLog's brand color is **cyan** (`#137a99` light / `#20ccff` dark), taken from the dreamDEX palette and distinct from their purple. The purple is kept only for primary actions.
3. The light tokens are dreamDEX's official light theme, brightened. **Gains are dark green on light surfaces, never neon mint.**
4. The dark theme follows `prefers-color-scheme` with dreamDEX's dark tokens. It is not designed or screenshotted separately.
5. Fonts: Geist and Geist Mono replace Schibsted Grotesk.
6. The anti-impersonation rules in §2 and the "not affiliated" footer.
7. The Health breakdown needs `liquidationFeesRaw` and `tradingFeesRaw`, and must not use the L1 leak amount.
8. The "Median stop latency" tile and how it is computed.
9. The Report tab gets a week picker and a "Download PNG" button.

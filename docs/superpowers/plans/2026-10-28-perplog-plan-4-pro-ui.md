# PerpLog Plan 4: Pro UI (dark trading-desk shell, Plan risk ladder, Health, Home) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo-looking UI with a dark trading-desk app: tokens and fonts, an account app shell with a
sidebar, a Plan page with a live book line and a risk ladder, and a redesigned Health and Home, without changing
product behavior.

**Architecture:**
- Tokens live in `globals.css` (dark only) and fonts in `app/layout.tsx`; components keep using token utilities.
- The root layout drops its global NavBar/Footer. Non-account pages wrap themselves in `SiteChrome`
  (top bar + footer), and `AccountView` renders `AppShell` (sidebar/top bar/footer).
- Ladder geometry and stop shortcuts are pure functions in `apps/web/lib/ladder.ts` (unit-tested); the SVG
  component only draws what they return.
- One new read-only route, `GET /api/markets/[pool]/book`, wraps the existing `chain.bookTop`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, TanStack Query, recharts, `next/font/google`
(IBM Plex Sans / IBM Plex Mono), Vitest, Playwright, Biome.

**Spec:** `docs/specs/2026-10-28-perplog-pro-ui-design.md` (approved 2026-10-28). Read `CLAUDE.md` first.

## Global Constraints

- No behavior change: sizing, placing, arming, reconciliation and every API answer stay as they are. The only
  backend addition is `GET /api/markets/[pool]/book` (spec §6.3).
- `apps/web` never imports `@perplog/db/crypto`, `@perplog/chain/signer` or a viem wallet client. Without
  `DATABASE_URL` the app stays read-only and hides Protect/Watch/Place and the bot chip.
- Raw prices are `bigint` with `PRICE_DECIMALS` (18); format with `formatAmount(raw, PRICE_DECIMALS,
  stepDecimals(tickSize, PRICE_DECIMALS))`. Never hardcode ticks, lots or decimals.
- Dark only: no `prefers-color-scheme` block, no theme switcher. Body background is `#10151c` = `rgb(16, 21, 28)`.
- Colors only through tokens (spec §4); no raw hex in components, no `text-white`, no `bg-gradient-*`.
- Fonts: IBM Plex Sans for UI and every number (`tabular-nums`); IBM Plex Mono only for addresses and tx hashes.
- Labels are sentence case: no `uppercase`, no `tracking-[…]` on labels.
- Panels: 1px `--line` border, `rounded-[10px]`, no shadow. Inputs/buttons `rounded-lg`. Sidebar and top bars
  have no radius.
- Motion: only the ladder's ≈200ms ease-out glide, plus existing hover/focus; reduced motion is already global.
- No new runtime dependencies besides the two Google fonts. Icons are inline SVG; the ladder is hand-written SVG.
- Every string and `data-testid` used in `apps/web/e2e` stays (spec §10 lists them). Each DOM element that e2e
  locates by text or role exists **once** per page: the wordmark link `perplog` and the disclaimer are never
  rendered twice and hidden with CSS.
- The disclaimer reads exactly "Independent tool for dreamDEX traders · not affiliated with dreamDEX".
- English everywhere; work on branch `feat/pro-ui`; Biome line width 110, double quotes.
- Verification command (CLAUDE.md): `pnpm lint && pnpm -r typecheck && pnpm test && (cd apps/web && pnpm exec
  playwright test) && pnpm --filter @perplog/web build`. Stop any stale server on port 3200 before e2e.

## Review Focus

1. **Book unavailable** (route 400/500, or `bestBid`/`bestAsk` null): the ticket shows "—" for that side, stop
   chips for that side are hidden, and typing risk + stop still quotes. → Task 6 e2e
   `book failure does not block quoting`.
2. **No liquidation estimate** (`liqPriceEst: null`): the ladder has no liquidation mark and no buffer bracket;
   the summary shows "—". → Task 5 unit test `omits liquidation and buffer when liqPriceEst is null`.
3. **Short side:** stop and liquidation sit above the entry, chips read `+1% …` from the best bid and snap up to
   the tick. → Task 5 unit tests `short shortcut ceils to the tick` and `short marks order`.
4. **Degenerate scale** (all prices equal, or only one price known): the scale stays finite, no `NaN`/`Infinity`
   in SVG attributes. → Task 5 unit test `scale with equal prices is finite`.
5. **390px wide Plan page:** the three columns stack and the SVG never causes horizontal scroll. → Task 7 adds
   `?tab=plan` to the 390px test in `e2e/design.spec.ts`.

---

### Task 1: Dark tokens, fonts and primitives

**Files:**
- Modify: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/components/ui.tsx`
- Modify (replace `text-white` / gradient): `components/trade-card.tsx:14`, `components/protect-form.tsx:149`,
  `components/health-panel.tsx:114,131`, `components/address-form.tsx:41`, `components/report-panel.tsx:71`,
  `components/leak-card.tsx:68`, `app/r/[address]/[week]/page.tsx:46`
- Test: `apps/web/e2e/design.spec.ts`

**Interfaces:**
- Produces: Tailwind token utilities `page panel field line line-strong head text muted gain loss loss-fill warn
  brand brand-line brand-ink action action-hover action-ink focus testnet testnet-bg testnet-line x`;
  `--font-sans` = Plex Sans, `--font-mono` = Plex Mono. `Num` renders sans `tabular-nums`.

- [ ] **Step 1: Write the failing test.** In `e2e/design.spec.ts` replace the light-background test with:

```ts
test("the page background is rgb(16, 21, 28)", async ({ page }) => {
  await page.goto("/");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(16, 21, 28)");
});
```

- [ ] **Step 2: Run it to see it fail.** `cd apps/web && pnpm exec playwright test e2e/design.spec.ts -g "background"` → FAIL (`rgb(238, 241, 245)` or the dark-media value).

- [ ] **Step 3: Tokens.** Replace both `:root` blocks with one `:root` holding the spec §4 values, plus
  `--brand-line: #20ccff`, `--action: #20ccff`, `--action-hover: #5cdbff`, `--action-ink: #04222c`,
  `--brand-ink: #04222c`, `--focus: #20ccff`, `--testnet: #ff66e6`, `--testnet-bg: #3d0a35`,
  `--testnet-line: #7a1f6c`, `--x: #000000`. Add `--color-brand-ink` and `--color-action-ink` to `@theme inline`.
  Set `color-scheme: dark` on `:root`. Point `--font-sans`/`--font-mono` at `--font-plex-sans`/`--font-plex-mono`.

- [ ] **Step 4: Fonts.** In `layout.tsx` swap `Geist`/`Geist_Mono` for `IBM_Plex_Sans` (weights 400/500/600,
  variable `--font-plex-sans`) and `IBM_Plex_Mono` (weights 400/500, `--font-plex-mono`).

- [ ] **Step 5: Primitives in `ui.tsx`.**
  - `Panel`: `rounded-[10px] border border-line bg-panel p-5`.
  - `Label` and the `Field` label: `text-muted text-[13px]` (drop `uppercase tracking-[0.3px]`).
  - `Num`: replace `font-mono` with `tabular-nums` (keep the `tone` logic).
  - `Segmented` side fills: `bg-gain text-page` / `bg-loss-fill text-page`.
  - `BUTTON.action`: `bg-action text-action-ink hover:bg-action-hover`.
  - `StatTile` value: drop `font-mono`.
  - Every listed `bg-action … text-white` becomes `text-action-ink`; `bg-loss-fill text-white` becomes
    `text-page`; the `bg-x text-white` buttons keep white text through a new `text-head` (≥4.5:1 on black).
  - Health top-leak: drop `bg-gradient-to-b from-loss/10 to-panel`, use `bg-panel` (Task 3 restyles it fully).

- [ ] **Step 6: Run the design spec.** `pnpm exec playwright test e2e/design.spec.ts` → all pass.

- [ ] **Step 7: Commit.** `git commit -am "feat(web): dark trading-desk tokens, IBM Plex, sentence-case labels"`

### Task 2: Site chrome and account app shell

**Files:**
- Create: `apps/web/components/icons.tsx`, `apps/web/components/site-chrome.tsx`,
  `apps/web/components/app-shell.tsx`, `apps/web/components/bot-chip.tsx`, `apps/web/components/copy-address.tsx`
- Modify: `apps/web/app/layout.tsx` (remove `NavBar`/`Footer`), `apps/web/components/ui.tsx` (delete `NavBar`;
  keep `Wordmark`, `Footer`), `apps/web/components/account-view.tsx`, `apps/web/app/a/[address]/page.tsx`,
  `apps/web/app/page.tsx`, `apps/web/app/evidence/page.tsx`, `apps/web/app/how-it-works/page.tsx`,
  `apps/web/app/r/[address]/[week]/page.tsx`
- Test: `apps/web/e2e/shell.spec.ts` (new)

**Interfaces:**
- Produces:
  - `SiteChrome({ children }: { children: ReactNode })`: 56px full-width top bar (`Wordmark`, Testnet `Badge`,
    links Evidence, How it works), `children` in a `max-w-[1200px]` container, then `Footer`.
  - `AppShell({ address, tab, tabs, href, rangeControl, children })` where `tabs: ReadonlyArray<{ value: Tab;
    label: string }>`, `href: (next: { tab?: Tab }) => string`, `rangeControl: ReactNode | null`.
  - `BotChip({ account }: { account: Address })`: hidden when `useProtectionAvailable()` is false.
  - `CopyAddress({ address }: { address: Address })`: mono short address + copy button; after copying shows
    "Copied" for 1.5s; a rejected `navigator.clipboard.writeText` is swallowed.
  - `icons.tsx`: `HealthIcon JournalIcon LeaksIcon PositionsIcon PlanIcon ReportIcon` (16px, `currentColor`,
    `aria-hidden`).

- [ ] **Step 1: Write the failing tests** in `e2e/shell.spec.ts`:

```ts
const ACCOUNT = "/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all";

test("account sections nav marks the current tab", async ({ page }) => {
  await page.goto(`${ACCOUNT}&tab=journal`);
  const nav = page.getByRole("navigation", { name: "Account sections" });
  await expect(nav.getByRole("link", { name: "Journal" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/tab=plan/);
});

test("copy button copies the full address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(ACCOUNT);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(page.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "0x395225eab84c1b9304d42cb647238dcc90003951",
  );
});

test("without a database the bot chip is hidden", async ({ page }) => {
  await page.goto(ACCOUNT);
  await expect(page.getByTestId("bot-chip")).toHaveCount(0);
});

test("non-account pages have the site top bar and footer", async ({ page }) => {
  for (const url of ["/", "/evidence", "/how-it-works"]) {
    await page.goto(url);
    await expect(page.getByRole("link", { name: "perplog", exact: true })).toHaveAttribute("href", "/");
    await expect(page.getByText("Independent tool for dreamDEX traders · not affiliated with dreamDEX")).toBeVisible();
  }
});
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec playwright test e2e/shell.spec.ts` → FAIL (no "Copy address").

- [ ] **Step 3: Implement `SiteChrome`** and wrap `/`, `/evidence`, `/how-it-works`, `/r/[address]/[week]` and the
  invalid-address branch of `/a/[address]` in it. Remove `NavBar`/`Footer` from the root layout and delete
  `NavBar` from `ui.tsx`.

- [ ] **Step 4: Implement `AppShell`** as one DOM tree that changes layout with CSS (so nothing renders twice).
  The disclaimer `Footer` sits at the bottom of the content column at every width (not in the sidebar), so it
  exists once; the spec text is updated to match.
  - `≥lg`: grid `grid-cols-[232px_minmax(0,1fr)]`. Left `<aside>` sticky `h-dvh`, `bg-panel`, right hairline:
    wordmark + Testnet badge; `<nav aria-label="Account sections">` with one link per tab (icon + label;
    current = `aria-current="page"`, `bg-field`, 2px `brand` left bar); hairline; Evidence, How it works.
  - `<lg`: the same `<aside>` becomes a sticky top header: row 1 wordmark, badge, Evidence, How it works; row 2
    the same nav as a horizontally scrollable row (`overflow-x-auto`).
  - Right column: sticky 56px top bar (`CopyAddress`, `WatchButton`, spacer, `rangeControl`, `BotChip`; wraps
    under `sm`), then `<main>` with `px-4 sm:px-6 lg:px-8 py-6`, `max-w-[1600px]`, then `Footer`.
  - Tab links keep `scroll={false}` and the existing `?tab=&range=` URLs.

- [ ] **Step 5: Implement `BotChip`** with `data-testid="bot-chip"`: linked to this account →
  `● Protected` in `text-brand`, `title` = bot address; otherwise a link to `?tab=plan` reading
  `○ Protection off` in `text-muted`.

- [ ] **Step 6: Rewire `AccountView`** to render `AppShell` (drop its own header, tabs nav and outer padding;
  the range `nav aria-label="Time range"` becomes `rangeControl`, shown on the same tabs as today).
  `/a/[address]/page.tsx` stops wrapping valid accounts in `max-w-5xl`.

- [ ] **Step 7: Run shell + design + health + alerts specs.** `pnpm exec playwright test e2e/shell.spec.ts e2e/design.spec.ts e2e/health.spec.ts e2e/alerts.spec.ts` → all pass.

- [ ] **Step 8: Commit.** `git commit -m "feat(web): account app shell with sidebar, site chrome for other pages"`

### Task 3: Measurement bracket and Health redesign

**Files:**
- Create: `apps/web/components/measure-bracket.tsx`, `apps/web/lib/breakdown.ts`, `apps/web/lib/breakdown.test.ts`
- Modify: `apps/web/components/health-panel.tsx`, `apps/web/components/equity-chart.tsx`
- Test: `apps/web/e2e/health.spec.ts`

**Interfaces:**
- Produces:
  - `MeasureBracket({ top, bottom, label, size }: { top: ReactNode; bottom: ReactNode; label: ReactNode; size?:
    "lg" | "md" })`: `top` and `bottom` stacked, left-aligned, with a `brand` bracket (1.5px, square ends)
    spanning them on the right and `label` beside the bracket. Used again in Task 4.
  - `gapSegments(parts: Array<{ label: string; raw: bigint }>): Array<{ label: string; raw: bigint; share:
    number }>`: drops zero parts; `share` = |raw| / Σ|raw| (0..1, sums to 1); empty input → `[]`.
  - `signedUsd(raw: bigint): string` moved from `health-panel.tsx` into `lib/format.ts` (`"+412.50"` /
    `"−86.20"`, U+2212 minus).

- [ ] **Step 1: Failing unit tests** in `lib/breakdown.test.ts`: `gapSegments([{label:"Funding paid",raw:4n},
  {label:"Liquidation fees",raw:-187n}])` → shares `4/191` and `187/191`; zero parts dropped; all-zero → `[]`.

- [ ] **Step 2: Run** `pnpm vitest run apps/web/lib/breakdown.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `gapSegments`, `signedUsd`, `MeasureBracket`.**

- [ ] **Step 4: Run the unit tests** → PASS.

- [ ] **Step 5: Failing e2e.** Add to the first test in `health.spec.ts`:
  `await expect(gap).toContainText("not shown by the app");`. Run → FAIL.

- [ ] **Step 6: Rebuild `HealthPanel`** per spec §7.1:
  - Gap band (one `Panel`, full width): top row range label + trade count left, `ReconcileBadge` and
    "Data as of …" right. `data-testid="health-gap"` wraps a `MeasureBracket` with top = "The app shows
    (realized)" + `signedUsd(realized)` at 28px `text-muted`, bottom = "Your true net PnL" + `signedUsd(net)` at
    44px toned by sign + "USDso", label = `` `${signedUsd(net - realized)} not shown by the app` ``.
  - Under a hairline: "Where the {abs gap} went" (existing label text), a 10px rounded bar of
    `gapSegments([funding, liquidation fees, trading fees])` segments (`bg-loss` when the signed value is < 0,
    `bg-gain` otherwise, `title` = label + value), then `data-testid="health-breakdown"` with the existing rows,
    laid out as a two-column grid on `≥md`.
  - Below: `grid lg:grid-cols-[2fr_1fr]`: equity chart panel; right column = top-leak panel (keeps
    `data-testid="top-leak"`, copy and both links; no gradient) and one panel with the three stats as inline
    cells separated by vertical hairlines.
- [ ] **Step 7: Restyle `EquityChart`**: height `h-80`, drop `lg:col-span-2`, `CartesianGrid` with
  `stroke="var(--line)"`, tooltip `contentStyle` `{ background: "var(--panel)", border: "1px solid
  var(--line)", color: "var(--text)" }`, caption sentence case unchanged.

- [ ] **Step 8: Run** `pnpm exec playwright test e2e/health.spec.ts e2e/journal-leaks.spec.ts` → PASS.

- [ ] **Step 9: Commit.** `git commit -m "feat(web): Health gap band with measurement bracket, wide equity chart"`

### Task 4: Home redesign

**Files:**
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/e2e/health.spec.ts` (landing test) or `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `MeasureBracket` (Task 3), `SiteChrome` (Task 2).

- [ ] **Step 1: Failing e2e** in `shell.spec.ts`:

```ts
test("home explains the three steps and links to how it works", async ({ page }) => {
  await page.goto("/");
  const steps = page.getByRole("list", { name: "How PerpLog works" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.getByRole("link").first()).toHaveAttribute("href", "/how-it-works");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Rebuild the page** per spec §8: same headline, body, `AddressForm`; container `max-w-[1200px]`,
  left-aligned. Sample figure = `MeasureBracket` (top "App shows −609.70", bottom "True net −796.80", label
  "−187.10"), then the existing caption sentence. Stats: number on its own line at 28px `text-head`, sentence
  under it. Then `<ol aria-label="How PerpLog works">` with three numbered items: "Check your real PnL",
  "Plan a sized entry", "Let PerpLog hold the stop", each with one plain sentence and a "How it works" link to
  `/how-it-works`.

- [ ] **Step 4: Run** `pnpm exec playwright test e2e/shell.spec.ts e2e/health.spec.ts e2e/design.spec.ts` → PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(web): home with measured sample and three-step strip"`

### Task 5: Book route and ladder geometry

**Files:**
- Create: `apps/web/app/api/markets/[pool]/book/route.ts`, `apps/web/app/api/markets/book.test.ts`,
  `apps/web/lib/ladder.ts`, `apps/web/lib/ladder.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/markets/[pool]/book` → `200 { bestBid: string | null, bestAsk: string | null }`, `400 { error:
    "unknown_pool" }` for a pool not in `chain.markets()` (compare with `normalizeAddress`), header
    `Cache-Control: no-store`, wrapped in `handleRoute`.
  - `stopShortcut(side: "long" | "short", book: { bestBid: bigint | null; bestAsk: bigint | null }, pct: number,
    tickSize: bigint): bigint | null`: long → `bestAsk·(100−pct)/100` floored to the tick; short →
    `bestBid·(100+pct)/100` ceiled to the tick; `null` when that side is missing. Integer math only
    (`pct` is 1, 2, 3 or 5).
  - `type LadderMark = { kind: "entry" | "ref" | "stop" | "liq" | "bid" | "ask"; price: bigint }`
  - `ladderMarks(q: { refPrice: bigint; priceBound: bigint; stopPrice: bigint; liqPriceEst: bigint | null } |
    null, book: { bestBid: bigint | null; bestAsk: bigint | null }): LadderMark[]`: no quote → only bid/ask.
  - `type LadderBracket = { from: bigint; to: bigint; kind: "loss" | "buffer" }`;
    `ladderBrackets(q): LadderBracket[]`: entry(`priceBound`)→stop always; stop→liq only when `liqPriceEst`.
  - `ladderScale(prices: bigint[], height: number, pad = 0.12): { y(price: bigint): number; ticks: bigint[] }`:
    linear, higher price → smaller y; 4–6 ticks at 1/2/5×10ⁿ steps; equal or single price → a domain of ±1% of
    that price; no prices → `ticks: []` and `y` returns `height / 2`.
  - `pctOf(a: bigint, b: bigint): number`: |a−b| / a × 100, as a Number with 2 decimals of precision.

- [ ] **Step 1: Failing route tests** in `book.test.ts` (mock `@/lib/chain` as `plans.test.ts` does): known pool
  → 200 with decimal strings; null sides → `null`; unknown pool → 400 `unknown_pool`; `bookTop` rejects with
  `ChainUnavailableError` → 503 `{ error: "chain_unavailable" }` (from `handleRoute`).

- [ ] **Step 2: Failing geometry tests** in `ladder.test.ts`:
  - `long shortcut floors to the tick`: ask 1.206 (tick 0.001) −2% → 1.181 (×10¹⁸).
  - `short shortcut ceils to the tick`: bid 1.204 +3% → 1.241 (1.24012 ceiled).
  - `shortcut is null when the side is missing`.
  - `short marks order`: for a short quote, y(stop) < y(entry) and y(liq) < y(stop).
  - `omits liquidation and buffer when liqPriceEst is null`: no `liq` mark, one bracket (`loss`).
  - `scale with equal prices is finite`: every `y` and tick is finite; ticks non-empty.
  - `ticks are round`: for 0.98–1.30 every tick is a multiple of 0.05 or 0.1 (×10¹⁸).

- [ ] **Step 3: Run** `pnpm vitest run apps/web/lib/ladder.test.ts apps/web/app/api/markets/book.test.ts` → FAIL.

- [ ] **Step 4: Implement the route and `lib/ladder.ts`.** For the scale, convert prices to Number via
  `Number(price / 10n ** 10n) / 1e8` (keeps 8 decimals, safe for display) before the linear map.

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit.** `git commit -m "feat(web): read-only book route and ladder geometry"`

### Task 6: Plan page: ticket, book line, shortcuts, protection strip, summary

**Files:**
- Create: `apps/web/components/plan/ticket.tsx`, `apps/web/components/plan/book-line.tsx`,
  `apps/web/components/plan/plan-summary.tsx`, `apps/web/components/plan/protection-strip.tsx`,
  `apps/web/lib/use-book.ts`
- Modify: `apps/web/components/plan-panel.tsx` (becomes the orchestrator: state, queries, mutation; layout only)
- Test: `apps/web/e2e/plan.spec.ts`

**Interfaces:**
- Consumes: `stopShortcut` (Task 5), `GET /api/markets/[pool]/book`.
- Produces:
  - `useBook(pool: string | null): { bestBid: bigint | null; bestAsk: bigint | null }`: TanStack Query, key
    `["book", pool]`, `refetchInterval: 5_000`, `refetchIntervalInBackground: false`, `retry: false`; any error
    → both null.
  - `PlanSummary` takes the existing `QuoteView`, `market`, `side` and renders today's breakdown (same labels,
    same formatting) with the size at 44px.
  - `ProtectionStrip({ available, session, address, botAddress })` renders the four states of spec §6.6, reusing
    `LinkWizard` and today's warning copy.
  - `Ticket` holds the market select, `BookLine`, side, both fields, stop chips, and the `PlaceBlock` (moved from
    `plan-panel.tsx`, unchanged logic) under a hairline.

- [ ] **Step 1: Failing e2e** in `plan.spec.ts`. Extend `mockPlan` with `book?: "ok" | "fail"` (default `"ok"`)
  routing `**/api/markets/*/book` to `{ bestBid: (64_200n*E18).toString(), bestAsk: (64_250n*E18).toString() }`
  or status 500. New tests:

```ts
test("ticket shows the live bid and ask and a stop shortcut fills the stop", async ({ page }) => {
  await mockPlan(page);
  await open(page);
  await expect(page.getByTestId("book-line")).toContainText("64,200");
  await expect(page.getByTestId("book-line")).toContainText("64,250");
  await page.getByRole("button", { name: "−2%" }).click();
  // 64,250 × 0.98 = 62,965 at tick 0.1: written without separators, at tick decimals, so it stays editable.
  await expect(page.getByLabel("Stop price")).toHaveValue("62965.0");
});

test("book failure does not block quoting", async ({ page }) => {
  await mockPlan(page, { book: "fail" });
  await open(page);
  await expect(page.getByTestId("book-line")).toContainText("—");
  await expect(page.getByRole("button", { name: "−2%" })).toHaveCount(0);
  await page.getByLabel("Max loss if the stop hits").fill("25");
  await page.getByLabel("Stop price").fill("63900");
  await expect(page.getByTestId("plan-quote")).toContainText("0.0718");
});
```

  The shortcut writes `formatAmount(price, PRICE_DECIMALS, priceDp)` with the commas removed.

- [ ] **Step 2: Run** `pnpm exec playwright test e2e/plan.spec.ts` → the two new tests FAIL, old ones pass.

- [ ] **Step 3: Implement** `useBook`, `BookLine` (`data-testid="book-line"`, "Bid" / "Ask" with prices at tick
  decimals, "—" when null), the chips (`−1% −2% −3% −5%` long / `+1% +2% +3% +5%` short, real minus sign
  U+2212, hidden when `stopShortcut` returns null), the stop hint with the live price ("Below the current ask
  (64,250.0)."), `PlanSummary`, `ProtectionStrip`, and the new `PlanPanel` layout:
  strip on top; `grid xl:grid-cols-[380px_minmax(0,1fr)_300px] lg:grid-cols-[380px_minmax(0,1fr)]`; the center
  column holds a placeholder `<div>` for the ladder (Task 7) and, below `xl`, the summary. `data-testid=
  "plan-quote"` wraps the center and summary so quoted values stay inside it. Quote error copy stays in
  `plan-quote`.

- [ ] **Step 4: Run** `pnpm exec playwright test e2e/plan.spec.ts e2e/protect.spec.ts` → all PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(web): Plan ticket with live book, stop shortcuts, protection strip"`

### Task 7: Risk ladder

**Files:**
- Create: `apps/web/components/plan/risk-ladder.tsx`
- Modify: `apps/web/components/plan-panel.tsx` (replace the placeholder), `apps/web/e2e/plan.spec.ts`,
  `apps/web/e2e/design.spec.ts`

**Interfaces:**
- Consumes: `ladderMarks`, `ladderBrackets`, `ladderScale`, `pctOf` (Task 5); `QuoteView`, `useBook` (Task 6).
- Produces: `RiskLadder({ quote, book, market, side, maxLossRaw, updating, error }: { quote: QuoteView | null;
  book: { bestBid: bigint | null; bestAsk: bigint | null }; market: Wire<MarketInfo>; side: Side; maxLossRaw:
  bigint | null; updating: boolean; error: string | null })`.

- [ ] **Step 1: Failing e2e** in `plan.spec.ts`, inside `quote updates as risk and stop change` after the first
  quote:

```ts
const ladder = page.getByRole("img", { name: /Entry .* stop .* liquidation/i });
await expect(ladder).toBeVisible();
await expect(quote).toContainText("Stop · held by PerpLog");
await expect(quote).toContainText("Liquidation (est.)");
```

  and in `design.spec.ts` add `` `${ACCOUNT}&tab=plan` `` to the 390px URL list.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `RiskLadder`** per spec §6.4: measure width with a `ResizeObserver`, fixed height
  `max(360, container)`; left axis ticks from `ladderScale` at tick decimals; full-width rules per mark (entry
  `--head` solid, ref short tick labeled "ref", stop `--brand` 2px labeled "Stop · held by PerpLog", liq `--loss`
  dashed labeled "Liquidation (est.)", bid/ask faint `--muted` axis ticks); brackets on the right in `--brand`
  (loss: `−{maxLoss} USDso` and `{pctOf}%`; buffer: `Buffer {pctOf}%`). `<svg role="img" aria-label=…>` summarizing
  "Entry X, stop Y, liquidation Z, max loss W". Rules and labels move with `transition: transform 200ms
  ease-out` (positions via `transform`, not `y`). States: no quote → bid/ask only + centered "Set your max loss
  and stop to see the plan."; `updating` → `opacity-60` + "Updating…"; `error` → the `WarnBox` from
  `QUOTE_ERRORS` in place of the SVG. `maxLossRaw` is the quote's `effectiveRiskRaw`.

- [ ] **Step 4: Run** `pnpm exec playwright test e2e/plan.spec.ts e2e/design.spec.ts` → PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(web): Plan risk ladder with measured loss and buffer"`

### Task 8: Dark pass on the other screens, screenshots, full verification

**Files:**
- Modify as needed: `components/journal-panel.tsx`, `trade-card.tsx`, `leaks-panel.tsx`, `leak-card.tsx`,
  `positions-panel.tsx`, `protect-form.tsx`, `link-wizard.tsx`, `report-panel.tsx`, `evidence-table.tsx`,
  `alert-toasts.tsx`, `empty-state.tsx`, `error-state.tsx`, `app/how-it-works/page.tsx`,
  `app/r/[address]/[week]/page.tsx`

- [ ] **Step 1: Static check.** `cd apps/web && grep -rnE "text-white|bg-white|bg-gradient|uppercase|#[0-9a-fA-F]{3,6}\b" components app --include='*.tsx' | grep -v "app/api/og"` → no matches (fix each hit with a token).

- [ ] **Step 2: Screenshot review.** Start the fixture server (`cd apps/web && PERPLOG_FIXTURE_DIR=../../packages/core/test/fixtures DATABASE_URL= pnpm next dev -p 3200`) and capture, at 1440×900 and 390×844: `/`, `/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all` with each tab, `/evidence`, `/how-it-works`. Fix anything unreadable, clipped or still light-themed. Layouts of these screens stay as they are.

- [ ] **Step 3: Full verification.** Run the CLAUDE.md full check (Global Constraints) → every step passes.

- [ ] **Step 4: Commit.** `git commit -am "fix(web): dark pass on journal, leaks, positions, report, evidence, how it works"`

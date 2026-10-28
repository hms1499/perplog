# X post drafts

Three drafts for the submission. Each tags @DreamDEXSomnia. Numbers marked **[fill]** come from `/evidence`
after the live run; every other number is sourced below. Post them yourself, then paste the links into the
README's "X posts" section.

## 1. The problem (data)

> 77% of new perps positions on @DreamDEXSomnia testnet had no stop-loss 10 minutes after opening.
> Traders paid 147,313 USDso in liquidation fees in 7 days.
>
> The "realized PnL" in the app leaves out funding and liquidation fees. So I built PerpLog: paste an address,
> see your true net PnL, reconciled to the chain. [link]

Sources: `apps/web/data/platform-stats.json` (generated 2026-10-25): 896 new positions by 351 real traders in a
9.3 h window; liquidation fees summed over 7 days across 572 accounts. Methodology in the README.

## 2. The fix (product)

> Your dreamDEX perps journal can look green while your balance is red.
>
> One liquidated testnet account: realized −1,431.15, true net −1,700.23 USDso after liquidation fees.
>
> PerpLog shows the gap, the leak, and fixes it: bot-held stop-losses + Plan & Place (risk-sized entry with its
> stop attached). @DreamDEXSomnia [link]

Source: account `0x395225eab84c1b9304d42cb647238dcc90003951`, golden fixture, Health tab "All time".

## 3. The proof (evidence)

> **[fill]** real orders sent by PerpLog's bots on Somnia testnet: stop closes and risk-sized entries, every one
> on the explorer. Median stop latency: **[fill]** s.
>
> Weekly report card below 👇 @DreamDEXSomnia [link to /evidence] [attach the Report PNG]

Source: `/evidence` totals on the live app at posting time.

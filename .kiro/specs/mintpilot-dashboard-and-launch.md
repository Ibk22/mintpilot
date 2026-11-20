# Spec: MintPilot dashboard + agent launch flow

Status: starter spec (Kiroween 2026, build window 30 Oct – 4 Dec 2026).
This spec covers the first two core features from the concept, in build order:
the live dashboard first, then the launch wizard with the agent loop.

## 1. Live dashboard

### Requirements

- Show every collection the owner operates on BNB Chain in one screen.
- For each collection, read live from BSC (read-only):
  - minted count (total supply against the collection's max supply),
  - contract balance (BNB waiting in the contract),
  - mint velocity: mint events (ERC-721 `Transfer` from the zero address)
    over the trailing 7 days, divided by 7, shown as mints/day. Counted via
    `eth_getLogs` in chunks (one query per chunk covers every collection).
    If no configured RPC endpoint serves `eth_getLogs`, velocity is shown
    as unavailable rather than estimated from other data.
- A revenue panel with two parts:
  - what is waiting across all contracts right now (live balances), with the
    per-contract breakdown in the table;
  - estimated lifetime mint revenue per collection and in total. Mint
    revenue is swept out by `withdraw()`, so it cannot be read from
    balances; it is derived as paid mints × current mint price, where paid
    mints = `totalSupply` − `freeClaimed` (the template gives each wallet
    one free first mint, and `freeClaimed` counts them). The panel labels
    this an estimate: the price is owner-adjustable, and secondary-sale
    royalties bypass the contract entirely (marketplaces pay the payout
    address directly), so royalties are not counted. Collections whose
    contracts do not expose `price()`/`freeClaimed()` show revenue as
    unavailable and are excluded from the totals.
- The dashboard replaces the manual nightly counts the owner currently asks
  for by hand; numbers must come from chain reads, never from cached or
  hand-entered figures.
- Read-only on mainnet: the dashboard never signs, sends or sweeps anything.

### Design notes

- Collection registry: the live collection contract addresses in
  `collections.json` (34 collections at the 2026-11-20 reconciliation) are
  pre-existing assets (disclosed in the submission); the app reads them, it
  did not create them.
- Data source: BSC RPC reads (supply, balance, `price`, `freeClaimed`) plus
  recent mint events for velocity. The free Binance dataseed endpoint
  refuses `eth_getLogs` and prunes historical state, so velocity needs a
  log-capable endpoint in `BSC_RPC`; everything else works on the default.

## 2. Launch wizard + agent loop (agent deploy flow)

### Requirements

- Each night, the agent prepares tonight's launch package by itself:
  - next theme from the launch theme queue,
  - pixel art for the collection,
  - metadata,
  - contract initcode built from the owner's standard template,
  - the predicted CREATE2 address of the new collection.
- The package is presented to the owner for one approval before anything is
  broadcast.
- **Judge mode:** the same flow deploys for real on BSC testnet, so judges
  can trigger a full deploy themselves.
- **Mainnet:** the app prepares only. Broadcasting stays in the owner's
  Binance wallet flow — the app prepares, the wallet signs. There is no
  in-app wallet signing and no sweeping of real funds.

### Design notes

- The contract template used by the wizard (template-withdrawable standard)
  predates the hackathon and is disclosed as a pre-existing asset; the
  wizard, agent loop and dashboard are new work.

## 3. Insights feed (v1, rule-based)

- Plain-language notes generated from dashboard data, e.g. "Dragon is
  minting twice as fast as Pixiu", "0.0008 BNB is waiting in Pixiu".
- Rule-based for v1; a fuller explainer only if time remains in week 3.

## Out of scope for this spec

- In-app signing or sweeping of real funds.
- Any chain other than BSC.
- A chat interface for the agent.

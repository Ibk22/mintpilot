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
  - mint velocity (mints over a recent window, so fast and slow collections
    can be compared at a glance).
- A revenue panel totals what is waiting across all contracts and shows the
  per-contract breakdown.
- The dashboard replaces the manual nightly counts the owner currently asks
  for by hand; numbers must come from chain reads, never from cached or
  hand-entered figures.
- Read-only on mainnet: the dashboard never signs, sends or sweeps anything.

### Design notes

- Collection registry: the 15 live collection contract addresses are
  pre-existing assets (disclosed in the submission); the app reads them, it
  did not create them.
- Data source: BSC RPC reads (supply, balance) plus recent mint events for
  velocity.

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

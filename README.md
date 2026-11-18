# MintPilot

MintPilot is an AI agent console that runs an NFT collection business on BNB Chain: it monitors every collection live, prepares each night's launch by itself for the owner's approval, and tracks all revenue in one place — the exact operation its owner already runs by hand every night, turned into one app. It manages a live operation of 15 collections with 8,667 mints counted on 2026-11-13 and real paid-mint revenue already earned and swept on chain.

## What it does

1. **Live dashboard** — every collection's minted count, contract balance and mint velocity, read live from BSC, with a revenue panel showing what is waiting in each contract.
2. **Launch wizard + agent loop** — the agent prepares tonight's launch package by itself: theme from the queue, pixel art, metadata, initcode and the predicted CREATE2 address, presented for one approval. In judge mode the same flow deploys for real on BSC testnet. On mainnet, broadcasting stays in the owner's Binance wallet flow — the app prepares, the wallet signs.
3. **Insights feed** — plain-language notes from the agent (for example, "Dragon is minting twice as fast as Pixiu", "0.0008 BNB is waiting in Pixiu"). Rule-based for v1.

## Deliberately out of scope

- No in-app wallet signing or sweeping of real funds.
- BSC only — depth on one chain, no second chain.
- No chat interface for the agent in v1.

## Hackathon note

MintPilot is a new project built for **Kiroween 2026** (Devpost), category **Frankenstein** — an AI agent, smart contracts and a live ops dashboard stitched into one tool. The app, dashboard and agent layer are new work built in the submission window (30 October – 4 December 2026) using Kiro; the `/.kiro` directory at the root of this repo holds the specs and steering docs that drive the build.

**Disclosure of pre-existing work:** the NFT contract template (the template-withdrawable standard) and the 15 live collections predate the hackathon. They are pre-existing assets that this new app manages, and they are disclosed as such in the submission.

## Licence

MIT — see [LICENSE](LICENSE).

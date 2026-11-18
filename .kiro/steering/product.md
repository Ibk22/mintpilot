# MintPilot — product steering

## What MintPilot is

MintPilot is an AI agent console that runs an NFT collection business on BNB
Chain: it monitors every collection live, prepares each night's launch by
itself for the owner's approval, and tracks all revenue in one place. It
turns a real, hand-run nightly operation — 15 live collections, 8,667 mints
counted 2026-11-13, real paid-mint revenue already earned and swept on
chain — into one app.

Built for Kiroween 2026, category **Frankenstein**: an AI agent + smart
contracts + a live ops dashboard stitched into one tool.

## Product principles

- **Live data or nothing.** Every number the app shows is read from BSC at
  the moment it is shown. No cached, estimated or hand-entered figures.
- **The agent prepares, the human approves.** The agent assembles each
  night's launch package (theme, pixel art, metadata, initcode, predicted
  CREATE2 address); a person approves before anything is broadcast.
- **No real-fund signing in the app.** On mainnet the app prepares and the
  owner's wallet signs outside the app. Testnet (judge mode) is where the
  full deploy flow runs end to end.
- **One chain, done deeply.** BSC only. No second chain, no chat interface
  for the agent in v1.

## Build order (which is also the demo order)

1. Live dashboard — minted count, contract balance, mint velocity per
   collection, plus the revenue panel.
2. Launch wizard + agent loop — nightly launch package for one approval;
   judge-mode deploy on BSC testnet.
3. Insights feed — plain-language, rule-based notes from dashboard data.

## Honesty rules for this repo

- The NFT contract template and the 15 live collections predate the
  hackathon; they are disclosed as pre-existing assets the app manages.
  The app, dashboard and agent layer are new work in the submission window.
- Do not claim features that are not built. If it is not in the concept, it
  does not go in the product copy.

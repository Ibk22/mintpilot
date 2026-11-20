// MintPilot dashboard server — plain Node, no dependencies.
// Serves a live, read-only dashboard of the owner's BNB Chain collections.
// Every number is read from BSC at request time via raw JSON-RPC.
// The server never signs or sends anything.
//
// Run:  node server.js        (http://localhost:4173)
// Env:  PORT (default 4173), BSC_RPC (default https://bsc-dataseed.binance.org)
//
// Mint velocity counts mint events (ERC-721 Transfers from the zero address)
// over the trailing 7 days via eth_getLogs. Some free public RPC endpoints
// refuse eth_getLogs entirely; when no configured endpoint serves logs the
// API reports velocity as unavailable instead of inventing a number. Point
// BSC_RPC at a log-capable endpoint (e.g. a MegaNode/archive RPC) to enable it.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const RPC_URL = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org';
const REGISTRY = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'collections.json'), 'utf8')
);

const SEL = {
  totalSupply: '0x18160ddd',
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  // Template-withdrawable standard getters (see contracts/template-withdrawable):
  // `price` is the current mint price in wei; `freeClaimed` counts how many
  // wallets have taken their one free mint, so paid mints = supply - freeClaimed.
  price: '0xa035b1fe',
  freeClaimed: '0x1b47ec3a',
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const VELOCITY_DAYS = 7;
const VELOCITY_CACHE_MS = 5 * 60 * 1000;
// Endpoints tried in order for eth_getLogs only. The main reads always use
// RPC_URL; log queries additionally fall back to a public endpoint that is
// known to serve logs, because the default Binance dataseed refuses them.
const LOG_RPCS = [...new Set([RPC_URL, 'https://bsc.publicnode.com'])];

// ---------- JSON-RPC helpers ----------

async function rpcBatchTo(url, requests) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requests),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('RPC HTTP ' + res.status);
    const body = await res.json();
    const byId = new Map();
    for (const item of Array.isArray(body) ? body : [body]) byId.set(item.id, item);
    return byId;
  } finally {
    clearTimeout(timer);
  }
}

function rpcBatch(requests) {
  return rpcBatchTo(RPC_URL, requests);
}

async function rpcSingle(url, method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('RPC HTTP ' + res.status);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message || 'RPC error');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return null;
  return Number(BigInt(hex));
}

function decodeString(hex) {
  if (!hex || hex === '0x' || hex.length < 66) return null;
  try {
    const len = Number(BigInt('0x' + hex.slice(66, 130)));
    if (len > 0 && len <= 256) {
      const data = hex.slice(130, 130 + len * 2);
      const s = Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '');
      if (s) return s;
    }
  } catch (_) { /* fall through to bytes32 style */ }
  try {
    const s = Buffer.from(hex.slice(2, 66), 'hex').toString('utf8').replace(/\0+$/, '');
    return s || null;
  } catch (_) {
    return null;
  }
}

function weiToBnb(weiBigInt) {
  // Keep 6 decimal places of BNB precision as a string, then Number it.
  const str = weiBigInt.toString().padStart(19, '0');
  const whole = str.slice(0, -18);
  const frac = str.slice(-18, -12);
  return Number(whole + '.' + frac);
}

// ---------- Live data: supply, balances, price, free/paid split ----------

async function fetchCollections() {
  // Build one flat batch: 6 calls per collection.
  const calls = [];
  REGISTRY.forEach((c, i) => {
    const base = i * 6;
    calls.push(
      { jsonrpc: '2.0', id: base + 1, method: 'eth_call', params: [{ to: c.address, data: SEL.totalSupply }, 'latest'] },
      { jsonrpc: '2.0', id: base + 2, method: 'eth_call', params: [{ to: c.address, data: SEL.name }, 'latest'] },
      { jsonrpc: '2.0', id: base + 3, method: 'eth_call', params: [{ to: c.address, data: SEL.symbol }, 'latest'] },
      { jsonrpc: '2.0', id: base + 4, method: 'eth_getBalance', params: [c.address, 'latest'] },
      { jsonrpc: '2.0', id: base + 5, method: 'eth_call', params: [{ to: c.address, data: SEL.price }, 'latest'] },
      { jsonrpc: '2.0', id: base + 6, method: 'eth_call', params: [{ to: c.address, data: SEL.freeClaimed }, 'latest'] }
    );
  });

  // Send in chunks so one bad chunk cannot sink the whole dashboard.
  const results = new Map();
  const CHUNK = 20;
  for (let i = 0; i < calls.length; i += CHUNK) {
    try {
      const part = await rpcBatch(calls.slice(i, i + CHUNK));
      for (const [id, item] of part) results.set(id, item);
    } catch (_) { /* retried below */ }
  }
  // Retry pass: the public RPC sometimes drops a whole batch. Re-request any
  // missing or errored calls in small groups, twice, before giving up on them.
  // Note: a call that reverts (contract does not expose price()/freeClaimed())
  // keeps coming back as an error and stays null — that is a real answer for
  // non-template contracts, and the UI shows their revenue as unavailable.
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = calls.filter((c) => {
      const item = results.get(c.id);
      return !item || item.error || item.result === undefined;
    });
    if (!missing.length) break;
    for (let i = 0; i < missing.length; i += 5) {
      try {
        const part = await rpcBatch(missing.slice(i, i + 5));
        for (const [id, item] of part) if (!item.error) results.set(id, item);
      } catch (_) { /* leave as missing; UI renders a dash */ }
    }
  }

  let totalMinted = 0;
  let totalWei = 0n;
  let totalPaidMints = 0;
  let totalFreeMints = 0;
  let totalRevenueWei = 0n;
  let revenueKnown = 0;
  const collections = REGISTRY.map((c, i) => {
    const base = i * 6;
    const get = (id) => {
      const item = results.get(id);
      return item && !item.error ? item.result : null;
    };
    const minted = decodeUint(get(base + 1));
    const onchainName = decodeString(get(base + 2));
    const onchainSymbol = decodeString(get(base + 3));
    const balHex = get(base + 4);
    const wei = balHex ? BigInt(balHex) : null;
    const priceHex = get(base + 5);
    const priceWei = priceHex ? BigInt(priceHex) : null;
    const freeClaimed = decodeUint(get(base + 6));

    // Revenue derivation (estimate, labelled as such in the UI):
    // each wallet's first mint is free while the free supply lasts, and
    // freeClaimed counts exactly those free first mints, so
    // paid mints = totalSupply - freeClaimed. Estimated lifetime mint
    // revenue = paid mints x the contract's CURRENT mint price. The price
    // is owner-adjustable, so if it ever changed this is an approximation;
    // secondary-sale royalties are paid by marketplaces straight to the
    // payout address and never touch the contract, so they are not counted.
    let paidMints = null;
    let estRevenueWei = null;
    if (minted !== null && freeClaimed !== null) {
      paidMints = Math.max(0, minted - freeClaimed);
      if (priceWei !== null) estRevenueWei = BigInt(paidMints) * priceWei;
    }

    if (minted !== null) totalMinted += minted;
    if (wei !== null) totalWei += wei;
    if (paidMints !== null) {
      totalPaidMints += paidMints;
      totalFreeMints += freeClaimed;
    }
    if (estRevenueWei !== null) {
      totalRevenueWei += estRevenueWei;
      revenueKnown += 1;
    }
    return {
      name: onchainName || c.name,
      symbol: onchainSymbol || c.symbol,
      address: c.address,
      minted,
      balanceBnb: wei !== null ? weiToBnb(wei) : null,
      priceBnb: priceWei !== null ? weiToBnb(priceWei) : null,
      freeClaimed,
      paidMints,
      estRevenueBnb: estRevenueWei !== null ? weiToBnb(estRevenueWei) : null,
      ok: minted !== null || wei !== null,
    };
  });

  return {
    collections,
    totalMinted,
    totalBalanceBnb: weiToBnb(totalWei),
    totalPaidMints,
    totalFreeMints,
    totalEstRevenueBnb: weiToBnb(totalRevenueWei),
    revenueKnown,
  };
}

// ---------- Live data: mint velocity from mint events ----------

async function blockTimestamp(url, blockNum) {
  const block = await rpcSingle(url, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  if (!block || !block.timestamp) return null;
  return Number(BigInt(block.timestamp));
}

// Greatest block whose timestamp is <= targetTs. Estimates from the recent
// average block time first, then binary-searches a window around the guess
// so it stays cheap on any endpoint.
async function findBlockAtOrBefore(url, targetTs, latest) {
  const tsLatest = await blockTimestamp(url, latest);
  if (tsLatest === null) return null;
  if (tsLatest <= targetTs) return latest;
  const refBlock = Math.max(0, latest - 10000);
  const tsRef = await blockTimestamp(url, refBlock);
  if (tsRef === null || tsLatest === tsRef) return null;
  const secPerBlock = (tsLatest - tsRef) / (latest - refBlock);
  const est = Math.floor(latest - (tsLatest - targetTs) / secPerBlock);
  let lo = Math.max(0, est - 30000);
  let hi = Math.min(latest, est + 30000);
  // Invariant: block(lo) may be after target if the estimate is off; widen once.
  const tsLo = await blockTimestamp(url, lo);
  if (tsLo !== null && tsLo > targetTs) {
    hi = lo;
    lo = Math.max(0, lo - 1200000);
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const ts = await blockTimestamp(url, mid);
    if (ts === null) return null;
    if (ts <= targetTs) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Count mint events per collection over [fromBlock, latest] on one endpoint.
// One eth_getLogs query per chunk covers every collection at once (address
// array). Chunks start at 50,000 blocks (the MegaNode cap) and halve whenever
// an endpoint rejects the range, down to 1,000 before giving up.
async function mintCountsOn(url, fromBlock, latest) {
  const addresses = REGISTRY.map((c) => c.address);
  const ranges = [];
  let chunk = 50000;
  let start = fromBlock;
  while (start <= latest) {
    const end = Math.min(start + chunk - 1, latest);
    ranges.push([start, end]);
    start = end + 1;
  }
  const counts = new Map();
  let idx = 0;
  async function worker() {
    while (idx < ranges.length) {
      const [s, e] = ranges[idx++];
      let size = e - s + 1;
      let cur = s;
      while (cur <= e) {
        const end = Math.min(cur + size - 1, e);
        try {
          const logs = await rpcSingle(url, 'eth_getLogs', [{
            address: addresses,
            topics: [TRANSFER_TOPIC, ZERO_TOPIC],
            fromBlock: '0x' + cur.toString(16),
            toBlock: '0x' + end.toString(16),
          }]);
          for (const log of logs || []) {
            const key = (log.address || '').toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
          }
          cur = end + 1;
        } catch (err) {
          if (size <= 1000) throw err;
          size = Math.floor(size / 2);
        }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return counts;
}

let velocityCache = { at: 0, counts: null };
async function fetchVelocity() {
  if (velocityCache.counts && Date.now() - velocityCache.at < VELOCITY_CACHE_MS) {
    return velocityCache.counts;
  }
  const targetTs = Math.floor(Date.now() / 1000) - VELOCITY_DAYS * 86400;
  for (const url of LOG_RPCS) {
    try {
      const latestHex = await rpcSingle(url, 'eth_blockNumber', []);
      const latest = Number(BigInt(latestHex));
      const fromBlock = await findBlockAtOrBefore(url, targetTs, latest);
      if (fromBlock === null) continue;
      const counts = await mintCountsOn(url, fromBlock, latest);
      velocityCache = { at: Date.now(), counts };
      return counts;
    } catch (_) { /* try the next endpoint; velocity stays unavailable if all fail */ }
  }
  return null;
}

let priceCache = { value: null, at: 0 };
async function fetchBnbUsd() {
  if (priceCache.value && Date.now() - priceCache.at < 60000) return priceCache.value;
  const sources = [
    async () => {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
      const j = await r.json();
      return Number(j.price);
    },
    async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
      const j = await r.json();
      return Number(j.binancecoin.usd);
    },
  ];
  for (const src of sources) {
    try {
      const v = await src();
      if (v > 0) { priceCache = { value: v, at: Date.now() }; return v; }
    } catch (_) { /* try next source */ }
  }
  return priceCache.value; // may be null -> UI shows BNB only
}

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/collections') {
    try {
      const [data, bnbUsd, velocity] = await Promise.all([
        fetchCollections(),
        fetchBnbUsd(),
        fetchVelocity(),
      ]);
      const { collections, totalEstRevenueBnb } = data;
      for (const c of collections) {
        const mints = velocity ? (velocity.get(c.address.toLowerCase()) || 0) : null;
        c.mints7d = mints;
        c.velocityPerDay = mints !== null ? Math.round((mints / VELOCITY_DAYS) * 10) / 10 : null;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        updatedAt: new Date().toISOString(),
        bnbUsd,
        velocityWindowDays: VELOCITY_DAYS,
        velocityAvailable: velocity !== null,
        totals: {
          collections: collections.length,
          minted: data.totalMinted,
          balanceBnb: data.totalBalanceBnb,
          balanceUsd: bnbUsd ? data.totalBalanceBnb * bnbUsd : null,
          paidMints: data.totalPaidMints,
          freeMints: data.totalFreeMints,
          estRevenueBnb: totalEstRevenueBnb,
          estRevenueUsd: bnbUsd ? totalEstRevenueBnb * bnbUsd : null,
          revenueKnown: data.revenueKnown,
        },
        collections,
      }));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    }
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('MintPilot dashboard on http://localhost:' + PORT);
});

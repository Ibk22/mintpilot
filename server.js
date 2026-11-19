// MintPilot dashboard server — plain Node, no dependencies.
// Serves a live, read-only dashboard of the owner's BNB Chain collections.
// Every number is read from BSC at request time via raw JSON-RPC.
// The server never signs or sends anything.
//
// Run:  node server.js        (http://localhost:4173)
// Env:  PORT (default 4173), BSC_RPC (default https://bsc-dataseed.binance.org)

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
};

// ---------- JSON-RPC helpers ----------

async function rpcBatch(requests) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(RPC_URL, {
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

// ---------- Live data ----------

async function fetchCollections() {
  // Build one flat batch: 4 calls per collection.
  const calls = [];
  REGISTRY.forEach((c, i) => {
    const base = i * 4;
    calls.push(
      { jsonrpc: '2.0', id: base + 1, method: 'eth_call', params: [{ to: c.address, data: SEL.totalSupply }, 'latest'] },
      { jsonrpc: '2.0', id: base + 2, method: 'eth_call', params: [{ to: c.address, data: SEL.name }, 'latest'] },
      { jsonrpc: '2.0', id: base + 3, method: 'eth_call', params: [{ to: c.address, data: SEL.symbol }, 'latest'] },
      { jsonrpc: '2.0', id: base + 4, method: 'eth_getBalance', params: [c.address, 'latest'] }
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
  const collections = REGISTRY.map((c, i) => {
    const base = i * 4;
    const get = (id) => {
      const item = results.get(id);
      return item && !item.error ? item.result : null;
    };
    const minted = decodeUint(get(base + 1));
    const onchainName = decodeString(get(base + 2));
    const onchainSymbol = decodeString(get(base + 3));
    const balHex = get(base + 4);
    const wei = balHex ? BigInt(balHex) : null;
    if (minted !== null) totalMinted += minted;
    if (wei !== null) totalWei += wei;
    return {
      name: onchainName || c.name,
      symbol: onchainSymbol || c.symbol,
      address: c.address,
      minted,
      balanceBnb: wei !== null ? weiToBnb(wei) : null,
      ok: minted !== null || wei !== null,
    };
  });

  return { collections, totalMinted, totalBalanceBnb: weiToBnb(totalWei) };
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
      const [{ collections, totalMinted, totalBalanceBnb }, bnbUsd] = await Promise.all([
        fetchCollections(),
        fetchBnbUsd(),
      ]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        updatedAt: new Date().toISOString(),
        bnbUsd,
        totals: {
          collections: collections.length,
          minted: totalMinted,
          balanceBnb: totalBalanceBnb,
          balanceUsd: bnbUsd ? totalBalanceBnb * bnbUsd : null,
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

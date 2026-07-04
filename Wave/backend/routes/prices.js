/**
 * routes/prices.js
 * GET /api/prices         — All coin prices (cached, refreshed every 60s)
 * GET /api/prices/:symbol — Single coin price
 *
 * Uses CoinGecko free API — no key required for basic usage.
 */

const router = require("express").Router();
const { queryOne, queryAll, execute } = require("../db");

const COIN_IDS = {
  BTC:  "bitcoin",
  ETH:  "ethereum",
  SOL:  "solana",
  ADA:  "cardano",
  LINK: "chainlink",
};

let lastFetch  = 0;
let isFetching = false;       // fetch lock — prevents simultaneous CoinGecko calls
const CACHE_TTL = 60_000;     // 60 seconds

// ── Fetch live prices from CoinGecko ─────────────────────────────────────────
async function fetchLivePrices() {
  if (isFetching) return;     // another fetch is already in progress — skip
  isFetching = true;
  try {
    const ids = Object.values(COIN_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data = await res.json();

    for (const [sym, id] of Object.entries(COIN_IDS)) {
      const entry = data[id];
      if (entry) {
        await execute(
          "UPDATE price_cache SET price = ?, change_24h = ?, updated_at = datetime('now') WHERE symbol = ?",
          [entry.usd, entry.usd_24h_change ?? 0, sym]
        );
      }
    }
    lastFetch = Date.now();
  } finally {
    isFetching = false;       // always release the lock, even if fetch failed
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    // Trigger refresh if cache is stale — return current data immediately
    if (Date.now() - lastFetch > CACHE_TTL) {
      fetchLivePrices().catch(console.warn);
    }

    const rows   = await queryAll("SELECT * FROM price_cache");
    const prices = {};
    rows.forEach(r => {
      prices[r.symbol] = {
        symbol:    r.symbol,
        price:     r.price,
        change24h: parseFloat((r.change_24h || 0).toFixed(2)),
        updatedAt: r.updated_at,
      };
    });
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const row    = await queryOne("SELECT * FROM price_cache WHERE symbol = ?", [symbol]);
    if (!row) return res.status(404).json({ error: "Symbol not found" });
    res.json({
      symbol:    row.symbol,
      price:     row.price,
      change24h: row.change_24h,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchLivePrices = fetchLivePrices;
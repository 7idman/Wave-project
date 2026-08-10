/**
 * routes/prices.js
 * GET /api/prices         — All coin prices (cached, refreshed every 60s)
 * GET /api/prices/:symbol — Single coin price
 *
 * Uses CoinGecko API. Set COINGECKO_API_KEY on Railway to use your real key
 * (demo-tier header shown below — see note if you're on Pro tier instead).
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

let lastFetch = 0;
let inFlightFetch = null;     // shared request — prevents duplicate CoinGecko calls
const CACHE_TTL = 20_000;     // lively enough for the UI without wasting API quota

// ── Fetch live prices from CoinGecko ─────────────────────────────────────────
async function fetchLivePrices() {
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    const ids = Object.values(COIN_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const headers = { Accept: "application/json" };
    if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    const res = await fetch(url, { headers });
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
  })();

  try {
    await inFlightFetch;
  } finally {
    inFlightFetch = null;     // always release the lock, even if fetch failed
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    // On a cold or stale cache, wait for CoinGecko so the first visible prices
    // are live rather than the database seed values.
    if (Date.now() - lastFetch > CACHE_TTL) {
      try { await fetchLivePrices(); }
      catch (err) { console.warn("CoinGecko refresh failed; serving cached prices:", err.message); }
    }

    const rows   = await queryAll("SELECT * FROM price_cache");
    const prices = {};
    rows.forEach(r => {
      prices[r.symbol] = {
        symbol:    r.symbol,
        price:     r.price,
        change24h: parseFloat((r.change_24h || 0).toFixed(2)),
        updatedAt: r.updated_at,
        assetType: r.asset_type || "crypto",
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

router.get("/:symbol/history", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const points = await queryAll(
      "SELECT price, change_24h, recorded_at FROM price_history WHERE symbol = ? ORDER BY recorded_at ASC",
      [symbol]
    );
    res.json({ symbol, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchLivePrices = fetchLivePrices;

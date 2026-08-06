/**
 * services/priceSnapshot.js
 * Periodically copies price_cache into price_history, so there's a real
 * time series to chart later. Starts from whenever this first runs — there's
 * no way to backfill prices from before snapshotting began.
 */

const { queryAll, execute } = require("../db");

async function takeSnapshot() {
  const prices = await queryAll("SELECT symbol, price, change_24h FROM price_cache");
  for (const p of prices) {
    await execute(
      "INSERT INTO price_history (symbol, price, change_24h) VALUES (?, ?, ?)",
      [p.symbol, p.price, p.change_24h]
    );
  }
  return prices.length;
}

// Every 15 minutes is enough resolution for a meaningful chart without
// writing to the database excessively at low traffic (current scale: one
// developer + a handful of testers).
function startPriceSnapshotSchedule(intervalMs = 15 * 60 * 1000) {
  takeSnapshot().catch(err => console.error("Price snapshot failed:", err.message));
  const handle = setInterval(() => {
    takeSnapshot().catch(err => console.error("Price snapshot failed:", err.message));
  }, intervalMs);
  return handle;
}

module.exports = { takeSnapshot, startPriceSnapshotSchedule };

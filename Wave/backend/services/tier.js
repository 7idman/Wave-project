/**
 * services/tier.js
 * Ranking tiers, based on lifetime completed deposits — a stable, real
 * number (unlike portfolio value, which swings with market prices).
 */

const { queryOne } = require("../db");

// Ordered lowest to highest. Thresholds are a starting point — easy to
// tune later without touching the calculation logic.
const TIERS = [
  { key: "bronze",   name: "Bronze",   min: 100 },
  { key: "silver",   name: "Silver",   min: 1000 },
  { key: "gold",     name: "Gold",     min: 10000 },
  { key: "platinum", name: "Platinum", min: 50000 },
];

async function getLifetimeDeposits(userId) {
  const row = await queryOne(
    "SELECT COALESCE(SUM(total),0) AS total FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'completed'",
    [userId]
  );
  return row.total;
}

function tierForAmount(amount) {
  let current = null;
  for (const t of TIERS) {
    if (amount >= t.min) current = t;
  }
  if (!current) {
    const first = TIERS[0];
    return {
      tier: null,
      tierName: "Unranked",
      next: { tier: first.key, tierName: first.name, min: first.min, remaining: Math.max(0, first.min - amount) },
    };
  }
  const idx = TIERS.indexOf(current);
  const next = TIERS[idx + 1] || null;
  return {
    tier: current.key,
    tierName: current.name,
    next: next ? { tier: next.key, tierName: next.name, min: next.min, remaining: Math.max(0, next.min - amount) } : null,
  };
}

async function getUserTier(userId) {
  const lifetimeDeposits = await getLifetimeDeposits(userId);
  return { lifetimeDeposits, ...tierForAmount(lifetimeDeposits) };
}

module.exports = { TIERS, getLifetimeDeposits, tierForAmount, getUserTier };

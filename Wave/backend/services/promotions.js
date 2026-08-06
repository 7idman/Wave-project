/**
 * services/promotions.js
 * Deposit-bonus promotions tied to ranking tiers. Checked after every
 * completed deposit; credits a bonus immediately but locks it from
 * withdrawal for lock_days (enforced in trades.js's withdraw handler).
 */

const { queryAll, queryOne, execute } = require("../db");
const { TIERS, getUserTier } = require("./tier");

function tierRank(tierKey) {
  const idx = TIERS.findIndex(t => t.key === tierKey);
  return idx === -1 ? 0 : idx;
}

// Call right after a deposit's transaction row has been inserted — tier is
// evaluated INCLUDING this deposit, so a deposit that pushes someone into
// Silver can itself qualify for a Silver-tier promotion.
async function applyDepositBonus(userId, depositAmount, depositTransactionId) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const active = await queryAll(
    "SELECT * FROM promotions WHERE start_at <= ? AND end_at >= ?",
    [now, now]
  );
  if (active.length === 0) return null;

  const { tier } = await getUserTier(userId);
  const userRank = tierRank(tier);

  const eligible = active.filter(
    p => depositAmount >= p.min_deposit && userRank >= tierRank(p.min_tier)
  );
  if (eligible.length === 0) return null;

  // Best deal for the user if more than one promotion applies.
  const promo = eligible.reduce((a, b) => (b.bonus_pct > a.bonus_pct ? b : a));
  const bonusAmount = parseFloat((depositAmount * promo.bonus_pct).toFixed(2));
  if (bonusAmount <= 0) return null;

  const unlockAt = new Date(Date.now() + promo.lock_days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");

  await execute(
    "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
    [bonusAmount, userId]
  );
  await execute(
    "INSERT INTO bonus_grants (user_id, promotion_id, transaction_id, amount, unlock_at) VALUES (?, ?, ?, ?, ?)",
    [userId, promo.id, depositTransactionId, bonusAmount, unlockAt]
  );

  return { promotionName: promo.name, bonusAmount, unlockAt };
}

// Sum of bonus money still locked right now — used to make sure a withdrawal
// can't dip into it. Always computed live from unlock_at, never a cached flag.
async function getLockedBonusTotal(userId) {
  const row = await queryOne(
    "SELECT COALESCE(SUM(amount),0) AS total FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now')",
    [userId]
  );
  return row.total;
}

module.exports = { applyDepositBonus, getLockedBonusTotal, tierRank };

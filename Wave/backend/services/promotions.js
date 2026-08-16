/**
 * services/promotions.js
 * Deposit-bonus promotions tied to ranking tiers. Checked after every
 * completed deposit; credits a bonus immediately but locks it from
 * withdrawal for lock_days (enforced in trades.js's withdraw handler).
 */

const { queryAll, queryOne, withTransaction } = require("../db");
const { TIERS, getUserTier } = require("./tier");
const { roundMoneyToCents, centsFromRate, dollarsFromCents } = require("../utils/money");

function tierRank(tierKey) {
  const idx = TIERS.findIndex(t => t.key === tierKey);
  return idx === -1 ? 0 : idx;
}

// Call right after a deposit's transaction row has been inserted — tier is
// evaluated INCLUDING this deposit, so a deposit that pushes someone into
// Silver can itself qualify for a Silver-tier promotion.
async function applyDepositBonus(userId, depositAmount, depositTransactionId) {
  const depositCents = roundMoneyToCents(depositAmount);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const active = await queryAll(
    "SELECT * FROM promotions WHERE start_at <= ? AND end_at >= ?",
    [now, now]
  );
  if (active.length === 0) return null;

  const { tier } = await getUserTier(userId);
  const userRank = tierRank(tier);

  const eligible = active.filter(
    p => depositCents >= p.min_deposit_cents && userRank >= tierRank(p.min_tier)
  );
  if (eligible.length === 0) return null;

  // Best deal for the user if more than one promotion applies.
  const promo = eligible.reduce((a, b) => (b.bonus_pct > a.bonus_pct ? b : a));
  const bonusCents = centsFromRate(depositCents, promo.bonus_pct);
  if (bonusCents <= 0) return null;
  const bonusAmount = dollarsFromCents(bonusCents);

  const unlockAt = new Date(Date.now() + promo.lock_days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");

  return withTransaction(async tx => {
    // Claim this deposit transaction before touching the balance. The engine
    // intentionally awards only its best eligible promotion, so the unique
    // transaction index also protects retries after promotion configuration
    // changes. IGNORE turns a concurrent duplicate into an idempotent null.
    const grant = await tx.execute(
      "INSERT OR IGNORE INTO bonus_grants (user_id, promotion_id, transaction_id, amount, amount_cents, unlock_at) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, promo.id, depositTransactionId, bonusAmount, bonusCents, unlockAt]
    );
    if (grant.rowsAffected === 0) return null;

    const credited = await tx.execute(
      "UPDATE users SET cash_balance_cents = cash_balance_cents + ?, updated_at = datetime('now') WHERE id = ?",
      [bonusCents, userId]
    );
    if (credited.rowsAffected === 0) throw new Error("Bonus recipient no longer exists");
    return { promotionName: promo.name, bonusAmount, unlockAt };
  });
}

// Sum of bonus money still locked right now — used to make sure a withdrawal
// can't dip into it. Always computed live from unlock_at, never a cached flag.
async function getLockedBonusTotal(userId) {
  return dollarsFromCents(await getLockedBonusTotalCents(userId));
}

async function getLockedBonusTotalCents(userId) {
  const row = await queryOne(
    "SELECT COALESCE(SUM(amount_cents),0) AS total FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now')",
    [userId]
  );
  return Number(row.total);
}

module.exports = { applyDepositBonus, getLockedBonusTotal, getLockedBonusTotalCents };

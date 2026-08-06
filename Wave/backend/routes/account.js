/**
 * routes/account.js
 * GET /api/account/tier — the user's real ranking tier, based on lifetime deposits.
 */

const router = require("express").Router();
const { getUserTier } = require("../services/tier");
const { getLockedBonusTotal } = require("../services/promotions");
const { queryAll, queryOne } = require("../db");

router.get("/tier", async (req, res) => {
  try {
    const tier = await getUserTier(req.user.id);
    const lockedBonus = await getLockedBonusTotal(req.user.id);
    const bonusGrants = await queryAll(
      "SELECT amount, unlock_at FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now') ORDER BY unlock_at ASC",
      [req.user.id]
    );
    res.json({ ...tier, lockedBonus, bonusGrants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reconstructs a real cash-balance-over-time series by replaying every
// completed transaction chronologically from 0. This is exact for cash —
// there's no separate snapshot table, so this IS the source of truth, not
// an approximation. Portfolio VALUE history (holdings at past prices)
// isn't included here — that would need historical price data, which this
// platform doesn't store (only current price_cache), so it's left out
// rather than faked with today's prices applied to past dates.
router.get("/balance-history", async (req, res) => {
  try {
    const userId = req.user.id;
    const txs = await queryAll(
      "SELECT type, total, created_at FROM transactions WHERE user_id = ? AND status = 'completed' ORDER BY created_at ASC",
      [userId]
    );
    const bonuses = await queryAll(
      "SELECT amount, created_at FROM bonus_grants WHERE user_id = ? ORDER BY created_at ASC",
      [userId]
    );
    const events = [
      ...txs.map(t => ({
        at: t.created_at,
        delta: (t.type === "deposit") ? t.total : (t.type === "withdraw" || t.type === "buy") ? -t.total : t.type === "sell" ? t.total : 0,
      })),
      ...bonuses.map(b => ({ at: b.created_at, delta: b.amount })),
    ].sort((a, b) => (a.at || "").localeCompare(b.at || ""));

    let running = 0;
    const points = events.map(e => {
      running += e.delta;
      return { date: e.at, balance: parseFloat(running.toFixed(2)) };
    });

    res.json({ points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Honest aggregates only — every number here is a direct sum/count from
// real completed transactions, nothing inferred or estimated.
router.get("/wallet-analytics", async (req, res) => {
  try {
    const userId = req.user.id;
    const deposits = await queryOne(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(MAX(total),0) AS largest, COALESCE(AVG(total),0) AS avg FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'completed'",
      [userId]
    );
    const withdrawals = await queryOne(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM transactions WHERE user_id = ? AND type = 'withdraw' AND status = 'completed'",
      [userId]
    );
    const failedWithdrawals = await queryOne(
      "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND type = 'withdraw' AND status = 'failed'",
      [userId]
    );
    const bonusTotal = await queryOne(
      "SELECT COALESCE(SUM(amount),0) AS total FROM bonus_grants WHERE user_id = ?",
      [userId]
    );
    res.json({
      totalDeposited: deposits.total,
      depositCount: deposits.count,
      largestDeposit: deposits.largest,
      averageDeposit: deposits.avg,
      totalWithdrawn: withdrawals.total,
      withdrawalCount: withdrawals.count,
      failedWithdrawalAttempts: failedWithdrawals.count,
      totalBonusEarned: bonusTotal.total,
      netFlow: deposits.total - withdrawals.total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/**
 * routes/trades.js
 * POST /api/trades — Execute buy, sell, deposit, or withdraw
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");
const { createAdminRequest } = require("../services/adminRequests");
const { generateReferenceId } = require("../utils/referenceId");
const { applyDepositBonus, getLockedBonusTotal } = require("../services/promotions");
const { getUserTier } = require("../services/tier");

const FEE_RATE     = 0.001; // 0.1% buy/sell
const WITHDRAW_FEE = 0.005; // 0.5% withdrawal
const MIN_DEPOSIT = 100; // matches the Bronze tier threshold

router.post("/", async (req, res) => {
  try {
    const { type, symbol, amount, label } = req.body;
    const userId = req.user.id;

    if (!["buy","sell","deposit","withdraw","investment"].includes(type))
      return res.status(400).json({ error: "type must be buy, sell, deposit, withdraw, or investment" });
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "amount must be a positive number" });

    const qty = parseFloat(amount);

    if (type === "deposit" && qty < MIN_DEPOSIT)
      return res.status(400).json({ error: `Minimum deposit is $${MIN_DEPOSIT}` });

    // A plan activation reduces available cash, but it is not a withdrawal.
    // Keep it in a dedicated activity log so its notification is accurate.
    if (type === "investment") {
      const result = await execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
        [qty, userId, qty]
      );
      if (result.rowsAffected === 0) return res.status(400).json({ error: "Insufficient balance" });
      const activityLabel = typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : "Investment plan";
      await execute("INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, ?, ?, ?)", [userId, "investment", activityLabel, qty]);
      const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return res.status(201).json({ message: `${activityLabel} activated`, cashBalance: user.cash_balance });
    }

    // ── DEPOSIT ────────────────────────────────────────────────────────────
    // No race condition risk here — adding money can never overdraw an account,
    // so a simple update is safe as-is.
    if (type === "deposit") {
      const referenceId = generateReferenceId("DEP");
      await execute(
        "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [qty, userId]
      );
      const inserted = await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)",
        [userId, "deposit", "USD", qty, 1, 0, qty, referenceId]
      );

      // Ranking-tier deposit bonus, if an active promotion applies. Failure
      // here must never fail the deposit itself — the deposit already
      // succeeded above; a bonus-check error just means no bonus this time.
      let bonus = null;
      try {
        bonus = await applyDepositBonus(userId, qty, inserted.lastInsertRowid);
      } catch (bonusErr) {
        console.error("Deposit bonus check failed (deposit itself still succeeded):", bonusErr.message);
      }

      const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return res.status(201).json({
        message: bonus
          ? `Deposited $${qty.toLocaleString()} — plus a $${bonus.bonusAmount.toLocaleString()} ${bonus.promotionName} bonus (unlocks ${bonus.unlockAt.slice(0,10)})`
          : `Deposited $${qty.toLocaleString()}`,
        cashBalance: user.cash_balance,
        referenceId,
        bonus,
      });
    }

    // ── WITHDRAW ──────────────────────────────────────────────────────────
    // Concept: the WHERE clause below does the balance check AND the deduction
    // in one atomic step. If two withdraw requests arrive at the same instant,
    // only one can succeed — the second will see cash_balance already reduced
    // and its WHERE condition will fail, so rowsAffected comes back as 0.
    if (type === "withdraw") {
      const { tier } = await getUserTier(userId);
      const isVip = tier === "platinum";
      const fee   = isVip ? 0 : parseFloat((qty * WITHDRAW_FEE).toFixed(2));
      const total = parseFloat((qty + fee).toFixed(2));
      const referenceId = generateReferenceId("WD");

      // The locked-bonus check is folded into this single UPDATE's WHERE
      // clause (the subquery), not done as a separate SELECT beforehand.
      // Doing it as a separate pre-check would leave a gap where two
      // simultaneous withdrawals could each pass the check individually but
      // together dip into locked bonus money — same class of race this
      // codebase already guards against with cash_balance >= ?.
      const result = await execute(
        `UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now')
         WHERE id = ?
           AND cash_balance >= ?
           AND (cash_balance - (SELECT COALESCE(SUM(amount),0) FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))) >= ?`,
        [total, userId, total, userId, total]
      );

      if (result.rowsAffected === 0) {
        const lockedBonus = await getLockedBonusTotal(userId);
        await execute(
          "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)",
          [userId, "withdraw", "USD", qty, 1, fee, total, referenceId]
        );
        return res.status(400).json({
          error: lockedBonus > 0
            ? `Insufficient available balance — $${lockedBonus.toLocaleString()} is locked bonus funds not yet available to withdraw`
            : "Insufficient balance",
          referenceId,
        });
      }

      await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)",
        [userId, "withdraw", "USD", qty, 1, fee, total, referenceId]
      );
      const updated = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return res.status(201).json({
        message: `Withdrawn $${qty.toLocaleString()}`,
        cashBalance: updated.cash_balance,
        referenceId,
      });
    }

    // ── BUY / SELL ────────────────────────────────────────────────────────
    if (!symbol) return res.status(400).json({ error: "symbol is required for buy/sell" });
    const sym      = symbol.toUpperCase();
    const priceRow = await queryOne("SELECT price FROM price_cache WHERE symbol = ?", [sym]);
    if (!priceRow) return res.status(404).json({ error: `Unknown symbol: ${sym}` });

    const price    = priceRow.price;
    const subtotal = qty * price;
    const fee      = parseFloat((subtotal * FEE_RATE).toFixed(8));
    const total    = parseFloat((subtotal + fee).toFixed(8));

    if (type === "buy") {
      // Concept: same atomic pattern as withdraw — the cash_balance >= ? check
      // and the deduction happen as one indivisible database operation.
      const result = await execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
        [total, userId, total]
      );

      if (result.rowsAffected === 0) {
        return res.status(400).json({ error: "Insufficient cash balance" });
      }

      await execute(
        `INSERT INTO holdings (user_id, symbol, amount, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, symbol) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
        [userId, sym, qty]
      );
      await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')",
        [userId, "buy", sym, qty, price, fee, total]
      );
    } else {
      // ── SELL ────────────────────────────────────────────────────────────
      // Concept: this is the exact fix for the race condition we discussed.
      // The "amount >= ?" check and the subtraction happen in the SAME SQL
      // statement. If two sell requests for the same holding arrive at the
      // same instant, only the first one that reaches the database will see
      // amount >= qty as true. By the time the second one runs, the amount
      // has already been reduced, so its own "amount >= ?" check fails and
      // rowsAffected comes back as 0 — the database itself blocks the overdraw,
      // no matter how close together the two requests arrive.
      const proceeds = parseFloat((subtotal - fee).toFixed(8));

      const result = await execute(
        "UPDATE holdings SET amount = amount - ?, updated_at = datetime('now') WHERE user_id = ? AND symbol = ? AND amount >= ?",
        [qty, userId, sym, qty]
      );

      if (result.rowsAffected === 0) {
        return res.status(400).json({ error: "Insufficient holdings" });
      }

      await execute(
        "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [proceeds, userId]
      );
      await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')",
        [userId, "sell", sym, qty, price, fee, proceeds]
      );
    }

    const updated        = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    const updatedHolding = await queryOne("SELECT amount FROM holdings WHERE user_id = ? AND symbol = ?", [userId, sym]);
    res.status(201).json({
      message:     `${type === "buy" ? "Bought" : "Sold"} ${qty} ${sym}`,
      cashBalance: updated.cash_balance,
      holding:     updatedHolding?.amount ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

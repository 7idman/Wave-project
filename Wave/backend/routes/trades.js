/**
 * routes/trades.js
 * POST /api/trades — Execute buy, sell, deposit, or withdraw
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");
const { createAdminRequest } = require("../services/adminRequests");

const FEE_RATE     = 0.001; // 0.1% buy/sell
const WITHDRAW_FEE = 0.005; // 0.5% withdrawal

router.post("/", async (req, res) => {
  try {
    const { type, symbol, amount, label } = req.body;
    const userId = req.user.id;

    if (!["buy","sell","deposit","withdraw","investment"].includes(type))
      return res.status(400).json({ error: "type must be buy, sell, deposit, withdraw, or investment" });
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "amount must be a positive number" });

    const qty = parseFloat(amount);

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
      await execute(
        "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [qty, userId]
      );
      await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')",
        [userId, "deposit", "USD", qty, 1, 0, qty]
      );
      const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return res.status(201).json({
        message: `Deposited $${qty.toLocaleString()}`,
        cashBalance: user.cash_balance,
      });
    }

    // ── WITHDRAW ──────────────────────────────────────────────────────────
    // Concept: the WHERE clause below does the balance check AND the deduction
    // in one atomic step. If two withdraw requests arrive at the same instant,
    // only one can succeed — the second will see cash_balance already reduced
    // and its WHERE condition will fail, so rowsAffected comes back as 0.
    if (type === "withdraw") {
      const fee   = parseFloat((qty * WITHDRAW_FEE).toFixed(2));
      const total = parseFloat((qty + fee).toFixed(2));

      const result = await execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
        [total, userId, total]
      );

      if (result.rowsAffected === 0) {
        return res.status(400).json({ error: "Insufficient balance" });
      }

      await execute(
        "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')",
        [userId, "withdraw", "USD", qty, 1, fee, total]
      );
      const updated = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return res.status(201).json({
        message: `Withdrawn $${qty.toLocaleString()}`,
        cashBalance: updated.cash_balance,
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

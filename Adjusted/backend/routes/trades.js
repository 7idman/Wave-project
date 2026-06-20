/**
 * routes/trades.js
 * POST /api/trades — Execute buy, sell, deposit, or withdraw
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");

const FEE_RATE     = 0.001; // 0.1% buy/sell
const WITHDRAW_FEE = 0.005; // 0.5% withdrawal

router.post("/", async (req, res) => {
  try {
    const { type, symbol, amount } = req.body;
    const userId = req.user.id;

    if (!["buy","sell","deposit","withdraw"].includes(type))
      return res.status(400).json({ error: "type must be buy, sell, deposit, or withdraw" });
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "amount must be a positive number" });

    const qty = parseFloat(amount);

    // ── DEPOSIT ────────────────────────────────────────────────────────────
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
    if (type === "withdraw") {
      const fee   = parseFloat((qty * WITHDRAW_FEE).toFixed(2));
      const total = parseFloat((qty + fee).toFixed(2));
      const user  = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      if (user.cash_balance < total)
        return res.status(400).json({ error: "Insufficient balance" });

      await execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ?",
        [total, userId]
      );
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

    const user    = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    const holding = await queryOne("SELECT amount FROM holdings WHERE user_id = ? AND symbol = ?", [userId, sym]);
    const held    = holding?.amount ?? 0;

    if (type === "buy") {
      if (user.cash_balance < total)
        return res.status(400).json({ error: "Insufficient cash balance" });

      await execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ?",
        [total, userId]
      );
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
      if (held < qty)
        return res.status(400).json({ error: "Insufficient holdings" });

      const proceeds = parseFloat((subtotal - fee).toFixed(8));
      await execute(
        "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [proceeds, userId]
      );
      await execute(
        "UPDATE holdings SET amount = amount - ?, updated_at = datetime('now') WHERE user_id = ? AND symbol = ?",
        [qty, userId, sym]
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

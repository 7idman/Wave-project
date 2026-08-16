/**
 * routes/portfolio.js
 * GET /api/portfolio — Holdings + balances for authenticated user
 */

const router = require("express").Router();
const { queryOne, queryAll } = require("../db");
const { dollarsFromCents, roundMoneyToCents } = require("../utils/money");

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const holdings = await queryAll(
      "SELECT symbol, amount FROM holdings WHERE user_id = ? AND amount > 0 ORDER BY symbol",
      [userId]
    );

    const priceRows = await queryAll("SELECT symbol, price, change_24h FROM price_cache");
    const priceMap  = {};
    priceRows.forEach(p => { priceMap[p.symbol] = p; });

    const holdingsWithValue = holdings.map(h => ({
      symbol:    h.symbol,
      amount:    h.amount,
      price:     priceMap[h.symbol]?.price      ?? 0,
      change24h: priceMap[h.symbol]?.change_24h ?? 0,
      value:     parseFloat(((priceMap[h.symbol]?.price ?? 0) * h.amount).toFixed(2)),
    }));

    const totalPortfolioValue = holdingsWithValue.reduce((s, h) => s + h.value, 0);

    // Get fresh cash balance
    const userRow = await queryOne("SELECT cash_balance_cents FROM users WHERE id = ?", [userId]);
    const cashBalance = dollarsFromCents(userRow.cash_balance_cents);

    res.json({
      cashBalance,
      totalPortfolioValue: parseFloat(totalPortfolioValue.toFixed(2)),
      totalValue:          dollarsFromCents(roundMoneyToCents(cashBalance + totalPortfolioValue)),
      holdings:            holdingsWithValue,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

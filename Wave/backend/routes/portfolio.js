/**
 * routes/portfolio.js
 * GET /api/portfolio — Holdings + balances for authenticated user
 */

const router = require("express").Router();
const { queryOne, queryAll } = require("../db");

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
    const userRow = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);

    res.json({
      cashBalance:         userRow.cash_balance,
      totalPortfolioValue: parseFloat(totalPortfolioValue.toFixed(2)),
      totalValue:          parseFloat((userRow.cash_balance + totalPortfolioValue).toFixed(2)),
      holdings:            holdingsWithValue,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

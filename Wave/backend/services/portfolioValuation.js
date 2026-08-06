/**
 * services/portfolioValuation.js
 * Shared helper: what is a portfolio (copier/managed/strategy) worth right now?
 * Reused by the strategy trade-mirroring engine and by any endpoint that
 * needs to show a real copier/managed balance instead of a hardcoded number.
 */

const { queryOne, queryAll } = require("../db");

async function valuePortfolio(portfolioId) {
  const portfolio = await queryOne(
    "SELECT id, cash_balance FROM portfolios WHERE id = ?",
    [portfolioId]
  );
  if (!portfolio) return null;

  const holdings = await queryAll(
    "SELECT symbol, amount FROM portfolio_holdings WHERE portfolio_id = ? AND amount > 0",
    [portfolioId]
  );

  let holdingsValue = 0;
  const priced = [];
  for (const h of holdings) {
    const priceRow = await queryOne("SELECT price FROM price_cache WHERE symbol = ?", [h.symbol]);
    const price = priceRow?.price || 0;
    const value = h.amount * price;
    holdingsValue += value;
    priced.push({ symbol: h.symbol, amount: h.amount, price, value });
  }

  return {
    portfolioId,
    cashBalance: portfolio.cash_balance,
    holdingsValue,
    totalValue: portfolio.cash_balance + holdingsValue,
    holdings: priced,
  };
}

module.exports = { valuePortfolio };

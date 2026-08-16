/**
 * services/portfolioValuation.js
 * Shared helper: what is a portfolio (copier/managed/strategy) worth right now?
 * Reused by the strategy trade-mirroring engine and by any endpoint that
 * needs to show a real copier/managed balance instead of a hardcoded number.
 */

const { queryOne, queryAll } = require("../db");
const { dollarsFromCents, roundMoneyToCents } = require("../utils/money");

async function valuePortfolio(portfolioId) {
  const portfolio = await queryOne(
    "SELECT id, cash_balance_cents FROM portfolios WHERE id = ?",
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
    const value = dollarsFromCents(roundMoneyToCents(h.amount * price));
    holdingsValue += value;
    priced.push({ symbol: h.symbol, amount: h.amount, price, value });
  }

  const cashBalance = dollarsFromCents(portfolio.cash_balance_cents);
  return {
    portfolioId,
    cashBalance,
    holdingsValue,
    totalValue: cashBalance + holdingsValue,
    holdings: priced,
  };
}

module.exports = { valuePortfolio };

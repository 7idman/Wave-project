/**
 * routes/transfers.js
 * POST /api/transfers/to-portfolio — Move cash from the user's main balance
 * into one of their portfolios (copier or managed).
 */

const router = require("express").Router();
const crypto = require("crypto");
const { queryOne, execute } = require("../db");

function generateReferenceId() {
  return "TRF-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

// ── PLUG: email/phone verification ──────────────────────────────────────
// Not implemented yet — this always passes through immediately so transfers
// work today. Wired in at the one call site below, so turning on real
// verification later doesn't require touching the transfer logic itself.
//
// To implement for real:
//   1. Generate a one-time code, store it against a pending transfer row
//      (add a 'pending' status + expires_at column to internal_transfers).
//   2. Send it via email (existing mail setup?) or SMS.
//   3. Return { required: true, status: 'pending' } here instead of completing.
//   4. Add a POST /transfers/:id/confirm route that checks the code and only
//      then runs the actual balance-moving code below.
// Until that's built, every transfer is marked 'not_required' and completes
// immediately — same as a transfer with no verification step at all.
async function checkTransferVerification(user, amount) {
  return { required: false, status: "not_required" };
}

router.post("/to-portfolio", async (req, res) => {
  try {
    const userId = req.user.id;
    const { portfolioId, amount } = req.body;
    const amt = parseFloat(amount);

    if (!portfolioId || !Number.isFinite(amt) || amt <= 0)
      return res.status(400).json({ error: "portfolioId and a positive amount are required" });

    const portfolio = await queryOne(
      "SELECT id, user_id, type FROM portfolios WHERE id = ?",
      [portfolioId]
    );
    if (!portfolio || portfolio.user_id !== userId)
      return res.status(404).json({ error: "Portfolio not found" });

    const verification = await checkTransferVerification(req.user, amt);
    if (verification.required) {
      // Not reachable today (checkTransferVerification always returns
      // required:false) — this branch exists so the real implementation has
      // somewhere to land without changing anything else in this route.
      return res.status(202).json({ message: "Verification required", verification });
    }

    const referenceId = generateReferenceId();

    // Same atomic guarded-deduction pattern as withdraw/buy in trades.js —
    // the balance check and the deduction happen in one indivisible
    // statement, so two simultaneous transfers can't both succeed off an
    // insufficient balance.
    const result = await execute(
      "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
      [amt, userId, amt]
    );
    if (result.rowsAffected === 0)
      return res.status(400).json({ error: "Insufficient balance" });

    await execute(
      "UPDATE portfolios SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
      [amt, portfolioId]
    );
    await execute(
      `INSERT INTO internal_transfers
         (user_id, direction, portfolio_id, amount, reference_id, verification_status, status)
       VALUES (?, 'to_portfolio', ?, ?, ?, ?, 'completed')`,
      [userId, portfolioId, amt, referenceId, verification.status]
    );
    await execute(
      "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'transfer', ?, ?)",
      [userId, `Transfer to ${portfolio.type} account (${referenceId})`, amt]
    );

    const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    res.status(201).json({
      message: `Transferred $${amt.toLocaleString()}`,
      referenceId,
      cashBalance: user.cash_balance,
      portfolioId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/**
 * routes/transfers.js
 * POST /api/transfers/to-portfolio — Move cash from the user's main balance
 * into one of their portfolios (copier or managed).
 * POST /api/transfers/:id/confirm  — Confirm a phone-verified transfer.
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");
const { generateReferenceId } = require("../utils/referenceId");
const { sendVerificationCode, checkVerificationCode } = require("../services/twilio");
const { checkAndRecord } = require("../services/rateLimit");
const { logSecurityEvent } = require("../middleware/security");

// Transfers at or above this amount require a phone OTP confirmation
// before any money moves — configurable rather than hardcoded, per the
// security architecture's own requirement.
const TRANSFER_VERIFICATION_THRESHOLD = parseFloat(process.env.TRANSFER_VERIFICATION_THRESHOLD || "500");

// Real implementation: transfers under the threshold pass straight through
// (same as before). At or above it, the user's phone must already be
// verified (see routes/phone.js) — if it isn't, we fail closed and tell
// them to verify a phone first rather than silently skipping the check.
async function checkTransferVerification(user, amount) {
  if (amount < TRANSFER_VERIFICATION_THRESHOLD) return { required: false, status: "not_required" };
  if (!user.phone_verified || !user.phone) return { required: false, status: "blocked_no_phone" };
  return { required: true, status: "pending" };
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

    if (verification.status === "blocked_no_phone") {
      return res.status(403).json({ error: `Transfers of $${TRANSFER_VERIFICATION_THRESHOLD}+ require a verified phone number. Add one in Settings first.` });
    }

    if (verification.required) {
      // Don't move any money yet — create a pending transfer row, send the
      // OTP, and let POST /:id/confirm do the actual balance movement only
      // once the code checks out.
      const otpLimit = await checkAndRecord("transfer_otp_send", `user:${userId}`, { max: 5, windowMinutes: 30 });
      if (!otpLimit.allowed) return res.status(429).json({ error: "Too many verification requests. Please try again later." });

      const sendResult = await sendVerificationCode(req.user.phone);
      if (!sendResult.success) return res.status(503).json({ error: "Couldn't send verification code. Please try again." });

      const referenceId = generateReferenceId();
      const pending = await execute(
        `INSERT INTO internal_transfers
           (user_id, direction, portfolio_id, amount, reference_id, verification_status, status)
         VALUES (?, 'to_portfolio', ?, ?, ?, 'pending', 'pending')`,
        [userId, portfolioId, amt, referenceId]
      );
      await logSecurityEvent("TRANSFER_VERIFICATION_SENT", { userId, ip: req.ip, metadata: { amount: amt } });

      return res.status(202).json({ message: "Verification required — check your phone for a code.", transferId: pending.lastInsertRowid, referenceId, verification });
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

router.post("/:id/confirm", async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    const transferId = parseInt(req.params.id, 10);

    const pending = await queryOne(
      "SELECT * FROM internal_transfers WHERE id = ? AND user_id = ? AND status = 'pending'",
      [transferId, userId]
    );
    if (!pending) return res.status(404).json({ error: "No pending transfer found." });

    const verifyLimit = await checkAndRecord("transfer_otp_verify", `user:${userId}`, { max: 5, windowMinutes: 15 });
    if (!verifyLimit.allowed) return res.status(429).json({ error: "Too many attempts. Please try again later." });

    // Same rule as everywhere else: the backend asks Twilio directly,
    // never trusts a client-supplied verification claim.
    const check = await checkVerificationCode(req.user.phone, code);
    if (!check.approved) {
      await logSecurityEvent("TRANSFER_VERIFICATION_FAILED", { userId, ip: req.ip, metadata: { transferId } });
      return res.status(401).json({ error: "Invalid or expired code." });
    }

    // Now, and only now, move the money — same atomic guarded pattern as
    // the direct (non-verified) path above.
    const result = await execute(
      "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
      [pending.amount, userId, pending.amount]
    );
    if (result.rowsAffected === 0) {
      await execute("UPDATE internal_transfers SET status = 'failed' WHERE id = ?", [transferId]);
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await execute(
      "UPDATE portfolios SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
      [pending.amount, pending.portfolio_id]
    );
    await execute(
      "UPDATE internal_transfers SET status = 'completed', verification_status = 'verified' WHERE id = ?",
      [transferId]
    );
    const portfolio = await queryOne("SELECT type FROM portfolios WHERE id = ?", [pending.portfolio_id]);
    await execute(
      "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'transfer', ?, ?)",
      [userId, `Transfer to ${portfolio.type} account (${pending.reference_id})`, pending.amount]
    );
    await logSecurityEvent("TRANSFER_VERIFIED", { userId, ip: req.ip, metadata: { transferId } });

    const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    res.json({ message: `Transferred $${pending.amount.toLocaleString()}`, referenceId: pending.reference_id, cashBalance: user.cash_balance, portfolioId: pending.portfolio_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

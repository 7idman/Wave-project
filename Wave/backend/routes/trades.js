/**
 * routes/trades.js
 * POST /api/trades — Execute buy, sell, deposit, or withdraw
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");
const { createAdminRequest } = require("../services/adminRequests");
const { generateReferenceId } = require("../utils/referenceId");
const { applyDepositBonus, getLockedBonusTotal } = require("../services/promotions");
const { checkReferralBonus, getLockedReferralBonusTotal } = require("../services/referrals");
const { getUserTier } = require("../services/tier");

const { checkAndRecord } = require("../services/rateLimit");
const { verifyTurnstileToken } = require("../services/turnstile");
const { sendVerificationCode, checkVerificationCode } = require("../services/twilio");
const { logSecurityEvent } = require("../middleware/security");
const { assessWithdrawalRisk } = require("../services/riskEngine");

const FEE_RATE     = 0.001; // 0.1% buy/sell
const WITHDRAW_FEE = 0.005; // 0.5% withdrawal
const MIN_DEPOSIT = 100; // matches the Bronze tier threshold
const WITHDRAWAL_VERIFICATION_THRESHOLD = parseFloat(process.env.WITHDRAWAL_VERIFICATION_THRESHOLD || "250");
const SENSITIVE_CHANGE_COOLDOWN_HOURS = parseInt(process.env.SENSITIVE_CHANGE_COOLDOWN_HOURS || "72", 10);

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

      // Referral bonus, if this user was referred and just crossed the
      // deposit threshold. Same isolation as above — never fails the deposit.
      try {
        await checkReferralBonus(userId);
      } catch (refErr) {
        console.error("Referral bonus check failed (deposit itself still succeeded):", refErr.message);
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
    // Withdrawal is the single most sensitive self-service action in the
    // app — real bookkeeping money leaving a user's tracked balance with
    // no admin gate. Hardened per the security architecture:
    //   rate limit -> cooldown check -> Turnstile -> (large amount? OTP) -> process
    if (type === "withdraw") {
      const { turnstileToken } = req.body;

      const [ipLimit, userLimit] = await Promise.all([
        checkAndRecord("withdraw", `ip:${req.ip}`,     { max: 5, windowMinutes: 30 }),
        checkAndRecord("withdraw", `user:${userId}`,   { max: 5, windowMinutes: 30 }),
      ]);
      if (!ipLimit.allowed || !userLimit.allowed) {
        await logSecurityEvent("WITHDRAWAL_BLOCKED", { userId, ip: req.ip, metadata: { reason: "rate_limit" } });
        return res.status(429).json({ error: "Too many withdrawal attempts. Please try again later." });
      }

      // Cooldown after a sensitive account change (password change, phone
      // re-verification, 2FA disable) — if an attacker just took over the
      // account and changed one of these, this window blocks them from
      // also draining funds immediately. Fails closed: an unparseable/
      // missing timestamp is NOT treated as "no recent change."
      if (req.user.last_sensitive_change_at) {
        const hoursSince = (Date.now() - new Date(req.user.last_sensitive_change_at + "Z").getTime()) / (1000 * 60 * 60);
        if (hoursSince < SENSITIVE_CHANGE_COOLDOWN_HOURS) {
          await logSecurityEvent("WITHDRAWAL_BLOCKED", { userId, ip: req.ip, metadata: { reason: "sensitive_change_cooldown", hoursRemaining: Math.ceil(SENSITIVE_CHANGE_COOLDOWN_HOURS - hoursSince) } });
          return res.status(403).json({
            error: `For your security, withdrawals are paused for ${SENSITIVE_CHANGE_COOLDOWN_HOURS} hours after a password change, phone update, or 2FA change. Try again in about ${Math.ceil(SENSITIVE_CHANGE_COOLDOWN_HOURS - hoursSince)} hour(s).`,
          });
        }
      }

      // Turnstile required on every withdrawal, not just progressively
      // like login — this is a CRITICAL-priority action per the security
      // architecture, not a login attempt where false positives are cheap.
      const turnstileResult = await verifyTurnstileToken(turnstileToken, req.ip);
      if (!turnstileResult.success) {
        await logSecurityEvent("TURNSTILE_FAILED", { userId, ip: req.ip, metadata: { route: "/trades:withdraw", reason: turnstileResult.reason } });
        return res.status(400).json({ error: "Verification failed — please try again.", code: "TURNSTILE_REQUIRED" });
      }

      const { tier } = await getUserTier(userId);
      const isVip = tier === "platinum";
      const fee   = isVip ? 0 : parseFloat((qty * WITHDRAW_FEE).toFixed(2));
      const total = parseFloat((qty + fee).toFixed(2));
      const referenceId = generateReferenceId("WD");

      // Risk engine — a HIGH-risk withdrawal gets the OTP step-up even
      // below the flat dollar threshold (e.g. an unusually large amount
      // for this specific account's history, or a VoIP phone on file).
      // sensitiveChangeRecent is always false by the time execution
      // reaches here, since that case already returned a 403 above — the
      // signal stays in the shared risk engine for reuse elsewhere.
      const withdrawalRisk = await assessWithdrawalRisk({
        userId, ip: req.ip, amount: qty,
        phoneVerified: Boolean(req.user.phone_verified && req.user.phone),
        sensitiveChangeRecent: false,
      });
      await logSecurityEvent("RISK_ASSESSED", { userId, ip: req.ip, metadata: { context: "withdraw", score: withdrawalRisk.score, level: withdrawalRisk.level, reasons: withdrawalRisk.reasons, amount: qty } });

      const needsOtp = qty >= WITHDRAWAL_VERIFICATION_THRESHOLD || withdrawalRisk.level === "HIGH";

      // Large or high-risk withdrawals additionally require a phone OTP —
      // same pending-then-confirm pattern as routes/transfers.js. Blocked
      // entirely (fail closed) if the account has no verified phone,
      // rather than silently skipping the check.
      if (needsOtp) {
        if (!req.user.phone_verified || !req.user.phone) {
          return res.status(403).json({ error: `This withdrawal requires a verified phone number. Add one in Settings first.` });
        }
        const otpLimit = await checkAndRecord("withdraw_otp_send", `user:${userId}`, { max: 5, windowMinutes: 30 });
        if (!otpLimit.allowed) return res.status(429).json({ error: "Too many verification requests. Please try again later." });

        const sendResult = await sendVerificationCode(req.user.phone);
        if (!sendResult.success) return res.status(503).json({ error: "Couldn't send verification code. Please try again." });

        const pending = await execute(
          "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status, reference_id) VALUES (?, 'withdraw', 'USD', ?, 1, ?, ?, 'pending', ?)",
          [userId, qty, fee, total, referenceId]
        );
        await logSecurityEvent("WITHDRAWAL_VERIFICATION_SENT", { userId, ip: req.ip, metadata: { amount: qty, riskLevel: withdrawalRisk.level } });

        return res.status(202).json({ message: "Verification required — check your phone for a code.", transactionId: pending.lastInsertRowid, referenceId });
      }

      // Concept: the WHERE clause below does the balance check AND the deduction
      // in one atomic step. If two withdraw requests arrive at the same instant,
      // only one can succeed — the second will see cash_balance already reduced
      // and its WHERE condition will fail, so rowsAffected comes back as 0.
      //
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
           AND (cash_balance
                - (SELECT COALESCE(SUM(amount),0) FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
                - (SELECT COALESCE(SUM(amount),0) FROM referral_bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
               ) >= ?`,
        [total, userId, total, userId, userId, total]
      );

      if (result.rowsAffected === 0) {
        const lockedBonus = (await getLockedBonusTotal(userId)) + (await getLockedReferralBonusTotal(userId));
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
      await logSecurityEvent("WITHDRAWAL_COMPLETED", { userId, ip: req.ip, metadata: { amount: qty } });
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

// POST /api/trades/withdraw/:id/confirm — the second step for a large
// withdrawal that came back 202 from the main handler above. Money moves
// ONLY here, and only after Twilio confirms the code directly — never
// because the frontend claims verification succeeded.
router.post("/withdraw/:id/confirm", async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    const transactionId = parseInt(req.params.id, 10);

    const pending = await queryOne(
      "SELECT * FROM transactions WHERE id = ? AND user_id = ? AND type = 'withdraw' AND status = 'pending'",
      [transactionId, userId]
    );
    if (!pending) return res.status(404).json({ error: "No pending withdrawal found." });

    const verifyLimit = await checkAndRecord("withdraw_otp_verify", `user:${userId}`, { max: 5, windowMinutes: 15 });
    if (!verifyLimit.allowed) return res.status(429).json({ error: "Too many attempts. Please try again later." });

    const check = await checkVerificationCode(req.user.phone, code);
    if (!check.approved) {
      await logSecurityEvent("WITHDRAWAL_VERIFICATION_FAILED", { userId, ip: req.ip, metadata: { transactionId } });
      return res.status(401).json({ error: "Invalid or expired code." });
    }

    // Same atomic guarded pattern as the direct (under-threshold) path —
    // still re-checked here, not assumed safe just because it was
    // pending — balances could have moved in the meantime.
    const result = await execute(
      `UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now')
       WHERE id = ?
         AND cash_balance >= ?
         AND (cash_balance
              - (SELECT COALESCE(SUM(amount),0) FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
              - (SELECT COALESCE(SUM(amount),0) FROM referral_bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
             ) >= ?`,
      [pending.total, userId, pending.total, userId, userId, pending.total]
    );
    if (result.rowsAffected === 0) {
      await execute("UPDATE transactions SET status = 'failed' WHERE id = ?", [transactionId]);
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await execute("UPDATE transactions SET status = 'completed' WHERE id = ?", [transactionId]);
    await logSecurityEvent("WITHDRAWAL_COMPLETED", { userId, ip: req.ip, metadata: { amount: pending.amount, verified: true } });

    const updated = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    res.json({ message: `Withdrawn $${pending.amount.toLocaleString()}`, cashBalance: updated.cash_balance, referenceId: pending.reference_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

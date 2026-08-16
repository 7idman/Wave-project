/**
 * routes/trades.js
 * POST /api/trades — Execute buy, sell, deposit, or withdraw
 */

const crypto = require("crypto");
const router = require("express").Router();
const { queryOne, execute, withTransaction } = require("../db");
const { createAdminRequest } = require("../services/adminRequests");
const { generateReferenceId } = require("../utils/referenceId");
const { getLockedBonusTotal } = require("../services/promotions");
const { getLockedReferralBonusTotal } = require("../services/referrals");
const { getUserTier } = require("../services/tier");

const { checkAndRecord } = require("../services/rateLimit");
const { verifyTurnstileToken } = require("../services/turnstile");
const { sendVerificationCode, checkVerificationCode } = require("../services/twilio");
const { sendWithdrawalEmailCode } = require("../services/email");
const { getDepositMethods, VALID_METHODS } = require("../services/depositMethods");
const { logSecurityEvent } = require("../middleware/security");
const { assessWithdrawalRisk } = require("../services/riskEngine");
const { parseMoneyToCents, roundMoneyToCents, centsFromRate, dollarsFromCents } = require("../utils/money");

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

const FEE_RATE     = 0.001; // 0.1% buy/sell
const WITHDRAW_FEE = 0.005; // 0.5% withdrawal
const MIN_DEPOSIT_CENTS = 10000; // matches the Bronze tier threshold
const SENSITIVE_CHANGE_COOLDOWN_HOURS = parseInt(process.env.SENSITIVE_CHANGE_COOLDOWN_HOURS || "72", 10);

// GET /api/trades/deposit-methods — returns whichever destination details
// have actually been configured via env vars (see services/depositMethods.js).
// A method with no env vars set simply doesn't appear here, rather than the
// frontend rendering a blank/placeholder address someone could send real
// funds into by mistake.
router.get("/deposit-methods", async (req, res) => {
  res.json(getDepositMethods());
});

router.post("/", async (req, res) => {
  try {
    const { type, symbol, amount, label, method, methodDetails } = req.body;
    const userId = req.user.id;

    if (!["buy","sell","deposit","withdraw","investment"].includes(type))
      return res.status(400).json({ error: "type must be buy, sell, deposit, withdraw, or investment" });
    const isAssetTrade = type === "buy" || type === "sell";
    const qty = isAssetTrade ? Number(amount) : null;
    if (isAssetTrade && (!Number.isFinite(qty) || qty <= 0))
      return res.status(400).json({ error: "amount must be a positive number" });
    const moneyCents = isAssetTrade ? null : parseMoneyToCents(amount);
    const moneyAmount = isAssetTrade ? null : dollarsFromCents(moneyCents);

    if (type === "deposit" && moneyCents < MIN_DEPOSIT_CENTS)
      return res.status(400).json({ error: `Minimum deposit is $${dollarsFromCents(MIN_DEPOSIT_CENTS)}` });

    // A plan activation reduces available cash, but it is not a withdrawal.
    // Keep it in a dedicated activity log so its notification is accurate.
    if (type === "investment") {
      const activityLabel = typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : "Investment plan";
      const outcome = await withTransaction(async tx => {
        const result = await tx.execute(
          "UPDATE users SET cash_balance_cents = cash_balance_cents - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance_cents >= ?",
          [moneyCents, userId, moneyCents]
        );
        if (result.rowsAffected === 0) return { error: "Insufficient balance" };
        await tx.execute(
          "INSERT INTO activity_log (user_id, type, label, amount, amount_cents) VALUES (?, ?, ?, ?, ?)",
          [userId, "investment", activityLabel, moneyAmount, moneyCents]
        );
        return tx.queryOne("SELECT cash_balance_cents FROM users WHERE id = ?", [userId]);
      });
      if (outcome.error) return res.status(400).json(outcome);
      return res.status(201).json({ message: `${activityLabel} activated`, cashBalance: dollarsFromCents(outcome.cash_balance_cents) });
    }

    // ── DEPOSIT ────────────────────────────────────────────────────────────
    // Deposits go to admin review, not an instant credit — this is money
    // coming INTO the platform (proof of payment / fraud check), same as
    // KYC and account deletion already do. admin.js's applyRequest() already
    // has full deposit-approval logic (credit balance, log transaction, push
    // notify, referral-bonus check) — this just routes into it correctly.
    if (type === "deposit") {
      if (!method || !VALID_METHODS.includes(method)) {
        return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(", ")}` });
      }
      const configuredMethods = getDepositMethods();
      if (!configuredMethods[method]) {
        return res.status(400).json({ error: "This deposit method isn't available right now." });
      }

      // A free-text reference the depositor provides — a tx hash, a
      // PayPal transaction ID, a bank transfer reference. Never trusted as
      // proof by itself (this is exactly why deposits still go to manual
      // admin review rather than auto-crediting on a matching string) —
      // it's just a pointer the admin can go check against what actually
      // arrived. Capped and stripped of control characters since it lands
      // directly in the admin console.
      const reference = typeof methodDetails?.reference === "string"
        ? methodDetails.reference.replace(/[\r\n\t]/g, " ").trim().slice(0, 200)
        : "";
      const coin = method === "crypto" && typeof methodDetails?.coin === "string"
        ? methodDetails.coin.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
        : undefined;
      if (method === "crypto" && (!coin || !configuredMethods.crypto.coins.some(c => c.symbol === coin))) {
        return res.status(400).json({ error: "Please select a valid coin." });
      }

      const methodLabel = method === "paypal" ? "PayPal" : method === "crypto" ? `Crypto (${coin})` : "Bank transfer";
      const r = await createAdminRequest({
        userId,
        type: "deposit",
        title: `Deposit request — $${moneyAmount.toLocaleString()} via ${methodLabel}`,
        details: `$${moneyAmount.toLocaleString()} deposit via ${methodLabel}${reference ? ` — ref: ${reference}` : ""}`,
        amount: moneyAmount,
        payload: { amount: moneyAmount, amountCents: moneyCents, method, coin, reference },
      });
      return res.status(202).json({
        message: `Deposit request for $${moneyAmount.toLocaleString()} sent for admin review`,
        requestId: r.id,
      });
    }

    // ── WITHDRAW ──────────────────────────────────────────────────────────
    // Withdrawal is the single most sensitive self-service action in the
    // app. Every withdrawal now requires BOTH an SMS code and an email
    // code before the request is even sent to an admin for manual review —
    // no withdrawal is processed automatically, regardless of amount.
    //   rate limit -> cooldown check -> Turnstile -> SMS+email codes sent -> confirm -> admin review -> admin approves -> balance moves
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

      // Every withdrawal requires a verified phone now that SMS is a
      // mandatory factor, not just a large-amount step-up — fail closed
      // rather than silently skip the check for accounts without one.
      if (!req.user.phone_verified || !req.user.phone) {
        return res.status(403).json({ error: "Withdrawals require a verified phone number. Add one in Settings first." });
      }

      const { tier } = await getUserTier(userId);
      const isVip = tier === "platinum";
      const feeCents = isVip ? 0 : centsFromRate(moneyCents, WITHDRAW_FEE);
      const totalCents = moneyCents + feeCents;
      const fee = dollarsFromCents(feeCents);
      const total = dollarsFromCents(totalCents);
      const referenceId = generateReferenceId("WD");

      // Read-only early check so someone without enough available balance
      // doesn't burn an SMS + email send for a request that can't go
      // anywhere. This is NOT the authoritative check — the balance can
      // still move between now and admin approval, so the same atomic
      // conditional deduction runs again (and is the real gate) when an
      // admin approves the request in admin.js.
      const balanceRow = await queryOne(
        `SELECT (cash_balance_cents
                 - (SELECT COALESCE(SUM(amount_cents),0) FROM bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
                 - (SELECT COALESCE(SUM(amount_cents),0) FROM referral_bonus_grants WHERE user_id = ? AND unlock_at > datetime('now'))
                ) AS available
         FROM users WHERE id = ?`,
        [userId, userId, userId]
      );
      if (!balanceRow || Number(balanceRow.available) < totalCents) {
        const lockedBonus = (await getLockedBonusTotal(userId)) + (await getLockedReferralBonusTotal(userId));
        return res.status(400).json({
          error: lockedBonus > 0
            ? `Insufficient available balance — $${lockedBonus.toLocaleString()} is locked bonus funds not yet available to withdraw`
            : "Insufficient balance",
        });
      }

      // Risk engine still runs for admin visibility — the level shows up
      // in the admin request so a reviewer can prioritize/flag it, even
      // though it no longer gates whether OTP is required (everything
      // requires it now).
      const withdrawalRisk = await assessWithdrawalRisk({
        userId, ip: req.ip, amount: moneyAmount,
        phoneVerified: true,
        sensitiveChangeRecent: false,
      });
      await logSecurityEvent("RISK_ASSESSED", { userId, ip: req.ip, metadata: { context: "withdraw", score: withdrawalRisk.score, level: withdrawalRisk.level, reasons: withdrawalRisk.reasons, amount: moneyAmount } });

      const otpLimit = await checkAndRecord("withdraw_otp_send", `user:${userId}`, { max: 5, windowMinutes: 30 });
      if (!otpLimit.allowed) return res.status(429).json({ error: "Too many verification requests. Please try again later." });

      const sendResult = await sendVerificationCode(req.user.phone);
      if (!sendResult.success) return res.status(503).json({ error: "Couldn't send SMS verification code. Please try again." });

      const emailCode = String(crypto.randomInt(100000, 1000000)); // 6 digits
      const emailCodeHash = hashCode(emailCode);
      try {
        await sendWithdrawalEmailCode({ to: req.user.email, name: req.user.name, code: emailCode, amount: moneyAmount.toLocaleString() });
      } catch (emailErr) {
        console.error("Withdrawal email code send failed:", emailErr.message);
        return res.status(503).json({ error: "Couldn't send email verification code. Please try again." });
      }

      const pending = await execute(
        `INSERT INTO transactions
           (user_id, type, symbol, amount, amount_cents, price, fee, fee_cents, total, total_cents, status, reference_id, email_otp_hash, email_otp_expires_at)
         VALUES (?, 'withdraw', 'USD', ?, ?, 1, ?, ?, ?, ?, 'pending', ?, ?, datetime('now', '+10 minutes'))`,
        [userId, moneyAmount, moneyCents, fee, feeCents, total, totalCents, referenceId, emailCodeHash]
      );
      await logSecurityEvent("WITHDRAWAL_VERIFICATION_SENT", { userId, ip: req.ip, metadata: { amount: moneyAmount, riskLevel: withdrawalRisk.level } });

      return res.status(202).json({
        message: "Verification required — check your phone and email for a code.",
        transactionId: pending.lastInsertRowid,
        referenceId,
      });
    }

    // ── BUY / SELL ────────────────────────────────────────────────────────
    if (!symbol) return res.status(400).json({ error: "symbol is required for buy/sell" });
    const sym      = symbol.toUpperCase();
    const priceRow = await queryOne("SELECT price FROM price_cache WHERE symbol = ?", [sym]);
    if (!priceRow) return res.status(404).json({ error: `Unknown symbol: ${sym}` });

    const price    = priceRow.price;
    const subtotalCents = roundMoneyToCents(qty * price);
    const feeCents = centsFromRate(subtotalCents, FEE_RATE);
    const totalCents = subtotalCents + feeCents;
    const fee = dollarsFromCents(feeCents);
    const total = dollarsFromCents(totalCents);

    const outcome = await withTransaction(async tx => {
      if (type === "buy") {
        const result = await tx.execute(
          "UPDATE users SET cash_balance_cents = cash_balance_cents - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance_cents >= ?",
          [totalCents, userId, totalCents]
        );
        if (result.rowsAffected === 0) return { error: "Insufficient cash balance" };

        await tx.execute(
          `INSERT INTO holdings (user_id, symbol, amount, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, symbol) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
          [userId, sym, qty]
        );
        await tx.execute(
          "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, fee_cents, total, total_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')",
          [userId, "buy", sym, qty, price, fee, feeCents, total, totalCents]
        );
      } else {
        const proceedsCents = subtotalCents - feeCents;
        const proceeds = dollarsFromCents(proceedsCents);
        const result = await tx.execute(
          "UPDATE holdings SET amount = amount - ?, updated_at = datetime('now') WHERE user_id = ? AND symbol = ? AND amount >= ?",
          [qty, userId, sym, qty]
        );
        if (result.rowsAffected === 0) return { error: "Insufficient holdings" };

        await tx.execute(
          "UPDATE users SET cash_balance_cents = cash_balance_cents + ?, updated_at = datetime('now') WHERE id = ?",
          [proceedsCents, userId]
        );
        await tx.execute(
          "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, fee_cents, total, total_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')",
          [userId, "sell", sym, qty, price, fee, feeCents, proceeds, proceedsCents]
        );
      }

      const user = await tx.queryOne("SELECT cash_balance_cents FROM users WHERE id = ?", [userId]);
      const holding = await tx.queryOne("SELECT amount FROM holdings WHERE user_id = ? AND symbol = ?", [userId, sym]);
      return { cashBalance: dollarsFromCents(user.cash_balance_cents), holding: holding?.amount ?? 0 };
    });
    if (outcome.error) return res.status(400).json(outcome);
    res.status(201).json({
      message:     `${type === "buy" ? "Bought" : "Sold"} ${qty} ${sym}`,
      cashBalance: outcome.cashBalance,
      holding:     outcome.holding,
    });
  } catch (err) {
    res.status(err instanceof TypeError || err instanceof RangeError ? 400 : 500).json({ error: err.message });
  }
});

// POST /api/trades/withdraw/:id/confirm — the second step after the main
// handler above sent both an SMS and an email code. Verifying both here
// does NOT move money — it only clears the withdrawal to be sent to an
// admin for manual review. Money moves only when an admin approves it.
router.post("/withdraw/:id/confirm", async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, emailCode } = req.body;
    const transactionId = parseInt(req.params.id, 10);

    const pending = await queryOne(
      "SELECT * FROM transactions WHERE id = ? AND user_id = ? AND type = 'withdraw' AND status = 'pending'",
      [transactionId, userId]
    );
    if (!pending) return res.status(404).json({ error: "No pending withdrawal found." });

    // Claim the row atomically before doing anything else. If two confirm
    // requests for the same withdrawal arrive together (double-tap, replay),
    // only one can flip status from 'pending' to 'processing' — the loser
    // gets rowsAffected === 0 here and is rejected before it ever spends an
    // OTP check, closing the same class of race the rest of this codebase
    // already guards against with cash_balance >= ?.
    const claim = await execute(
      "UPDATE transactions SET status = 'processing' WHERE id = ? AND status = 'pending'",
      [transactionId]
    );
    if (claim.rowsAffected === 0) {
      return res.status(409).json({ error: "This withdrawal is already being processed." });
    }

    const verifyLimit = await checkAndRecord("withdraw_otp_verify", `user:${userId}`, { max: 5, windowMinutes: 15 });
    if (!verifyLimit.allowed) {
      await execute("UPDATE transactions SET status = 'pending' WHERE id = ? AND status = 'processing'", [transactionId]);
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }

    // Check the email code first — it's a cheap local comparison, so a
    // wrong email code fails fast without spending a Twilio Verify call
    // (billed) or risking burning a valid SMS code the user hasn't
    // re-entered yet. Not cleared/consumed here — only after BOTH codes
    // check out below — so a legitimate retry with a corrected SMS code
    // doesn't force the user to also get a fresh email code.
    const emailValid = Boolean(emailCode) && pending.email_otp_hash
      && pending.email_otp_expires_at && new Date(pending.email_otp_expires_at + "Z").getTime() > Date.now()
      && hashCode(emailCode) === pending.email_otp_hash;
    if (!emailValid) {
      await execute("UPDATE transactions SET status = 'pending' WHERE id = ? AND status = 'processing'", [transactionId]);
      await logSecurityEvent("WITHDRAWAL_VERIFICATION_FAILED", { userId, ip: req.ip, metadata: { transactionId, factor: "email" } });
      return res.status(401).json({ error: "Invalid or expired email code." });
    }

    const check = await checkVerificationCode(req.user.phone, code);
    if (!check.approved) {
      await execute("UPDATE transactions SET status = 'pending' WHERE id = ? AND status = 'processing'", [transactionId]);
      await logSecurityEvent("WITHDRAWAL_VERIFICATION_FAILED", { userId, ip: req.ip, metadata: { transactionId, factor: "sms" } });
      return res.status(401).json({ error: "Invalid or expired SMS code." });
    }

    // Both factors checked out — consume the email code and hand off to
    // admin review. No balance changes here; the same atomic conditional
    // deduction used everywhere else in this file runs again when an
    // admin approves the request (admin.js), since the balance can still
    // move between now and then.
    await execute(
      "UPDATE transactions SET status = 'awaiting_review', email_otp_hash = NULL, email_otp_expires_at = NULL WHERE id = ?",
      [transactionId]
    );
    const r = await createAdminRequest({
      userId,
      type: "withdraw",
      title: `Withdrawal request — $${pending.amount.toLocaleString()}`,
      details: `$${pending.amount.toLocaleString()} withdrawal (fee $${pending.fee.toLocaleString()})`,
      amount: pending.amount,
      payload: { transactionId, amount: pending.amount, fee: pending.fee, total: pending.total, referenceId: pending.reference_id },
    });
    await logSecurityEvent("WITHDRAWAL_SENT_FOR_REVIEW", { userId, ip: req.ip, metadata: { transactionId, amount: pending.amount } });

    res.status(202).json({
      message: `Withdrawal verified — $${pending.amount.toLocaleString()} sent for admin review`,
      requestId: r.id,
      referenceId: pending.reference_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trades/withdraw/:id/resend-code — re-sends the phone code for a
// still-pending withdrawal, either by SMS again or as a voice call. Doesn't
// touch the email code (that one's separate and unaffected). Twilio Verify
// invalidates the previous code automatically when a new one is sent for
// the same phone number, so only the latest code will ever check out.
router.post("/withdraw/:id/resend-code", async (req, res) => {
  try {
    const userId = req.user.id;
    const transactionId = parseInt(req.params.id, 10);
    const channel = req.body?.channel === "voice" ? "voice" : "sms";

    const pending = await queryOne(
      "SELECT * FROM transactions WHERE id = ? AND user_id = ? AND type = 'withdraw' AND status = 'pending'",
      [transactionId, userId]
    );
    if (!pending) return res.status(404).json({ error: "No pending withdrawal found." });

    const resendLimit = await checkAndRecord("withdraw_otp_resend", `user:${userId}`, { max: 5, windowMinutes: 30 });
    if (!resendLimit.allowed) return res.status(429).json({ error: "Too many resend attempts. Please try again later." });

    const sendResult = await sendVerificationCode(req.user.phone, channel);
    if (!sendResult.success) return res.status(503).json({ error: `Couldn't ${channel === "voice" ? "call" : "text"} you a new code. Please try again.` });

    await logSecurityEvent("WITHDRAWAL_CODE_RESENT", { userId, ip: req.ip, metadata: { transactionId, channel } });
    res.json({ message: channel === "voice" ? "Calling you now with your code." : "New code sent by text." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

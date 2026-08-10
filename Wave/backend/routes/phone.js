/**
 * routes/phone.js
 * POST /api/phone/send-code   — start phone verification (Lookup + Verify send)
 * POST /api/phone/verify-code — confirm the code, mark phone verified
 *
 * Replaces the old "Add Phone Number" flow, which saved whatever number
 * was typed in and marked it verified instantly with no actual check.
 */

const router = require("express").Router();
const { queryOne, execute } = require("../db");
const { normalizeToE164, lookupLineType, sendVerificationCode, checkVerificationCode } = require("../services/twilio");
const { checkAndRecord } = require("../services/rateLimit");
const { logSecurityEvent } = require("../middleware/security");

const OTP_SEND_MAX   = parseInt(process.env.OTP_SEND_MAX   || "5", 10);
const OTP_VERIFY_MAX = parseInt(process.env.OTP_VERIFY_MAX || "5", 10);
const OTP_WINDOW_MIN = parseInt(process.env.OTP_WINDOW_MINUTES || "30", 10);

router.post("/send-code", async (req, res) => {
  try {
    const phone = normalizeToE164(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Please enter a valid phone number." });

    // Rate limit by phone AND by user — an attacker can't spam SMS to a
    // victim's phone by rotating accounts, and a single account can't spam
    // its own number either.
    const [phoneLimit, userLimit] = await Promise.all([
      checkAndRecord("otp_send", `phone:${phone}`,        { max: OTP_SEND_MAX, windowMinutes: OTP_WINDOW_MIN }),
      checkAndRecord("otp_send", `user:${req.user.id}`,   { max: OTP_SEND_MAX, windowMinutes: OTP_WINDOW_MIN }),
    ]);
    if (!phoneLimit.allowed || !userLimit.allowed) {
      return res.status(429).json({ error: "Too many verification requests. Please try again later." });
    }

    const lookup = await lookupLineType(phone);
    if (lookup.error === "twilio_not_configured") {
      console.error("Twilio is not configured — failing closed on phone verification.");
      return res.status(503).json({ error: "Phone verification is temporarily unavailable. Please try again later." });
    }
    if (!lookup.valid) return res.status(400).json({ error: "That doesn't look like a valid phone number." });

    if (lookup.lineType === "landline") {
      await logSecurityEvent("PHONE_VERIFICATION_REJECTED", { userId: req.user.id, ip: req.ip, metadata: { reason: "landline" } });
      return res.status(400).json({ error: "Landline numbers can't receive SMS codes. Please use a mobile number." });
    }
    if (lookup.lineType === "voip") {
      // Elevated risk, not an automatic block — VoIP numbers are common
      // for legitimate users (Google Voice, etc.), so we flag it for the
      // audit trail rather than rejecting outright.
      await logSecurityEvent("VOIP_PHONE_DETECTED", { userId: req.user.id, ip: req.ip, metadata: { phoneLast4: phone.slice(-4) } });
    }

    const sendResult = await sendVerificationCode(phone);
    if (!sendResult.success) {
      return res.status(503).json({ error: "Couldn't send the verification code. Please try again." });
    }

    await execute("UPDATE users SET phone_pending = ? WHERE id = ?", [phone, req.user.id]);
    await logSecurityEvent("PHONE_VERIFICATION_SENT", { userId: req.user.id, ip: req.ip, metadata: { lineType: lookup.lineType } });

    res.json({ message: "Verification code sent.", lineType: lookup.lineType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/verify-code", async (req, res) => {
  try {
    const { code } = req.body;
    const user = await queryOne("SELECT phone_pending FROM users WHERE id = ?", [req.user.id]);
    if (!user?.phone_pending) return res.status(400).json({ error: "Start phone verification first." });

    const verifyLimit = await checkAndRecord("otp_verify", `user:${req.user.id}`, { max: OTP_VERIFY_MAX, windowMinutes: 15 });
    if (!verifyLimit.allowed) {
      return res.status(429).json({ error: "Too many attempts. Please request a new code." });
    }

    // The backend asks Twilio directly whether phone_pending + code are a
    // valid pair — never trusts a client-supplied verification claim.
    const check = await checkVerificationCode(user.phone_pending, code);
    if (!check.approved) {
      await logSecurityEvent("PHONE_VERIFICATION_FAILED", { userId: req.user.id, ip: req.ip });
      return res.status(401).json({ error: "Invalid or expired code." });
    }

    await execute(
      "UPDATE users SET phone = phone_pending, phone_verified = 1, phone_pending = NULL, last_sensitive_change_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [req.user.id]
    );
    await logSecurityEvent("PHONE_VERIFIED", { userId: req.user.id, ip: req.ip });

    const updated = await queryOne("SELECT phone, phone_verified FROM users WHERE id = ?", [req.user.id]);
    res.json({ message: "Phone number verified.", phone: updated.phone, phoneVerified: Boolean(updated.phone_verified) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

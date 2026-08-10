/**
 * routes/referrals.js
 * GET /api/referrals/me — the current user's referral code, link, and the
 * list of friends they've referred (with bonus status).
 */

const router = require("express").Router();
const { queryOne } = require("../db");
const {
  generateReferralCode, getReferralSummary,
  REFERRER_BONUS, REFEREE_BONUS, DEPOSIT_THRESHOLD,
} = require("../services/referrals");

router.get("/me", async (req, res) => {
  try {
    // Accounts created before this feature shipped won't have a code yet —
    // generate one on first visit to this page instead of a startup backfill.
    const existing = await queryOne("SELECT referral_code FROM users WHERE id = ?", [req.user.id]);
    if (!existing?.referral_code) await generateReferralCode(req.user.id);

    const summary = await getReferralSummary(req.user.id);
    res.json({ ...summary, referrerBonus: REFERRER_BONUS, refereeBonus: REFEREE_BONUS, depositThreshold: DEPOSIT_THRESHOLD });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/**
 * services/referrals.js
 * Referral program: every user gets a code at signup. A friend who signs up
 * with that code creates a 'pending' referrals row. Once the referred
 * friend's LIFETIME completed deposits cross threshold_amount ($100), both
 * sides get a flat cash bonus — credited immediately but withdrawal-locked
 * for REFERRAL_LOCK_DAYS, same "usable for trading right away, not
 * cashoutable yet" pattern as services/promotions.js.
 */

const { queryOne, queryAll, execute, withTransaction } = require("../db");
const { getLifetimeDeposits } = require("./tier");

const REFERRER_BONUS = 10;
const REFEREE_BONUS  = 5;
const REFERRAL_LOCK_DAYS = 7;
const DEPOSIT_THRESHOLD  = 100;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids misreads

function randomCode(len = 8) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

// Called once at registration for every new user. Retries on the rare
// collision — the UNIQUE index on users.referral_code is the real guard.
async function generateReferralCode(userId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      const result = await execute(
        "UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL",
        [code, userId]
      );
      if (result.rowsAffected > 0) return code;
      // referral_code was already set (shouldn't happen at signup, but safe) — return existing.
      const row = await queryOne("SELECT referral_code FROM users WHERE id = ?", [userId]);
      if (row?.referral_code) return row.referral_code;
    } catch (err) {
      if (!/UNIQUE/i.test(err.message)) throw err; // collision — try again
    }
  }
  throw new Error("Could not generate a unique referral code — please try again");
}

// Called during registration if a referralCode was supplied. Silently
// no-ops on an invalid or self-referral code rather than blocking signup —
// a bad/typo'd code shouldn't be able to stop someone from creating an
// account.
async function linkReferral(refereeId, code) {
  if (!code || typeof code !== "string") return null;
  const referrer = await queryOne("SELECT id FROM users WHERE referral_code = ?", [code.trim().toUpperCase()]);
  if (!referrer || referrer.id === refereeId) return null;

  try {
    return await withTransaction(async tx => {
      await tx.execute(
        "INSERT INTO referrals (referrer_id, referee_id, status, threshold_amount) VALUES (?, ?, 'pending', ?)",
        [referrer.id, refereeId, DEPOSIT_THRESHOLD]
      );
      await tx.execute("UPDATE users SET referred_by = ? WHERE id = ?", [referrer.id, refereeId]);
      return referrer.id;
    });
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return null; // referee already linked to someone — ignore
    throw err;
  }
}

// Call after ANY completed deposit (self-service in trades.js, or
// admin-approved in admin.js). Cheap no-op for the vast majority of
// deposits, since most users have no pending referral row at all.
async function checkReferralBonus(refereeId) {
  const referral = await queryOne(
    "SELECT * FROM referrals WHERE referee_id = ? AND status = 'pending'",
    [refereeId]
  );
  if (!referral) return null;

  const lifetimeDeposits = await getLifetimeDeposits(refereeId);
  if (lifetimeDeposits < referral.threshold_amount) return null;

  const unlockAt = new Date(Date.now() + REFERRAL_LOCK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");

  return withTransaction(async tx => {
    const flipped = await tx.execute(
      "UPDATE referrals SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND status = 'pending'",
      [referral.id]
    );
    if (flipped.rowsAffected === 0) return null;

    for (const [userId, role, amount] of [
      [referral.referrer_id, "referrer", REFERRER_BONUS],
      [referral.referee_id,  "referee",  REFEREE_BONUS],
    ]) {
      const credited = await tx.execute(
        "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [amount, userId]
      );
      if (credited.rowsAffected === 0) throw new Error("Referral bonus recipient no longer exists");
      await tx.execute(
        "INSERT INTO referral_bonus_grants (user_id, referral_id, role, amount, unlock_at) VALUES (?, ?, ?, ?, ?)",
        [userId, referral.id, role, amount, unlockAt]
      );
    }

    return { referrerId: referral.referrer_id, refereeId: referral.referee_id, referrerBonus: REFERRER_BONUS, refereeBonus: REFEREE_BONUS, unlockAt };
  });
}

// Sum of still-locked referral bonus money — added into the withdrawal
// guard alongside bonus_grants (see trades.js and promotions.js).
async function getLockedReferralBonusTotal(userId) {
  const row = await queryOne(
    "SELECT COALESCE(SUM(amount),0) AS total FROM referral_bonus_grants WHERE user_id = ? AND unlock_at > datetime('now')",
    [userId]
  );
  return row.total;
}

// Everything a user needs for their own Referrals page.
async function getReferralSummary(userId) {
  const user = await queryOne("SELECT referral_code FROM users WHERE id = ?", [userId]);
  const referrals = await queryAll(
    `SELECT r.id, r.status, r.threshold_amount, r.completed_at, r.created_at,
            u.name AS refereeName
     FROM referrals r JOIN users u ON u.id = r.referee_id
     WHERE r.referrer_id = ?
     ORDER BY r.created_at DESC`,
    [userId]
  );
  const earnedRow = await queryOne(
    "SELECT COALESCE(SUM(amount),0) AS total FROM referral_bonus_grants WHERE user_id = ? AND role = 'referrer'",
    [userId]
  );
  return {
    code: user?.referral_code || null,
    totalEarned: earnedRow.total,
    referrals: referrals.map(r => ({
      id: r.id,
      refereeName: r.refereeName,
      status: r.status,
      thresholdAmount: r.threshold_amount,
      completedAt: r.completed_at,
      createdAt: r.created_at,
    })),
  };
}

module.exports = {
  REFERRER_BONUS, REFEREE_BONUS, REFERRAL_LOCK_DAYS, DEPOSIT_THRESHOLD,
  generateReferralCode, linkReferral, checkReferralBonus,
  getLockedReferralBonusTotal, getReferralSummary,
};

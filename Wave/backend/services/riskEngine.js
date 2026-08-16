/**
 * services/riskEngine.js
 * Centralized, deterministic risk scoring — NOT a fake AI system. Every
 * signal below is a real, cheap DB lookup against data this app already
 * collects (security_events, rate_limit_entries, trusted_devices, users).
 * No ML, no black box — every score is fully explainable from `reasons`.
 *
 * Returns { score, level, reasons, actions }. `reasons` is for the audit
 * log only — routes must NEVER put raw reasons in a response body, per the
 * security architecture's explicit instruction not to expose internal
 * risk reasoning to the end user.
 *
 * Weights and thresholds are env-configurable rather than hardcoded, so
 * they can be tuned from real usage data without a code change.
 */

const { queryOne } = require("../db");

const WEIGHTS = {
  NEW_DEVICE:              parseInt(process.env.RISK_W_NEW_DEVICE || "30", 10),
  RECENT_LOGIN_FAILURES:   parseInt(process.env.RISK_W_LOGIN_FAILURES || "15", 10), // per failure, capped below
  VOIP_PHONE:              parseInt(process.env.RISK_W_VOIP_PHONE || "15", 10),
  UNVERIFIED_PHONE:        parseInt(process.env.RISK_W_UNVERIFIED_PHONE || "10", 10),
  NEW_ACCOUNT:             parseInt(process.env.RISK_W_NEW_ACCOUNT || "15", 10), // account created < 24h ago
  RECENT_SENSITIVE_CHANGE: parseInt(process.env.RISK_W_SENSITIVE_CHANGE || "25", 10),
  REPEATED_TURNSTILE_FAIL: parseInt(process.env.RISK_W_TURNSTILE_FAIL || "10", 10), // per failure, capped below
  HIGH_SIGNUP_VELOCITY:    parseInt(process.env.RISK_W_SIGNUP_VELOCITY || "20", 10),
  UNUSUAL_WITHDRAWAL:      parseInt(process.env.RISK_W_UNUSUAL_WITHDRAWAL || "20", 10),
};

const THRESHOLD_MEDIUM = parseInt(process.env.RISK_THRESHOLD_MEDIUM || "30", 10);
const THRESHOLD_HIGH   = parseInt(process.env.RISK_THRESHOLD_HIGH   || "60", 10);

function levelForScore(score) {
  if (score >= THRESHOLD_HIGH) return "HIGH";
  if (score >= THRESHOLD_MEDIUM) return "MEDIUM";
  return "LOW";
}

function actionsForLevel(level) {
  if (level === "HIGH") return ["REQUIRE_TURNSTILE", "REQUIRE_OTP"];
  if (level === "MEDIUM") return ["REQUIRE_TURNSTILE"];
  return [];
}

// ── Individual signal lookups — each is a small, cheap, real query ─────────

async function recentTurnstileFailures(ip) {
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM security_events WHERE type = 'TURNSTILE_FAILED' AND ip = ? AND created_at > datetime('now', '-30 minutes')",
    [ip]
  );
  return row.c;
}

async function recentVoipFlag(userId) {
  if (!userId) return false;
  const row = await queryOne(
    "SELECT id FROM security_events WHERE type = 'VOIP_PHONE_DETECTED' AND user_id = ? AND created_at > datetime('now', '-30 days')",
    [userId]
  );
  return Boolean(row);
}

async function signupVelocity(ip) {
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM rate_limit_entries WHERE scope = 'signup' AND identifier = ? AND created_at > datetime('now', '-30 minutes')",
    [`ip:${ip}`]
  );
  return row.c;
}

// Flags a withdrawal that's unusually large relative to the account's own
// recent history — not a fixed dollar amount (that's the separate,
// simpler WITHDRAWAL_VERIFICATION_THRESHOLD check in trades.js), but "does
// this look like a departure from how this specific account normally
// behaves." A brand new account withdrawing a lot is also flagged, since
// there's no history to compare against.
async function isUnusualWithdrawal(userId, amount) {
  const row = await queryOne(
    `SELECT AVG(amount) AS avg_amt, COUNT(*) AS n FROM transactions
     WHERE user_id = ? AND type = 'withdraw' AND status = 'completed'
       AND created_at > datetime('now', '-90 days')`,
    [userId]
  );
  if (!row.n || row.n < 2) return amount > 500; // no real history yet — fall back to a flat "large for a new account" check
  return amount > row.avg_amt * 3;
}

/**
 * assessLoginRisk({ userId, ip, deviceTrusted, recentFailedLogins, accountCreatedAt })
 * Call AFTER the user row is looked up (or with userId=null for a
 * not-found email, so the score computes the same either way and can't be
 * used to probe account existence).
 */
async function assessLoginRisk({ userId, ip, deviceTrusted, recentFailedLogins = 0, accountCreatedAt }) {
  const reasons = [];
  let score = 0;

  if (!deviceTrusted) { score += WEIGHTS.NEW_DEVICE; reasons.push("NEW_DEVICE"); }

  if (recentFailedLogins > 0) {
    const add = Math.min(recentFailedLogins * WEIGHTS.RECENT_LOGIN_FAILURES, 45);
    score += add; reasons.push("RECENT_LOGIN_FAILURES");
  }

  const turnstileFails = await recentTurnstileFailures(ip);
  if (turnstileFails > 0) {
    score += Math.min(turnstileFails * WEIGHTS.REPEATED_TURNSTILE_FAIL, 30);
    reasons.push("REPEATED_TURNSTILE_FAILURES");
  }

  if (accountCreatedAt) {
    const ageHours = (Date.now() - new Date(accountCreatedAt + "Z").getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) { score += WEIGHTS.NEW_ACCOUNT; reasons.push("NEW_ACCOUNT"); }
  }

  const level = levelForScore(score);
  return { score, level, reasons, actions: actionsForLevel(level) };
}

/**
 * assessSignupRisk({ ip })
 */
async function assessSignupRisk({ ip }) {
  const reasons = [];
  let score = 0;

  const velocity = await signupVelocity(ip);
  if (velocity >= 3) { score += WEIGHTS.HIGH_SIGNUP_VELOCITY; reasons.push("HIGH_SIGNUP_VELOCITY"); }

  const turnstileFails = await recentTurnstileFailures(ip);
  if (turnstileFails > 0) {
    score += Math.min(turnstileFails * WEIGHTS.REPEATED_TURNSTILE_FAIL, 30);
    reasons.push("REPEATED_TURNSTILE_FAILURES");
  }

  const level = levelForScore(score);
  return { score, level, reasons, actions: actionsForLevel(level) };
}

/**
 * assessWithdrawalRisk({ userId, ip, amount, phoneVerified, sensitiveChangeRecent })
 */
async function assessWithdrawalRisk({ userId, ip, amount, phoneVerified, sensitiveChangeRecent }) {
  const reasons = [];
  let score = 0;

  if (!phoneVerified) { score += WEIGHTS.UNVERIFIED_PHONE; reasons.push("UNVERIFIED_PHONE"); }
  if (sensitiveChangeRecent) { score += WEIGHTS.RECENT_SENSITIVE_CHANGE; reasons.push("RECENT_SENSITIVE_CHANGE"); }

  if (await recentVoipFlag(userId)) { score += WEIGHTS.VOIP_PHONE; reasons.push("VOIP_PHONE"); }
  if (await isUnusualWithdrawal(userId, amount)) { score += WEIGHTS.UNUSUAL_WITHDRAWAL; reasons.push("UNUSUAL_WITHDRAWAL_AMOUNT"); }

  const level = levelForScore(score);
  return { score, level, reasons, actions: actionsForLevel(level) };
}

module.exports = { assessLoginRisk, assessSignupRisk, assessWithdrawalRisk };

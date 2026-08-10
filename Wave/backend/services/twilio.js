/**
 * services/twilio.js
 * Twilio Verify (OTP send/check) + Twilio Lookup (line-type detection —
 * mobile / VoIP / landline). No OTP codes are ever generated or stored by
 * this app — Twilio Verify owns that state entirely; we only ever ask it
 * "did this phone+code combination check out?" and trust its answer, never
 * a client-supplied { otpVerified: true }.
 *
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
 * as Railway env vars — never hardcoded, never logged.
 */

const twilio = require("twilio");

let _client = null;
function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!_client) _client = twilio(sid, token);
  return _client;
}

// Minimal E.164 normalization/validation. Twilio Lookup will do the
// authoritative validation, but rejecting obviously-malformed input here
// avoids burning a Lookup API call (they're billed) on garbage input.
function normalizeToE164(raw) {
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw.trim().replace(/[\s().-]/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+1" + cleaned.replace(/^1/, ""); // default to US/Canada if no country code given
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}

// Returns { valid, lineType } where lineType is 'mobile' | 'voip' |
// 'landline' | 'unknown'. Never throws for a "just doesn't look valid"
// case — that's a normal outcome the caller handles, not an error.
async function lookupLineType(phoneE164) {
  const client = getClient();
  if (!client) return { valid: false, lineType: "unknown", error: "twilio_not_configured" };

  try {
    const result = await client.lookups.v2.phoneNumbers(phoneE164).fetch({ fields: "line_type_intelligence" });
    if (!result.valid) return { valid: false, lineType: "unknown" };
    const type = result.lineTypeIntelligence?.type; // 'mobile' | 'landline' | 'voip' | 'nonFixedVoip' | ...
    const lineType = type === "mobile" ? "mobile" : type === "landline" ? "landline" : (type || "").toLowerCase().includes("voip") ? "voip" : "unknown";
    return { valid: true, lineType };
  } catch (err) {
    console.error("Twilio Lookup failed:", err.message);
    return { valid: false, lineType: "unknown", error: "lookup_failed" };
  }
}

async function sendVerificationCode(phoneE164, channel = "sms") {
  const client = getClient();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!client || !serviceSid) return { success: false, reason: "twilio_not_configured" };
  const verifyChannel = channel === "call" || channel === "voice" ? "call" : "sms";

  try {
    const verification = await client.verify.v2.services(serviceSid).verifications.create({ to: phoneE164, channel: verifyChannel });
    return { success: true, status: verification.status };
  } catch (err) {
    console.error("Twilio Verify send failed:", err.message);
    return { success: false, reason: "send_failed" };
  }
}

// The ONLY place that decides whether a code is correct. Always asks
// Twilio directly — this function's return value is the sole source of
// truth, never something the frontend can assert.
async function checkVerificationCode(phoneE164, code) {
  const client = getClient();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!client || !serviceSid) return { approved: false, reason: "twilio_not_configured" };
  if (!code || typeof code !== "string") return { approved: false, reason: "missing_code" };

  try {
    const check = await client.verify.v2.services(serviceSid).verificationChecks.create({ to: phoneE164, code: code.trim() });
    return { approved: check.status === "approved" };
  } catch (err) {
    // Twilio throws on some invalid-code / expired-challenge cases rather
    // than returning a "pending" status — treat any error here as "not
    // approved," never as "approved by default."
    console.error("Twilio Verify check failed:", err.message);
    return { approved: false, reason: "check_failed" };
  }
}

module.exports = { normalizeToE164, lookupLineType, sendVerificationCode, checkVerificationCode, getClient };

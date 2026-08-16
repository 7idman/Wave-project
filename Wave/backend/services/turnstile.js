/**
 * services/turnstile.js
 * Cloudflare Turnstile server-side verification.
 *
 * TURNSTILE_SECRET_KEY must be set as a Railway env var — NEVER put it in
 * frontend/Vite env vars (that's what VITE_TURNSTILE_SITE_KEY, the public
 * site key, is for). The existence of a token proves nothing on its own;
 * only this server-side check against Cloudflare does.
 *
 * Fails CLOSED: if the secret key is missing, or Cloudflare's endpoint
 * errors/times out, verification returns false rather than silently
 * passing. For a security-critical action (signup, login step-up,
 * withdrawal) that means the action is blocked, not silently allowed —
 * deliberate per the security architecture this belongs to.
 */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const { fetchWithTimeout } = require("../utils/http");

async function verifyTurnstileToken(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set — failing closed, verification rejected.");
    return { success: false, reason: "not_configured" };
  }
  if (!token || typeof token !== "string") {
    return { success: false, reason: "missing_token" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetchWithTimeout(TURNSTILE_VERIFY_URL, { method: "POST", body });

    if (!res.ok) {
      console.error(`Turnstile verify HTTP error: ${res.status}`);
      return { success: false, reason: "cloudflare_error" };
    }
    const data = await res.json();
    if (!data.success) {
      return { success: false, reason: (data["error-codes"] || []).join(",") || "invalid_token" };
    }
    return { success: true };
  } catch (err) {
    // Network error, timeout, malformed response, etc. — fail closed.
    console.error("Turnstile verification failed (failing closed):", err.message);
    return { success: false, reason: "verification_unavailable" };
  }
}

module.exports = { verifyTurnstileToken };

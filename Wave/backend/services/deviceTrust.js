/**
 * services/deviceTrust.js
 * Server-side device recognition. A device is identified by a random,
 * unguessable value stored in an httpOnly cookie the browser can't read or
 * tamper with via JS — never a client-supplied claim like
 * `{ trusted: true }`. Trust itself lives entirely in the trusted_devices
 * table and expires (see DEVICE_TRUST_DAYS) rather than being permanent.
 */

const crypto = require("crypto");
const { queryOne, execute } = require("../db");

const DEVICE_COOKIE_NAME = "wave_device_id";
const DEVICE_TRUST_DAYS  = parseInt(process.env.DEVICE_TRUST_DAYS || "60", 10);
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // 400 days — the browser-enforced ceiling for cookie lifetime

// Reads the device_id cookie if present, otherwise mints a new one and sets
// it on the response. Returns { deviceId, isNewCookie } — isNewCookie just
// means "the browser had no cookie at all," NOT "this device is untrusted
// for this user" (those are checked separately via isDeviceTrusted).
function getOrSetDeviceId(req, res) {
  let deviceId = req.cookies?.[DEVICE_COOKIE_NAME];
  let isNewCookie = false;
  if (!deviceId || typeof deviceId !== "string" || !/^[a-f0-9]{48}$/.test(deviceId)) {
    deviceId = crypto.randomBytes(24).toString("hex");
    isNewCookie = true;
    res.cookie(DEVICE_COOKIE_NAME, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    });
  }
  return { deviceId, isNewCookie };
}

async function isDeviceTrusted(userId, deviceId) {
  if (!deviceId) return false;
  const row = await queryOne(
    "SELECT id FROM trusted_devices WHERE user_id = ? AND device_id = ? AND expires_at > datetime('now')",
    [userId, deviceId]
  );
  return Boolean(row);
}

// Called after a FULL successful authentication (password, plus 2FA if
// enabled) — never after just a password check, since that's exactly the
// step an attacker with a stolen password would also pass. Upserts, so a
// device's trust window keeps refreshing every time it's actually used,
// while a device that goes quiet naturally ages out.
async function trustDevice(userId, deviceId, label) {
  if (!deviceId) return;
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");
  await execute(
    `INSERT INTO trusted_devices (user_id, device_id, label, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET
       last_seen_at = datetime('now'), expires_at = excluded.expires_at, label = excluded.label`,
    [userId, deviceId, label || null, expiresAt]
  );

  // Cap trusted devices per user — a device that's still using an old
  // session doesn't need an unbounded number of trust rows piling up.
  await execute(
    `DELETE FROM trusted_devices WHERE user_id = ? AND id NOT IN (
       SELECT id FROM trusted_devices WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 10
     )`,
    [userId, userId]
  );
}

module.exports = { getOrSetDeviceId, isDeviceTrusted, trustDevice };

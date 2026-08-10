/**
 * services/rateLimit.js
 * DB-backed rate limiting — deliberately not in-memory, so limits survive a
 * Railway restart/redeploy and stay correct even if the app ever scales to
 * multiple instances. Turso is the only persistent store here (no Redis),
 * so this leans on a small indexed table rather than adding infrastructure.
 *
 * This complements, not replaces, the existing in-memory express-rate-limit
 * on /login and /register — that one is a cheap first line of defense;
 * this one adds the per-email/per-phone dimensions IP alone can't cover.
 */

const { queryOne, execute } = require("../db");

// Cheap self-cleanup: roughly 1 in 50 calls also sweeps rows older than a
// day for that scope, so the table never needs a separate cron job or grows
// unbounded — no extra scheduled process, no extra infrastructure.
async function opportunisticCleanup(scope) {
  if (Math.random() > 0.02) return;
  try {
    await execute(
      "DELETE FROM rate_limit_entries WHERE scope = ? AND created_at < datetime('now', '-1 day')",
      [scope]
    );
  } catch (_) { /* cleanup is best-effort, never worth failing a request over */ }
}

// Records this attempt AND tells the caller whether it's still within
// limits. Recording happens unconditionally (even on the attempt that
// trips the limit) so the count is always accurate for the next check —
// a client can't "waste" attempts by retrying without them counting.
async function checkAndRecord(scope, identifier, { max, windowMinutes }) {
  if (!identifier) return { allowed: true, remaining: max, count: 0 };

  await execute(
    "INSERT INTO rate_limit_entries (scope, identifier) VALUES (?, ?)",
    [scope, identifier]
  );
  opportunisticCleanup(scope); // fire-and-forget, never awaited/blocking

  const row = await queryOne(
    `SELECT COUNT(*) AS count FROM rate_limit_entries
     WHERE scope = ? AND identifier = ? AND created_at > datetime('now', ?)`,
    [scope, identifier, `-${windowMinutes} minutes`]
  );
  const count = row.count;
  return { allowed: count <= max, remaining: Math.max(0, max - count), count };
}

// Read-only check — for cases like "should login require Turnstile" where
// you want to know the current failure count WITHOUT this check itself
// counting as an attempt.
async function peek(scope, identifier, { windowMinutes }) {
  if (!identifier) return { count: 0 };
  const row = await queryOne(
    `SELECT COUNT(*) AS count FROM rate_limit_entries
     WHERE scope = ? AND identifier = ? AND created_at > datetime('now', ?)`,
    [scope, identifier, `-${windowMinutes} minutes`]
  );
  return { count: row.count };
}

module.exports = { checkAndRecord, peek };

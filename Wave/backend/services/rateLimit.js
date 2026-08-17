/**
 * Durable database-backed rate limiting shared by every Railway replica.
 * IP, email, phone, and user dimensions all use the same indexed table.
 */

const { queryOne, withTransaction } = require("../db");

// Record the attempt and read its new count in one transaction. Roughly one
// in fifty calls also cleans expired rows inside that same transaction so a
// maintenance write can never race the next request on local SQLite.
async function checkAndRecord(scope, identifier, { max, windowMinutes }) {
  if (!identifier) return { allowed: true, remaining: max, count: 0 };

  const shouldCleanup = Math.random() <= 0.02;
  const count = await withTransaction(async tx => {
    if (shouldCleanup) {
      await tx.execute(
        "DELETE FROM rate_limit_entries WHERE scope = ? AND created_at < datetime('now', '-1 day')",
        [scope]
      );
    }
    await tx.execute(
      "INSERT INTO rate_limit_entries (scope, identifier) VALUES (?, ?)",
      [scope, identifier]
    );
    const row = await tx.queryOne(
      `SELECT COUNT(*) AS count FROM rate_limit_entries
       WHERE scope = ? AND identifier = ? AND created_at > datetime('now', ?)`,
      [scope, identifier, `-${windowMinutes} minutes`]
    );
    return Number(row.count);
  });
  return { allowed: count <= max, remaining: Math.max(0, max - count), count };
}

// Read without recording an attempt. Used to decide whether progressive
// challenges such as Turnstile should be shown.
async function peek(scope, identifier, { windowMinutes }) {
  if (!identifier) return { count: 0 };
  const row = await queryOne(
    `SELECT COUNT(*) AS count FROM rate_limit_entries
     WHERE scope = ? AND identifier = ? AND created_at > datetime('now', ?)`,
    [scope, identifier, `-${windowMinutes} minutes`]
  );
  return { count: Number(row.count) };
}

module.exports = { checkAndRecord, peek };

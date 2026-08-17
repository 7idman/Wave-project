const session = require("express-session");
const { execute, queryOne } = require("../db");
const { runWithSchedulerLease } = require("./schedulerLease");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupInFlight = null;

function sqliteDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return new Date(Date.now() + DEFAULT_TTL_MS)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sessionExpiry(sessionData) {
  const expires = sessionData?.cookie?.expires;
  if (expires) return sqliteDateTime(expires);
  const maxAge = Number(sessionData?.cookie?.maxAge);
  return sqliteDateTime(Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_TTL_MS));
}

class LibsqlSessionStore extends session.Store {
  get(sid, callback) {
    queryOne(
      "SELECT session_json FROM http_sessions WHERE sid = ? AND expires_at > datetime('now')",
      [sid]
    ).then(row => {
      if (!row) return callback(null, null);
      try {
        return callback(null, JSON.parse(row.session_json));
      } catch {
        // A malformed server-side session must be invalidated, never passed
        // into Passport or allowed to break every request using that cookie.
        execute("DELETE FROM http_sessions WHERE sid = ?", [sid]).catch(() => {});
        return callback(null, null);
      }
    }).catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    let serialized;
    try {
      serialized = JSON.stringify(sessionData);
    } catch (error) {
      callback(error);
      return;
    }

    execute(
      `INSERT INTO http_sessions (sid, session_json, expires_at, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(sid) DO UPDATE SET
         session_json = excluded.session_json,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      [sid, serialized, sessionExpiry(sessionData)]
    ).then(() => callback(null)).catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    execute(
      `UPDATE http_sessions
       SET expires_at = ?, updated_at = datetime('now')
       WHERE sid = ?`,
      [sessionExpiry(sessionData), sid]
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    execute("DELETE FROM http_sessions WHERE sid = ?", [sid])
      .then(() => callback(null))
      .catch(callback);
  }

  cleanupExpired() {
    return execute("DELETE FROM http_sessions WHERE expires_at <= datetime('now')");
  }
}

function startSessionCleanupSchedule(store, intervalMs = CLEANUP_INTERVAL_MS) {
  const run = () => {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = runWithSchedulerLease(
      "http-session-cleanup",
      intervalMs,
      () => store.cleanupExpired()
    ).finally(() => { cleanupInFlight = null; });
    return cleanupInFlight;
  };
  run().catch(error => console.error("Session cleanup failed:", error.message));
  const handle = setInterval(() => {
    run().catch(error => console.error("Session cleanup failed:", error.message));
  }, intervalMs);
  return handle;
}

function waitForSessionCleanupIdle() {
  return cleanupInFlight || Promise.resolve();
}

module.exports = {
  LibsqlSessionStore,
  startSessionCleanupSchedule,
  waitForSessionCleanupIdle,
};

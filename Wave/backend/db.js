/**
 * db.js — Wave platform database layer
 * Uses @libsql/client — works with:
 *   - Local SQLite file  (LIBSQL_URL=file:wave.db)
 *   - Turso cloud DB     (LIBSQL_URL=libsql://... + LIBSQL_AUTH_TOKEN=...)
 *
 * ALL functions are async and return:
 *   execute(sql, args)  → { rows, rowsAffected, lastInsertRowid }
 *   queryOne(sql, args) → first row object or null
 *   queryAll(sql, args) → array of row objects
 */

require("dotenv").config();
const { createClient } = require("@libsql/client");

const db = createClient({
  url:       process.env.LIBSQL_URL       || "file:wave.db",
  authToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
});

// ── Helper: turn libsql ResultSet rows into plain objects ──────────────────
function toObjects(result) {
  const cols = result.columns;
  return result.rows.map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a write query (INSERT / UPDATE / DELETE / CREATE / ALTER)
 * Returns { rowsAffected, lastInsertRowid }
 */
async function execute(sql, args = []) {
  const result = await db.execute({ sql, args });
  return {
    rowsAffected:   result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid != null
      ? Number(result.lastInsertRowid)
      : null,
  };
}

/**
 * Run a SELECT and return the first matching row, or null
 */
async function queryOne(sql, args = []) {
  const result = await db.execute({ sql, args });
  const rows = toObjects(result);
  return rows[0] ?? null;
}

/**
 * Run a SELECT and return all matching rows
 */
async function queryAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return toObjects(result);
}

/**
 * Run multiple statements in a single batch (atomic)
 * Pass array of { sql, args } objects
 */
async function batch(stmts) {
  return db.batch(stmts.map(s => ({ sql: s.sql, args: s.args || [] })));
}

// ── Schema bootstrap ────────────────────────────────────────────────────────
async function initSchema() {
  // Run each CREATE TABLE individually instead of batching them together.
  // Batching DDL statements against Turso's cloud HTTP API was triggering
  // "Unexpected status code while fetching migration jobs: 400" regardless
  // of batch mode ("deferred" or "write"). Running them one at a time avoids
  // that code path entirely. Each uses IF NOT EXISTS, so this is safe to
  // re-run on every boot even if a previous attempt partially completed.
  const tables = [
    `CREATE TABLE IF NOT EXISTS roles (
      role_key    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '{}',
      is_owner    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id        TEXT    UNIQUE,
      email            TEXT    UNIQUE NOT NULL,
      name             TEXT    NOT NULL,
      password_hash    TEXT,
      phone            TEXT,
      phone_verified   INTEGER NOT NULL DEFAULT 0,
      avatar_url       TEXT,
      date_of_birth    TEXT,
      country          TEXT,
      kyc_id_status    TEXT    NOT NULL DEFAULT 'pending',
      kyc_addr_status  TEXT    NOT NULL DEFAULT 'pending',
      cash_balance     REAL    NOT NULL DEFAULT 0.00,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT    UNIQUE NOT NULL,
      expires_at TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS holdings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol     TEXT    NOT NULL,
      amount     REAL    NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, symbol)
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL CHECK(type IN ('buy','sell','deposit','withdraw')),
      symbol     TEXT    NOT NULL,
      amount     REAL    NOT NULL,
      price      REAL    NOT NULL,
      fee        REAL    NOT NULL DEFAULT 0,
      total      REAL    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'completed',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS price_cache (
      symbol     TEXT PRIMARY KEY,
      price      REAL NOT NULL,
      change_24h REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device     TEXT    NOT NULL,
      ip         TEXT,
      login_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      logout_at  TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS site_updates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      amount     REAL    NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS admin_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_email        TEXT    NOT NULL,
      user_name         TEXT    NOT NULL,
      type              TEXT    NOT NULL,
      title             TEXT    NOT NULL,
      details           TEXT,
      amount            REAL,
      payload           TEXT    NOT NULL DEFAULT '{}',
      status            TEXT    NOT NULL DEFAULT 'pending',
      reviewed_by       INTEGER,
      reviewed_by_email TEXT,
      reviewed_at       TEXT,
      admin_note        TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint          TEXT    NOT NULL UNIQUE,
      subscription_json TEXT    NOT NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // ── Safe migrations (ADD COLUMN IF NOT EXISTS equivalent) ────────────────
  const migrations = [
    "ALTER TABLE users ADD COLUMN phone            TEXT",
    "ALTER TABLE users ADD COLUMN phone_verified   INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN avatar_url       TEXT",
    "ALTER TABLE users ADD COLUMN date_of_birth    TEXT",
    "ALTER TABLE users ADD COLUMN country          TEXT",
    "ALTER TABLE users ADD COLUMN kyc_id_status    TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE users ADD COLUMN kyc_addr_status  TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN ban_reason TEXT",
    "ALTER TABLE refresh_tokens ADD COLUMN session_id INTEGER",
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch (_) { /* column already exists — skip */ }
  }

  const defaultRoles = [
    ["owner", "Owner", {access_admin:true,manage_requests:true,manage_roles:true,manage_members:true,manage_announcements:true,ban_users:true}, 1],
    ["admin", "Admin", {access_admin:true,manage_requests:true,manage_announcements:true,ban_users:true}, 0],
    ["support", "Support", {access_admin:true,manage_requests:true}, 0],
    ["compliance", "Compliance", {access_admin:true,manage_requests:true,ban_users:true}, 0],
    ["user", "User", {}, 0],
  ];
  for (const [key, name, permissions, isOwner] of defaultRoles) {
    await execute("INSERT OR IGNORE INTO roles (role_key, name, permissions, is_owner) VALUES (?, ?, ?, ?)", [key, name, JSON.stringify(permissions), isOwner]);
  }
  const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (ownerEmail) {
    const result = await execute("UPDATE users SET role='owner' WHERE lower(email)=?", [ownerEmail]);
    console.log(`Owner check: OWNER_EMAIL=${ownerEmail} → ${result.rowsAffected} row(s) updated to owner`);
    } else {
    console.warn("⚠️  OWNER_EMAIL is not set — no account will be assigned the owner role.");
    }
  // ── Seed price cache ──────────────────────────────────────────────────────
  const count = await queryOne("SELECT COUNT(*) as c FROM price_cache");
  if (!count || Number(count.c) === 0) {
    const seeds = [
      ["BTC",  67420.50,  2.34],
      ["ETH",  3521.80,  -1.12],
      ["SOL",  178.40,    5.67],
      ["ADA",  0.612,    -0.45],
      ["LINK", 18.92,     3.21],
    ];
    for (const [sym, price, change] of seeds) {
      await execute(
        "INSERT OR IGNORE INTO price_cache (symbol, price, change_24h) VALUES (?, ?, ?)",
        [sym, price, change]
      );
    }
  }

  // ── Seed site updates ──────────────────────────────────────────────────────
  const updateCount = await queryOne("SELECT COUNT(*) as c FROM site_updates");
  if (!updateCount || Number(updateCount.c) === 0) {
    await execute(
      "INSERT INTO site_updates (title, body) VALUES (?, ?)",
      ["Welcome to Wave", "Your account starts with a zero balance. Add funds when you are ready, then explore the dashboard, place trades, and check back here for new features as they ship."]
    );
  }

  console.log("✅ Database ready");
}

module.exports = { execute, queryOne, queryAll, batch, initSchema };

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
    )`,    `CREATE TABLE IF NOT EXISTS price_cache (
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
    `CREATE TABLE IF NOT EXISTS admin_actions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_email    TEXT,
      action         TEXT    NOT NULL,
      target_user_id INTEGER NOT NULL,
      reason         TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // ── Multi-portfolio support ──────────────────────────────────────────────
    // A "portfolio" is any account beyond the user's original main balance
    // (users.cash_balance + holdings). user_id is NULL for a strategy's own
    // trading account — that account isn't owned by any one user.
    `CREATE TABLE IF NOT EXISTS portfolios (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT    NOT NULL CHECK(type IN ('copier','managed','strategy')),
      strategy_id  INTEGER REFERENCES strategies(id),
      cash_balance REAL    NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS strategies (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      description  TEXT,
      fee          REAL    NOT NULL DEFAULT 0,
      portfolio_id INTEGER REFERENCES portfolios(id),
      status       TEXT    NOT NULL DEFAULT 'active',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS strategy_trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      symbol      TEXT    NOT NULL,
      side        TEXT    NOT NULL CHECK(side IN ('buy','sell')),
      amount      REAL    NOT NULL,
      price       REAL    NOT NULL,
      admin_id    INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // One row per subscriber per trade — the audit trail proving exactly what
    // was mirrored into whose account and why.
    `CREATE TABLE IF NOT EXISTS strategy_trade_mirrors (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_trade_id INTEGER NOT NULL REFERENCES strategy_trades(id) ON DELETE CASCADE,
      user_id           INTEGER NOT NULL REFERENCES users(id),
      portfolio_id      INTEGER NOT NULL REFERENCES portfolios(id),
      mirrored_amount   REAL    NOT NULL,
      mirrored_price    REAL    NOT NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS internal_transfers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction           TEXT    NOT NULL CHECK(direction IN ('to_portfolio','from_portfolio')),
      portfolio_id        INTEGER NOT NULL REFERENCES portfolios(id),
      amount              REAL    NOT NULL,
      reference_id        TEXT    NOT NULL UNIQUE,
      verification_status TEXT    NOT NULL DEFAULT 'not_required',
      status              TEXT    NOT NULL DEFAULT 'completed',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Deliberately separate from `holdings` (see chat) — keeps the live main
    // trading engine (trades.js) completely untouched. One row per
    // (portfolio, symbol); safe to use ON CONFLICT upserts here since every
    // portfolio_id here is a real, non-null id — no NULL-uniqueness pitfall.
    `CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      symbol       TEXT    NOT NULL,
      amount       REAL    NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(portfolio_id, symbol)
    )`,
    // ── Ranking-tier deposit bonuses ────────────────────────────────────────
    // An admin-configured promotion: users at/above min_tier who deposit at
    // least min_deposit while the promotion is active get bonus_pct credited.
    // Admin-editable security thresholds. A DB override here takes
    // priority over the env-var default (see services/settings.js) — lets
    // an admin tune values like the withdrawal verification threshold from
    // the admin panel instead of needing a Railway redeploy. Falls back to
    // the env var, then a hardcoded default, if no row exists for a key.
    `CREATE TABLE IF NOT EXISTS platform_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_by  INTEGER REFERENCES users(id),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS promotions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      bonus_pct   REAL    NOT NULL,
      min_tier    TEXT    NOT NULL DEFAULT 'bronze',
      min_deposit REAL    NOT NULL DEFAULT 0,
      lock_days   INTEGER NOT NULL DEFAULT 0,
      start_at    TEXT    NOT NULL,
      end_at      TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Whether a bonus is still locked is always computed live from unlock_at
    // (unlock_at > now = locked) rather than a separate status column — a
    // second source of truth for the same fact is just something that can
    // drift out of sync with reality.
    `CREATE TABLE IF NOT EXISTS bonus_grants (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      promotion_id   INTEGER NOT NULL REFERENCES promotions(id),
      transaction_id INTEGER REFERENCES transactions(id),
      amount         REAL    NOT NULL,
      unlock_at      TEXT    NOT NULL,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Referral bonuses live in their own grants table rather than reusing
    // bonus_grants, since bonus_grants.promotion_id is NOT NULL and a
    // referral isn't a promotions-table row. The withdrawal-lock check
    // (trades.js + promotions.js getLockedBonusTotal) sums BOTH tables —
    // keep them in sync if a third bonus source is ever added.
    `CREATE TABLE IF NOT EXISTS referral_bonus_grants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referral_id INTEGER NOT NULL REFERENCES referrals(id),
      role        TEXT    NOT NULL, -- 'referrer' | 'referee'
      amount      REAL    NOT NULL,
      unlock_at   TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // One row per successful referral link (referrer's code used at referee's
    // signup). status flips pending -> completed once the referee's lifetime
    // completed deposits cross threshold_amount — checked after every
    // completed deposit, in both the self-service and admin-approved paths.
    `CREATE TABLE IF NOT EXISTS referrals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referee_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      status           TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'completed'
      threshold_amount REAL    NOT NULL DEFAULT 100,
      completed_at     TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // One row per rate-limited attempt (signup, login-failure, OTP send,
    // etc). scope+identifier is e.g. ("login_fail","email:user@x.com") or
    // ("signup","ip:1.2.3.4"). Checked by COUNT(*) WHERE scope=? AND
    // identifier=? AND created_at > now-window — DB-backed so it survives
    // restarts/redeploys and works across multiple dimensions, unlike the
    // original in-memory IP-only limiter it complements (not replaces).
    `CREATE TABLE IF NOT EXISTS rate_limit_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scope       TEXT    NOT NULL,
      identifier  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Structured security audit trail. Never store passwords, raw OTP
    // codes, or third-party secrets/tokens here — metadata only.
    `CREATE TABLE IF NOT EXISTS security_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ip          TEXT,
      metadata    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Device trust is per (user, device_id) — the same browser used to log
    // into two different accounts gets two independent trust records, on
    // purpose (shared/family computers are a normal case). device_id
    // itself is a random, unguessable cookie value (see
    // services/deviceTrust.js) — never derived from anything client-
    // supplied like a "trusted" boolean. expires_at enforces rotation:
    // trust isn't permanent, it lapses and has to be re-earned.
    `CREATE TABLE IF NOT EXISTS trusted_devices (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id    TEXT    NOT NULL,
      label        TEXT,
      first_seen_at TEXT   NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT    NOT NULL,
      UNIQUE(user_id, device_id)
    )`,
    // Frontend crash reports from ErrorBoundary components — user_id is
    // self-reported by the client (not verified, since the app may be in a
    // broken/unauthenticated state when this fires) and is for triage
    // context only, never treated as an authenticated claim.
    `CREATE TABLE IF NOT EXISTS client_errors (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER,
      message          TEXT,
      stack            TEXT,
      component_stack  TEXT,
      boundary         TEXT,
      url              TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Recurring weekly stock purchases. next_run_at is checked against
    // "now" by the scheduler (services/autoInvest.js) rather than a naive
    // fixed setInterval offset, so a Railway restart never causes a missed
    // or double-counted week — the due-check is always against real wall-
    // clock time, not "how long has this process been running."
    `CREATE TABLE IF NOT EXISTS auto_invest_plans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol        TEXT    NOT NULL,
      weekly_amount REAL    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'cancelled'
      last_run_at   TEXT,
      next_run_at   TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Checked on the same 15-min cadence as price snapshotting (see
    // services/priceAlerts.js) — a triggered alert flips to 'triggered'
    // and stays that way (one notification per alert, not repeated every
    // cycle the price stays past the target).
    `CREATE TABLE IF NOT EXISTS price_alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol       TEXT    NOT NULL,
      condition    TEXT    NOT NULL, -- 'above' | 'below'
      target_price REAL    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'triggered' | 'cancelled'
      triggered_at TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Periodic price snapshots, captured going forward from whenever this
    // table first gets rows — there's no way to reconstruct prices from
    // before snapshotting started, so history begins exactly at "now".
    `CREATE TABLE IF NOT EXISTS price_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol      TEXT    NOT NULL,
      price       REAL    NOT NULL,
      change_24h  REAL,
      recorded_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // ── Safe migrations (ADD COLUMN IF NOT EXISTS equivalent) ────────────────
  const migrations = [
    "ALTER TABLE users ADD COLUMN phone            TEXT",
    "ALTER TABLE users ADD COLUMN phone_verified   INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN phone_pending    TEXT",
    "ALTER TABLE users ADD COLUMN last_sensitive_change_at TEXT",
    "ALTER TABLE sessions ADD COLUMN device_id TEXT",
    "ALTER TABLE users ADD COLUMN avatar_url       TEXT",
    "ALTER TABLE users ADD COLUMN date_of_birth    TEXT",
    "ALTER TABLE users ADD COLUMN country          TEXT",
    "ALTER TABLE users ADD COLUMN kyc_id_status    TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE users ADD COLUMN kyc_addr_status  TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN ban_reason TEXT",
    "ALTER TABLE users ADD COLUMN totp_secret TEXT",
    "ALTER TABLE users ADD COLUMN totp_secret_pending TEXT",
    "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN totp_backup_codes TEXT",
    "ALTER TABLE users ADD COLUMN referral_code TEXT",
    "ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)",
    "ALTER TABLE refresh_tokens ADD COLUMN session_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_price_history_symbol_time ON price_history(symbol, recorded_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)",
    "CREATE INDEX IF NOT EXISTS idx_rate_limit_scope_id_time ON rate_limit_entries(scope, identifier, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_security_events_type_time ON security_events(type, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_device ON trusted_devices(user_id, device_id)",
    "CREATE INDEX IF NOT EXISTS idx_auto_invest_status_next_run ON auto_invest_plans(status, next_run_at)",
    "CREATE INDEX IF NOT EXISTS idx_price_alerts_status_symbol ON price_alerts(status, symbol)",
    "ALTER TABLE price_cache ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'crypto'",
    "ALTER TABLE transactions ADD COLUMN reference_id TEXT",
    "ALTER TABLE transactions ADD COLUMN source TEXT",
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
  // ── VIP (Platinum tier) permanent deposit bonus ─────────────────────────
  // Reuses the same promotions engine admins use for time-boxed campaigns —
  // this one just has an effectively permanent window. Editable/endable
  // from the admin Promotions tab like any other promotion.
  const vipPromoExists = await queryOne("SELECT id FROM promotions WHERE name = 'VIP Deposit Bonus'");
  if (!vipPromoExists) {
    await execute(
      "INSERT INTO promotions (name, bonus_pct, min_tier, min_deposit, lock_days, start_at, end_at) VALUES (?,?,?,?,?,?,?)",
      ["VIP Deposit Bonus", 0.12, "platinum", 0, 7, "2020-01-01 00:00:00", "2099-01-01 00:00:00"]
    );
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

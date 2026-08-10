/**
 * services/priceAlerts.js
 * Checks active price alerts against the current price_cache, on the same
 * 15-min cadence as price snapshotting (called from
 * services/priceSnapshot.js's schedule, right after each snapshot). Reuses
 * the existing Web Push infra (notifyUserPush) — the same mechanism
 * already used for balance-update notifications.
 */

const { queryAll, queryOne, execute } = require("../db");
const { notifyUserPush } = require("./push");

async function checkAlerts() {
  const alerts = await queryAll("SELECT * FROM price_alerts WHERE status = 'active'");
  let triggered = 0;

  for (const alert of alerts) {
    const priceRow = await queryOne("SELECT price FROM price_cache WHERE symbol = ?", [alert.symbol]);
    if (!priceRow) continue; // symbol not in cache (yet, or ever) — nothing to compare against

    const price = priceRow.price;
    const hit = alert.condition === "above" ? price >= alert.target_price : price <= alert.target_price;
    if (!hit) continue;

    // Atomic guard: flips active -> triggered only if it's still active.
    // Without this, two overlapping checker runs (or a slow run plus the
    // next scheduled one) could both see it as active and send the push
    // notification twice for the same crossing.
    const result = await execute(
      "UPDATE price_alerts SET status = 'triggered', triggered_at = datetime('now') WHERE id = ? AND status = 'active'",
      [alert.id]
    );
    if (result.rowsAffected === 0) continue;

    try {
      await notifyUserPush(alert.user_id, {
        type: "price_alert",
        title: `${alert.symbol} ${alert.condition === "above" ? "hit" : "dropped to"} $${alert.target_price}`,
        body: `Current price: $${price.toLocaleString()}`,
      });
    } catch (err) {
      // A failed push must never re-flip the alert back to active and
      // spam-retry — it already fired, from the app's point of view. Worst
      // case here is the user just doesn't get a device notification for
      // this one, but the alert (correctly) stops watching.
      console.error(`Price alert push failed for alert ${alert.id}:`, err.message);
    }

    await execute(
      "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'price_alert', ?, 0)",
      [alert.user_id, `${alert.symbol} ${alert.condition === "above" ? "reached" : "dropped to"} $${alert.target_price}`]
    );
    triggered++;
  }

  return { checked: alerts.length, triggered };
}

module.exports = { checkAlerts };

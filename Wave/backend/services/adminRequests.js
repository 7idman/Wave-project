const { queryOne, execute } = require("../db");
const { notifyAdmins } = require("./push");
const { roundMoneyToCents, dollarsFromCents } = require("../utils/money");

async function createAdminRequest({ userId, type, title, details = null, amount = null, payload = {} }) {
  const user = await queryOne("SELECT id,email,name FROM users WHERE id=?", [userId]);
  if (!user) throw new Error("User not found");
  const amountCents = amount == null ? null : roundMoneyToCents(amount);
  const normalizedAmount = amountCents == null ? null : dollarsFromCents(amountCents);
  const r = await execute(
    "INSERT INTO admin_requests (user_id,user_email,user_name,type,title,details,amount,amount_cents,payload) VALUES (?,?,?,?,?,?,?,?,?)",
    [user.id, user.email, user.name, type, title, details, normalizedAmount, amountCents, JSON.stringify(payload || {})]
  );
  await notifyAdmins({ title: "New admin request", body: `${user.name} requested ${title}`, url: "/" });
  return { id: r.lastInsertRowid };
}

module.exports = { createAdminRequest };

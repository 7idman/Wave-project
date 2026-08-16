const crypto = require("node:crypto");
const { execute } = require("../db");

const instanceId = process.env.RAILWAY_REPLICA_ID
  || process.env.RAILWAY_DEPLOYMENT_ID
  || crypto.randomUUID();

function leaseModifier(leaseMs) {
  const safeMs = Number.isFinite(Number(leaseMs)) ? Number(leaseMs) : 60_000;
  const seconds = Math.max(1, Math.ceil(safeMs / 1000));
  return `+${seconds} seconds`;
}

async function tryAcquireSchedulerLease(jobName, leaseMs, ownerId = instanceId) {
  if (!jobName || typeof jobName !== "string") {
    throw new TypeError("Scheduler lease requires a job name");
  }

  const result = await execute(
    `INSERT INTO scheduler_leases (job_name, owner_id, lease_until, updated_at)
     VALUES (?, ?, datetime('now', ?), datetime('now'))
     ON CONFLICT(job_name) DO UPDATE SET
       owner_id = excluded.owner_id,
       lease_until = excluded.lease_until,
       updated_at = excluded.updated_at
     WHERE scheduler_leases.lease_until <= datetime('now')`,
    [jobName, ownerId, leaseModifier(leaseMs)]
  );
  return result.rowsAffected === 1;
}

async function runWithSchedulerLease(jobName, leaseMs, task) {
  const acquired = await tryAcquireSchedulerLease(jobName, leaseMs);
  if (!acquired) return { acquired: false, value: null };
  return { acquired: true, value: await task() };
}

module.exports = {
  tryAcquireSchedulerLease,
  runWithSchedulerLease,
};

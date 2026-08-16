const { checkAndRecord } = require("../services/rateLimit");

function databaseRateLimit({ scope, max, windowMinutes, message = "Too many attempts, please try again later." }) {
  return async function databaseRateLimitMiddleware(req, res, next) {
    try {
      const result = await checkAndRecord(scope, `ip:${req.ip}`, { max, windowMinutes });
      res.set("RateLimit-Limit", String(max));
      res.set("RateLimit-Remaining", String(result.remaining));
      if (!result.allowed) {
        res.set("Retry-After", String(windowMinutes * 60));
        return res.status(429).json({ error: message });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { databaseRateLimit };

function validateProductionSecrets(env = process.env) {
  const isProduction = env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT_ID);
  if (!isProduction) return;
  const missing = ["JWT_SECRET", "SESSION_SECRET"].filter(name => !env[name]);
  if (missing.length) {
    throw new Error(`Missing required production secret(s): ${missing.join(", ")}`);
  }
  if (env.JWT_SECRET.length < 32 || env.SESSION_SECRET.length < 32) {
    throw new Error("JWT_SECRET and SESSION_SECRET must each be at least 32 characters in production");
  }
  if (env.JWT_SECRET === env.SESSION_SECRET) {
    throw new Error("JWT_SECRET and SESSION_SECRET must be different values");
  }
}

module.exports = { validateProductionSecrets };

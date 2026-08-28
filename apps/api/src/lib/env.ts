import "dotenv/config";

/** Render exposes service hosts without a scheme; add one so fetch() works. */
function withScheme(value: string): string {
  if (!value) return value;
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: withScheme(process.env.WEB_ORIGIN ?? "http://localhost:5173"),

  databaseUrl: required("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/betterme"),
  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",

  agentsUrl: withScheme(process.env.AGENTS_URL ?? "http://localhost:8000"),
  agentsSharedSecret: process.env.AGENTS_SHARED_SECRET ?? "dev-shared-secret",

  plaidClientId: process.env.PLAID_CLIENT_ID ?? "",
  plaidSecret: process.env.PLAID_SECRET ?? "",
  plaidEnv: (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "production",

  enableScheduler: (process.env.ENABLE_SCHEDULER ?? "true") === "true",
  cronSecret: process.env.CRON_SECRET ?? "dev-cron-secret",
};

export const plaidConfigured = Boolean(env.plaidClientId && env.plaidSecret);

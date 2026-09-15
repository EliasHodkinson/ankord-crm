/**
 * Environment access. Everything is read lazily so the app still boots — and
 * renders a useful setup screen — while variables are still being filled in.
 */

const KEYS = [
  "DATABASE_URL",
  "AZURE_AD_TENANT_ID",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "APP_ENCRYPTION_KEY",
  "APP_URL",
] as const;

export type EnvKey = (typeof KEYS)[number];

export function optionalEnv(key: EnvKey): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(key: EnvKey): string {
  const value = optionalEnv(key);
  if (!value) {
    throw new Error(
      `Missing environment variable ${key}. Add it to .env.local (or the Vercel project) and restart.`,
    );
  }
  return value;
}

/** Which required variables are still missing, for the setup screen. */
export function missingEnv(): EnvKey[] {
  return KEYS.filter((k) => !optionalEnv(k));
}

export const isDatabaseConfigured = () => Boolean(optionalEnv("DATABASE_URL"));

export const isAuthConfigured = () =>
  Boolean(
    optionalEnv("AZURE_AD_TENANT_ID") &&
      optionalEnv("AZURE_AD_CLIENT_ID") &&
      optionalEnv("AZURE_AD_CLIENT_SECRET") &&
      optionalEnv("APP_ENCRYPTION_KEY"),
  );

/**
 * The externally reachable origin. Falls back to the Vercel-provided URL so
 * preview deployments work without extra configuration.
 */
export function appUrl(): string {
  const explicit = optionalEnv("APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const redirectUri = () => `${appUrl()}/api/auth/callback`;

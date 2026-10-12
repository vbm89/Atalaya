// @ts-check
/**
 * Fail-safe migration gate for `scripts/migrate.mjs` (DEV ops branch).
 *
 * `npm run build` ends with `db:migrate`, so every Vercel build would migrate
 * DATABASE_URL. Isolation of the DEV database from PROD is not proven, so a
 * build never migrates unless ALLOW_DB_MIGRATE=1 is set explicitly (exactly "1").
 * Run migrations on purpose with: ALLOW_DB_MIGRATE=1 npm run db:migrate
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} skip reason, or null when migrating may proceed
 */
export function migrationSkipReason(env) {
  if (env.ALLOW_DB_MIGRATE !== "1") {
    return "ALLOW_DB_MIGRATE is not 1 (migrations are opt-in)";
  }
  return null;
}

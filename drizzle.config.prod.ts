import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Production config — targets the Turso production database via the TURSO_PROD_*
// env vars, totally separate from the staging/dev credentials in drizzle.config.ts.
// Migration files are shared (generated once by `db:generate`, applied to each DB),
// so `out` points at the same folder as the default config.
if (!process.env.TURSO_PROD_DATABASE_URL) {
  throw new Error("TURSO_PROD_DATABASE_URL is not set — add it to .env before running db:*:prod");
}
if (!process.env.TURSO_PROD_AUTH_TOKEN) {
  throw new Error("TURSO_PROD_AUTH_TOKEN is not set — paste the production token into .env");
}

export default defineConfig({
  dialect: "turso",
  schema: "./database/schema.ts",
  out: "./database/migrations",
  dbCredentials: {
    url: process.env.TURSO_PROD_DATABASE_URL,
    authToken: process.env.TURSO_PROD_AUTH_TOKEN,
  },
});

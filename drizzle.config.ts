import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so nothing has loaded .env.local for us.
config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL;

if (!url) {
  throw new Error(
    "DIRECT_URL is not set. Copy .env.example to .env.local and fill it in — see docs/drizzle.md.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  // Write camelCase in TypeScript, get snake_case columns in Postgres.
  // src/db/*.ts pass the same option to drizzle() so both agree.
  casing: "snake_case",
  dbCredentials: { url },
  // anon, authenticated, service_role and postgres already exist in every
  // Supabase project. Without this, drizzle-kit would try to CREATE them.
  entities: { roles: { provider: "supabase" } },
  verbose: true,
  strict: true,
});

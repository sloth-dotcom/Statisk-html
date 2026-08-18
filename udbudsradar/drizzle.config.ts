import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://udbudsradar:udbudsradar@127.0.0.1:5432/udbudsradar",
  },
  strict: true,
  verbose: true,
});

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL mangler. Se .env.example.");
  process.exit(1);
}

const { client, db } = createDb(url);
await migrate(db, { migrationsFolder: "./drizzle" });
console.log(JSON.stringify({ event: "migrate.done", url: url.replace(/:[^:@]+@/, ":***@") }));
await client.end();

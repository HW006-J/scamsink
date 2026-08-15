#!/usr/bin/env node
// Applies neon/migrations/*.sql in order, tracking applied filenames in a
// schema_migrations table so re-running is a no-op. Run with:
//   npm run db:migrate

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "neon", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local or export it before running this script.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows: appliedRows } = await client.query("select filename from schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    console.log("No migration files found in neon/migrations.");
    return;
  }

  let ranAny = false;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    console.log(`apply ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      ranAny = true;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  console.log(ranAny ? "Migrations applied." : "Database already up to date.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => client.end());

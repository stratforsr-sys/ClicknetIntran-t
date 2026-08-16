#!/usr/bin/env node
/**
 * Migrationskorare. Handskriven SQL, ingen ORM-generering.
 *
 *   node scripts/apply-sql.mjs                  -> kor alla ej korda
 *   node scripts/apply-sql.mjs 0001_identitet   -> kor en specifik
 *
 * Varje fil kors i en transaktion och bokfors i schema_migrations.
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL saknas.");
  process.exit(1);
}

const dir = path.join(process.cwd(), "supabase", "migrations");
const only = process.argv[2];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )
`);
await client.query("alter table schema_migrations enable row level security");

const applied = new Map(
  (await client.query("select name, checksum from schema_migrations")).rows.map((r) => [r.name, r.checksum]),
);

const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
let ran = 0;

for (const file of files) {
  const name = file.replace(/\.sql$/, "");
  if (only && name !== only) continue;

  const sql = await readFile(path.join(dir, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);

  if (applied.has(name)) {
    if (applied.get(name) !== checksum) {
      console.warn(`~ ${name} redan kord men filen har andrats. Skapa en ny migration i stallet.`);
    }
    continue;
  }

  process.stdout.write(`> ${name} ... `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [name, checksum]);
    await client.query("commit");
    console.log("ok");
    ran++;
  } catch (err) {
    await client.query("rollback");
    console.log("MISSLYCKADES");
    console.error(err.message);
    await client.end();
    process.exit(1);
  }
}

console.log(ran === 0 ? "Inget att kora." : `${ran} migration(er) korda.`);
await client.end();

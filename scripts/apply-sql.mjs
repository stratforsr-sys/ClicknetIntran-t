#!/usr/bin/env node
/**
 * Migrationskorare. Handskriven SQL, ingen ORM-generering.
 *
 *   node scripts/apply-sql.mjs                  -> kor alla ej korda
 *   node scripts/apply-sql.mjs 0001_identitet   -> kor en specifik
 *
 * Varje fil kors i en transaktion och bokfors i schema_migrations. Finns
 * tests/rattigheter-db.mjs kors dess kontroll fore commit: en migration som
 * gor en SECURITY DEFINER-funktion korbar for anon eller authenticated utan
 * att den star i TILLATNA, eller som oppnar forvalet igen, rullas tillbaka.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

const vaktFil = path.join(process.cwd(), "tests", "rattigheter-db.mjs");
const vakt = existsSync(vaktFil) ? (await import(pathToFileURL(vaktFil).href)).kontrollera : null;
if (!vakt) console.warn("! tests/rattigheter-db.mjs saknas: rattigheterna provas inte.");

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
    if (vakt) {
      const v = await vakt(client);
      if (v.fel.length > 0) throw new Error(`vakten (tests/rattigheter-db.mjs) vagrar:\n  ${v.fel.join("\n  ")}`);
    }
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

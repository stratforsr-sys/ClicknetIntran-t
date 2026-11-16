#!/usr/bin/env node
/**
 * Kunskapsbasen (0312) i databasen: sparningen, sökningen och behörigheten.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/kunskap-db.mjs
 *
 * Provet visar:
 *   1. `kunskap_spara` skriver dokumentet och dess stycken i en transaktion, och skriver om styckena vid en ändring.
 *   2. `kunskap_sok` hittar på titel, rubrik och text med svensk stamning, och bäst träff först.
 *   3. En inloggad läser och söker, men skriver inte och ser inte listan över det som saknas. Utan inloggning: ingenting.
 *
 * Migrationen läses från disk och körs i transaktionen (den är omkörbar). Allt rullas tillbaka: inget dokument blir kvar.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../supabase/migrations/0312_kunskapsbas.sql", import.meta.url), "utf8"));
  const st = JSON.stringify([{ rubrik: "Flytt, Åkeri", text: "## Flytt\n- flyttfirma\n- flytthjälp\n\n## Åkeri\n- åkeri\n- godstransport" }, { rubrik: "Öppna samtalet", text: "Börja med flyttfirma i orten." }]);
  const id = (await c.query("select public.kunskap_spara(null, 'PROV Sökord: transport', 'Sälj', 'prov.md', 'hela texten', null, $1::jsonb) as id", [st])).rows[0].id;
  ok("spara ger ett id", !!id);
  const n = (await c.query("select count(*)::int n from kunskap_stycke where dokument = $1", [id])).rows[0].n;
  ok("två stycken", n === 2, n);
  const s1 = (await c.query("select titel, rubrik from public.kunskap_sok('sökord transport', 3)")).rows;
  ok("sökord transport hittar dokumentet på titeln", s1.length === 2 && s1[0].titel === "PROV Sökord: transport", JSON.stringify(s1));
  const s2 = (await c.query("select rubrik from public.kunskap_sok('flyttfirmor', 3)")).rows;
  ok("böjningen flyttfirmor hittar flyttfirma (svensk stamning)", s2.length >= 1, JSON.stringify(s2));
  const s3 = (await c.query("select rubrik from public.kunskap_sok('rörmokare', 3)")).rows;
  ok("ingen träff på det som inte står där", s3.length === 0);
  const s4 = (await c.query("select rubrik from public.kunskap_sok('rörmokare or åkeri', 3)")).rows;
  ok("något av orden (or) hittar", s4.length === 1, JSON.stringify(s4));
  await c.query("select public.kunskap_spara($1, 'PROV Nytt namn', 'Sälj', null, 'ny text', null, $2::jsonb)", [id, JSON.stringify([{ rubrik: "", text: "Bara ett stycke om lastbilar." }])]);
  const d = (await c.query("select titel, filnamn, (select count(*)::int from kunskap_stycke where dokument = d.id) n, (select titel from kunskap_stycke where dokument = d.id limit 1) st from kunskap_dokument d where id = $1", [id])).rows[0];
  ok("ändra skriver om styckena, byter titel på dem och behåller filnamnet", d.titel === "PROV Nytt namn" && d.n === 1 && d.st === "PROV Nytt namn" && d.filnamn === "prov.md", JSON.stringify(d));
  ok("ändra ett dokument som inte finns ger null", (await c.query("select public.kunskap_spara(gen_random_uuid(), 'x', '', null, 'y', null, '[{\"text\":\"y\"}]'::jsonb) as id")).rows[0].id === null);
  let kast = false; await c.query("savepoint a"); try { await c.query("select public.kunskap_spara(null, 'x', '', null, 'y', null, '[]'::jsonb)"); } catch { kast = true; } await c.query("rollback to a");
  ok("inga stycken: nej", kast);
  await c.query("delete from kunskap_dokument where id = $1", [id]);
  ok("ta bort tar styckena med sig", (await c.query("select count(*)::int n from kunskap_stycke where dokument = $1", [id])).rows[0].n === 0);
  // Behörigheten: en inloggad läser, skriver inte, och ser inte miss-listan. anon ser ingenting.
  const far = async (roll, sats) => { await c.query("savepoint b"); try { await c.query(`set local role ${roll}`); await c.query(sats); await c.query("reset role"); await c.query("release b"); return true; } catch { await c.query("rollback to b"); await c.query("reset role"); return false; } };
  ok("authenticated får läsa stycken", await far("authenticated", "select 1 from kunskap_stycke limit 1"));
  ok("authenticated får söka", await far("authenticated", "select * from kunskap_sok('x', 1)"));
  ok("authenticated får inte skriva dokument", !(await far("authenticated", "insert into kunskap_dokument (titel, text) values ('x','y')")));
  ok("authenticated får inte anropa kunskap_spara", !(await far("authenticated", "select kunskap_spara(null, 'x', '', null, 'y', null, '[{\"text\":\"y\"}]'::jsonb)")));
  ok("authenticated får inte läsa miss-listan", !(await far("authenticated", "select 1 from kunskap_miss limit 1")));
  ok("anon får inte läsa stycken", !(await far("anon", "select 1 from kunskap_stycke limit 1")));
  ok("anon får inte söka", !(await far("anon", "select * from kunskap_sok('x', 1)")));
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);

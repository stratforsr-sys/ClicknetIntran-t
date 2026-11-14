/**
 * Säljtavlans ringklocka mot riktig databas. Tavlan hämtar nytt läge när
 * public.salesboard_ringklocka() skickar "ping" på kanalen "salesboard", och
 * annars först vid nästa vanliga hämtning (var 60:e sekund med kanalen uppe).
 * Varje tabell som ändrar det tavlan visar ska därför ringa.
 *
 * Provet läser pg_trigger och utlöser sedan varje mötesklocka med en sats som
 * inte rör någon rad, inuti en transaktion som rullas tillbaka: realtime.send
 * lägger sitt meddelande i realtime.messages, och det skickas bara vid commit.
 * Ingen tv får alltså något ping av provet.
 */
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// tgtype: 1 rad, 2 före, 4 insert, 8 delete, 16 update, 64 i stället för.
const { rows } = await c.query(`
  select c.relname as tabell, t.tgname, t.tgtype, t.tgenabled,
         coalesce((select array_agg(a.attname::text order by a.attname)
                     from unnest(t.tgattr::int2[]) n join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = n), '{}') as kolumner
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
    join pg_proc p on p.oid = t.tgfoid and p.proname = 'salesboard_ringklocka'
   where not t.tgisinternal`);

const klockor = (tabell) => rows.filter((r) => r.tabell === tabell);
const efter = (r) => (r.tgtype & (2 | 64)) === 0;
const perSats = (r) => (r.tgtype & 1) === 0;
const pa = (r) => r.tgenabled === "O" || r.tgenabled === "A";
const ringer = (tabell, handelse, { perRad = false } = {}) =>
  klockor(tabell).filter((r) => efter(r) && pa(r) && perSats(r) !== perRad && (r.tgtype & handelse) !== 0);

// Som 0250 satte dem: händelserna tavlan bryr sig om, inte fler.
console.log("Klockorna från 0250 sitter kvar och är påslagna");
const I = 4, D = 8, U = 16;
for (const [tabell, handelser, namn, perRad] of [
  ["sales_order", [I, U, D], "insert, update och delete", false],
  ["salesboard_event", [I], "insert", false],
  ["salesboard_person", [I, U, D], "insert, update och delete", false],
  ["salesboard_screen", [U], "update", false],
  ["nav_setting", [I, U], "insert och update, per rad (bara nyckeln salesboard)", true],
]) {
  const har = handelser.every((h) => ringer(tabell, h, { perRad }).length > 0);
  ok(`${tabell}: ${namn}`, har, har ? "" : JSON.stringify(klockor(tabell)));
}

console.log("Möten: bokat och borttaget ringer, ändrad bokare/tid/art/kedja ringer");
ok("mote: insert", ringer("mote", 4).length > 0);
ok("mote: delete", ringer("mote", 8).length > 0);
const upd = ringer("mote", 16);
const bevakade = new Set(upd.flatMap((r) => (r.kolumner.length === 0 ? ["*"] : r.kolumner)));
for (const kol of ["art", "bokat_av", "bokat_nar", "kedja_id"]) {
  ok(`mote: update of ${kol}`, bevakade.has("*") || bevakade.has(kol));
}
ok("mote: ett utfall eller en bekräftelse ringer inte", !bevakade.has("*") && !bevakade.has("utfall") && !bevakade.has("bekraftat_nar"));

console.log("Klockan går: satsen lägger ett ping i realtime.messages (rullas tillbaka)");
const pingar = async () =>
  Number((await c.query(`select count(*)::int n from realtime.messages where topic = 'salesboard' and event = 'ping'`)).rows[0].n);
for (const [namn, sats] of [
  ["insert", "insert into public.mote select * from public.mote where false"],
  ["delete", "delete from public.mote where false"],
  ["update of art", "update public.mote set art = art where false"],
]) {
  await c.query("begin");
  try {
    const fore = await pingar();
    await c.query(sats);
    const efter = await pingar();
    ok(`mote ${namn} utan rader ger ett ping`, efter === fore + 1, `${fore} → ${efter}`);
  } catch (e) {
    ok(`mote ${namn} utan rader ger ett ping`, false, e.message);
  } finally {
    await c.query("rollback");
  }
}

await c.end();
console.log(fel === 0 ? "\nKlockorna: alla gröna" : `\nKlockorna: ${fel} fel`);
process.exit(fel === 0 ? 0 : 1);

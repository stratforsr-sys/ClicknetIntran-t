#!/usr/bin/env node
/**
 * 0300: månadsstängningen och mötesprovisionen går inte om varandra (hårdtestet 2026-11-14, fynd 3).
 *
 * Mot produktionsdatabasen, men bara med månaden 2001-01, som ingen riktig provision ligger i. Det mesta körs i en
 * transaktion som rullas tillbaka. Provet för låset behöver två anslutningar och därmed en markering som skrivs på
 * riktigt; den tas bort efteråt, också om provet faller.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a; node tests/provision-stangning-las-db.mjs
 */
import pg from "pg";

const URL = process.env.NAV2_PG_URL || process.env.DATABASE_URL;
if (!URL) {
  console.error("NAV2_PG_URL saknas (set -a; . ~/.clicknet/nav.env; set +a)");
  process.exit(1);
}
const MANAD = "2001-01-01";
const ANNAN = "2001-02-01";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const ny = async () => {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  return c;
};
/** Felkoden från en sats i en sparpunkt, eller null om den gick igenom. */
const kod = async (c, sql, args = []) => {
  await c.query("savepoint s");
  try {
    await c.query(sql, args);
    await c.query("release savepoint s");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return e.code ?? "?";
  }
};

const a = await ny();
const b = await ny();
try {
  rubrik("Tabellen och rättigheterna");
  {
    const r = await a.query(
      `select has_function_privilege('authenticated', 'public.provision_stangning_borjar(date, uuid)', 'execute') as auth_b,
              has_function_privilege('anon', 'public.provision_stangning_klar(date)', 'execute') as anon_k,
              has_function_privilege('service_role', 'public.provision_stangning_borjar(date, uuid)', 'execute') as sr_b,
              has_function_privilege('service_role', 'public.mote_provision_vakt(date)', 'execute') as sr_v,
              has_table_privilege('authenticated', 'public.commission_period_stangs', 'select') as auth_t,
              (select relrowsecurity from pg_class where oid = 'public.commission_period_stangs'::regclass) as rls`,
    );
    const x = r.rows[0];
    ok("stängningens funktioner: bara service role", !x.auth_b && !x.anon_k && x.sr_b);
    ok("vakten körs bara inifrån", !x.sr_v);
    ok("markeringarna: RLS på, inget för authenticated", x.rls && !x.auth_t);
  }

  rubrik("Markeringen, i en transaktion som rullas tillbaka");
  await a.query("begin");
  ok("vakten släpper igenom utan markering", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === null);
  ok("stängningen börjar", (await kod(a, "select public.provision_stangning_borjar($1, null)", [MANAD])) === null);
  ok("vakten nekar månaden med P0423", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === "P0423");
  ok("en annan månad påverkas inte", (await kod(a, "select public.mote_provision_vakt($1)", [ANNAN])) === null);
  ok("rättelsen nekas när mötets månad stängs", (await kod(a, "select public.mote_bokfor_rattelse(gen_random_uuid(), gen_random_uuid(), $1, 1, 0, $2, 'prov', null)", [MANAD, ANNAN])) === "P0423");
  ok("rättelsen nekas när innevarande månad stängs", (await kod(a, "select public.mote_bokfor_rattelse(gen_random_uuid(), gen_random_uuid(), $2, 1, 0, $1, 'prov', null)", [MANAD, ANNAN])) === "P0423");
  ok("en andra stängning av samma månad nekas med P0409", (await kod(a, "select public.provision_stangning_borjar($1, null)", [MANAD])) === "P0409");
  await a.query("update public.commission_period_stangs set borjade = now() - interval '6 minutes' where period_month = $1", [MANAD]);
  ok("en markering äldre än fem minuter spärrar inte", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === null);
  ok("och en ny stängning tar över den", (await kod(a, "select public.provision_stangning_borjar($1, null)", [MANAD])) === null);
  await a.query("select public.provision_stangning_klar($1)", [MANAD]);
  ok("klar tar bort markeringen", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === null);
  await a.query("rollback");

  rubrik("Låset: stängningen väntar ut en skrivning som pågår");
  {
    await a.query("begin");
    await a.query("select public.mote_provision_vakt($1)", [MANAD]); // en skrivning håller det delade låset
    let klar = false;
    const stangning = b.query("select public.provision_stangning_borjar($1, null)", [MANAD]).then(() => (klar = true));
    await new Promise((r) => setTimeout(r, 800));
    ok("stängningen väntar medan skrivningen pågår", klar === false);
    await a.query("commit");
    await stangning;
    ok("och går igenom när skrivningen är klar", klar === true);
    await a.query("begin");
    ok("en skrivning efteråt nekas", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === "P0423");
    await a.query("rollback");
  }
} finally {
  await b.query("select public.provision_stangning_klar($1)", [MANAD]).catch(() => {});
  const kvar = await b.query("select count(*)::int n from public.commission_period_stangs where period_month = $1", [MANAD]);
  ok("städat: ingen markering kvar", kvar.rows[0].n === 0);
  await a.end();
  await b.end();
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);

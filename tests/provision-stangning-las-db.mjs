#!/usr/bin/env node
/**
 * 0300: månadsstängningen och mötesprovisionen går inte om varandra (hårdtestet 2026-11-14, fynd 3).
 *
 * Mot produktionsdatabasen, men bara med månaden 2001-01, som ingen riktig provision ligger i. Det mesta körs i en
 * transaktion som rullas tillbaka. Provet för låset behöver två anslutningar och därmed en markering som skrivs på
 * riktigt; den tas bort efteråt, också om provet faller.
 *
 * 0302: stängningens nyckel, och låset på orderna. Ordertriggern körs på en tillfällig kopia av `sales_order` (samma
 * kolumner, också de genererade månaderna), så provet skriver aldrig en order; påslagstriggern på en tillfällig kopia
 * av `order_manager_commission` som pekar på en befintlig godkänd order, vars månad markeras i transaktionen.
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
              has_function_privilege('anon', 'public.provision_stangning_klar(date, uuid)', 'execute') as anon_k,
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

  rubrik("Nyckeln (0302): en stängning tar bara bort sin egen markering");
  await a.query("begin");
  {
    const n1 = (await a.query("select public.provision_stangning_borjar($1, null) n", [MANAD])).rows[0].n;
    ok("borjar lämnar en nyckel", /^[0-9a-f-]{36}$/.test(String(n1)));
    await a.query("update public.commission_period_stangs set borjade = now() - interval '6 minutes' where period_month = $1", [MANAD]);
    const n2 = (await a.query("select public.provision_stangning_borjar($1, null) n", [MANAD])).rows[0].n;
    ok("en ny stängning som tar över får en annan nyckel", n2 && n2 !== n1);
    await a.query("select public.provision_stangning_klar($1, $2)", [MANAD, n1]);
    ok("den gamla stängningens klar lämnar den nyas markering", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === "P0423");
    await a.query("select public.provision_stangning_klar($1, $2)", [MANAD, n2]);
    ok("den nyas klar tar bort den", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === null);
    await a.query("select public.provision_stangning_borjar($1, null)", [MANAD]);
    await a.query("select public.provision_stangning_klar($1)", [MANAD]);
    ok("klar utan nyckel (koden före 0302) tar bort som förut", (await kod(a, "select public.mote_provision_vakt($1)", [MANAD])) === null);
  }
  await a.query("rollback");

  rubrik("Orderna (0302), på en tillfällig kopia av sales_order");
  await a.query("begin");
  {
    await a.query("create temp table so_prov (like public.sales_order including defaults including generated) on commit drop");
    await a.query("create trigger v after insert or update or delete on pg_temp.so_prov for each row execute function public.sales_order_provision_vakt()");
    const rad = (id, status, signerad, belopp = 100) =>
      kod(a, `insert into pg_temp.so_prov (id, company_name, org_number, contact_name, contact_phone, package_id, term_months,
                salesperson_id, signed_on, created_by, starts_on, status, commission_amount, order_number)
              values ($1, 'PROV', '000000-0000', 'PROV', '0', 1, 12, gen_random_uuid(), $2, gen_random_uuid(), $2, $3, $4, 0)`,
        [id, signerad, status, belopp]);
    const R = "00000000-0000-4000-8000-0000000000f1", U = "00000000-0000-4000-8000-0000000000f2", F = "00000000-0000-4000-8000-0000000000f3";
    ok("en godkänd order före stängningen går igenom", (await rad(R, "signerad", "2001-01-10")) === null);
    await a.query("select public.provision_stangning_borjar($1, null)", [MANAD]);
    ok("ett utkast i månaden går igenom under stängningen", (await rad(U, "utkast", "2001-01-12")) === null);
    ok("en ny godkänd order i månaden nekas med P0423", (await rad(F, "signerad", "2001-01-12")) === "P0423");
    ok("en godkänd order i en annan månad går igenom", (await rad(F, "signerad", "2001-02-03")) === null);
    ok("signerad → betald går igenom (samma pengar)", (await kod(a, "update pg_temp.so_prov set status = 'betald' where id = $1", [R])) === null);
    ok("ett annat fält än pengarna går igenom", (await kod(a, "update pg_temp.so_prov set company_name = 'PROV 2' where id = $1", [R])) === null);
    ok("ändrad provision nekas", (await kod(a, "update pg_temp.so_prov set commission_amount = 200 where id = $1", [R])) === "P0423");
    ok("makulering nekas", (await kod(a, "update pg_temp.so_prov set status = 'makulerad', cancelled_on = '2001-02-05' where id = $1", [R])) === "P0423");
    ok("radering nekas", (await kod(a, "delete from pg_temp.so_prov where id = $1", [R])) === "P0423");
    ok("utkastet som godkänns nekas", (await kod(a, "update pg_temp.so_prov set status = 'signerad' where id = $1", [U])) === "P0423");
    ok("en order som flyttas in i månaden nekas", (await kod(a, "update pg_temp.so_prov set signed_on = '2001-01-20' where id = $1", [F])) === "P0423");
  }
  await a.query("rollback");

  rubrik("Säljchefens påslag (0302), på en tillfällig kopia");
  await a.query("begin");
  {
    const o = (await a.query("select id, period_month::text m from public.sales_order where status in ('signerad', 'betald') limit 1")).rows[0];
    if (!o) ok("en godkänd order att peka på finns", false);
    else {
      await a.query("create temp table omc_prov (like public.order_manager_commission including defaults) on commit drop");
      await a.query("create trigger v before insert or update or delete on pg_temp.omc_prov for each row execute function public.order_manager_commission_provision_vakt()");
      const ins = () => kod(a, "insert into pg_temp.omc_prov (order_id, manager_id, order_value, base, percent, amount) values ($1, gen_random_uuid(), 1, 1, 1, 1)", [o.id]);
      ok("ett påslag går igenom utan stängning", (await ins()) === null);
      // Markeringen skrivs direkt, utan det exklusiva låset: ingen annan ser den, och den rullas tillbaka.
      await a.query("insert into public.commission_period_stangs (period_month) values ($1) on conflict do nothing", [o.m]);
      ok("ett påslag på en order i en månad som stängs nekas", (await ins()) === "P0423");
      ok("och ett ändrat belopp", (await kod(a, "update pg_temp.omc_prov set amount = 2")) === "P0423");
      ok("men en skrivning som inte ändrar pengarna går igenom", (await kod(a, "update pg_temp.omc_prov set created_at = now()")) === null);
    }
  }
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

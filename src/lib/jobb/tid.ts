import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RAST_AKTIV, RATTELSE_FRIST_TIMMAR, gallande, arbetadeMinuter, type Handelse } from "@/lib/tid";
import { avvikelser, gallandeSchema, tagnaRaster, type Rastschema } from "@/lib/raster";
import { senAnkomst } from "@/lib/narvaro";
import {
  svensktDatum,
  svenskTidpunkt,
  svenskDygnsslut,
  svenskVeckodag,
  dagarBakat,
} from "@/lib/klocka";

/** AC-2.31: detaljerna gallras efter 90 dagar, aggregatet star kvar i 12 manader. */
const GALLRING_DAGAR = 90;
const AGGREGAT_MANADER = 12;

/**
 * Hur langt tillbaka jobbet letar efter dygn som aldrig blev avslutade.
 *
 * Att bara titta pa igar var en tyst forutsattning om att jobbet alltid kor.
 * Det gjorde det inte: tva natter passerade utan att nagot hande, och en
 * instampling stod oppen i tva dygn utan att nagon fick veta. Ett nattjobb ska
 * lakas av nasta korning, inte kraeva att en manniska upptacker att det uteblev.
 */
const IKAPP_DAGAR = 14;

export type Tidutfall = {
  dagar: string[];
  stangda: number;
  journalrader: number;
  avvikelser: number;
  sena: number;
  oppna_utan_schema: number;
  gallrade: number;
  rattelser_over_frist: number;
};

/** Allt datumrakande sker i svenska kalenderdygn. Se `klocka.ts`. */
const datumStrang = (d: Date) => svensktDatum(d);

/**
 * Nattjobbet for M2. Gor for varje dygn som saknar journalrad, i ordning:
 *
 *   1. Stanger glomda utstamplingar vid schemaslut (AC-2.4)
 *   2. Skriver dygnets rader till arbetstidsjournalen (AC-2.6, AC-2.7)
 *   2b. Bedomer sen ankomst mot arbetsschemat
 *   3. Genererar rastavvikelser mot det schema som gallde DA (AC-2.24, AC-2.35)
 *
 * och darefter en gang per korning:
 *
 *   4. Gallrar detaljer aldre an 90 dagar, efter att de summerats (AC-2.31)
 *   5. Lyfter rattelser som legat over 48 timmar (AC-2.22)
 *
 * Ordningen ar inte godtycklig: en dag maste vara stangd innan den kan bedomas,
 * och bedomd innan den far gallras.
 */
export async function korTidjobbet(db: SupabaseClient): Promise<Tidutfall> {
  const utfall: Tidutfall = {
    dagar: [],
    stangda: 0,
    journalrader: 0,
    avvikelser: 0,
    sena: 0,
    oppna_utan_schema: 0,
    gallrade: 0,
    rattelser_over_frist: 0,
  };

  const [{ data: personal }, { data: scheman }, { data: raster }] = await Promise.all([
    db.from("employee").select("id, team_id").neq("status", "offboarded"),
    db
      .from("work_schedule")
      .select("id, scope, employee_id, team_id, weekday, start_time, end_time, tol_late, valid_from"),
    db
      .from("scheduled_break")
      .select(
        `id, scope, employee_id, team_id, weekday, sort, window_start, window_end,
         duration_minutes, tol_early_start, tol_overrun, tol_missing, valid_from`,
      ),
  ]);

  // Vilka dygn ar redan avslutade? Ett dygn med journalrad rors inte igen.
  const idag = svensktDatum(new Date());

  const { data: klara } = await db
    .from("work_time_journal")
    .select("work_date")
    .gte("work_date", dagarBakat(idag, IKAPP_DAGAR));

  const avslutade = new Set((klara ?? []).map((r) => String(r.work_date).slice(0, 10)));

  const attGora: string[] = [];
  for (let i = IKAPP_DAGAR; i >= 1; i--) {
    const datum = dagarBakat(idag, i);
    if (!avslutade.has(datum)) attGora.push(datum);
  }

  for (const datum of attGora) {
    const fran = svenskTidpunkt(datum, "00:00").toISOString();
    const till = svenskDygnsslut(datum);
    const veckodag = svenskVeckodag(fran);

    const { data: handelser } = await db
      .from("time_event")
      .select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state")
      .gte("occurred_at", fran)
      .lte("occurred_at", till);

    if ((handelser ?? []).length === 0) continue;
    utfall.dagar.push(datum);

    const perPerson = new Map<string, Handelse[]>();
    for (const h of handelser ?? []) {
      perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
    }

    for (const p of personal ?? []) {
      const egna = gallande(perPerson.get(p.id) ?? []);
      if (egna.length === 0) continue;

      const dagensSchema = gallandeSchema(
        (scheman ?? []).filter((s) => s.weekday === veckodag),
        p.id,
        p.team_id,
        datum,
      )[0];

      // 1. Glomd utstampling.
      const sista = egna[egna.length - 1];
      let autoStangd = false;

      if (sista.kind !== "out") {
        // Schematiden ar svensk vaggtid. `new Date("...T17:00")` hade blivit
        // 17:00 i serverns zon, alltsa 19:00 svensk tid pa Vercel.
        const slut = dagensSchema ? svenskTidpunkt(datum, dagensSchema.end_time) : null;

        // Sluttiden far aldrig hamna fore den sista stamplingen. Den som
        // stamplade in 18:08 pa ett schema som slutar 17:00 skulle annars fa en
        // utstampling FORE sin instampling — en omojlig dag i en lonegrundande
        // logg. Da lamnas dagen oppen for en manniska att reda ut.
        const rimlig = slut !== null && slut.getTime() > Date.parse(sista.occurred_at);

        if (rimlig && slut) {
          const { error } = await db.from("time_event").insert({
            employee_id: p.id,
            kind: "out",
            occurred_at: slut.toISOString(),
            source: "system_auto_close",
            note: "Stängd av navet vid schemaslut. Kontrollera tiden och begär rättelse om den är fel.",
          });
          if (!error) {
            egna.push({
              id: "auto",
              kind: "out",
              occurred_at: slut.toISOString(),
              source: "system_auto_close",
            });
            utfall.stangda++;
            autoStangd = true;
            await db.from("audit_log").insert({
              actor_id: null,
              action: "time.auto_closed",
              object_type: "employee",
              object_id: p.id,
              meta: { datum, vid: dagensSchema?.end_time },
            });
          }
        } else {
          utfall.oppna_utan_schema++;
          await db.from("audit_log").insert({
            actor_id: null,
            action: "time.left_open",
            object_type: "employee",
            object_id: p.id,
            meta: {
              datum,
              orsak: dagensSchema
                ? "sista stämplingen ligger efter schemaslut"
                : "inget arbetsschema för dagen",
            },
          });
        }
      }

      // 2. Sen ankomst, mot schemat som gallde DA. Bedoms fore journalen:
      //    att nagon kom sent ar kant redan innan dagen ar avslutad, och en
      //    oppen dag far darfor inte dolja forseningen.
      if (dagensSchema) {
        const sen = senAnkomst(egna, {
          start_time: dagensSchema.start_time,
          tol_late: dagensSchema.tol_late ?? 1,
          schedule_id: dagensSchema.id,
        });

        if (sen) {
          const { error: senFel } = await db.from("late_arrival").upsert(
            {
              employee_id: p.id,
              work_date: datum,
              scheduled_start: sen.schemalagd,
              arrived_at: sen.ankom,
              minutes_late: sen.minuter,
              tolerance_minutes: sen.tolerans,
              schedule_id: sen.schedule_id,
            },
            { onConflict: "employee_id,work_date" },
          );
          if (!senFel) utfall.sena++;
        }
      }

      // 3. Journalen. En dag som fortfarande ar oppen far INGEN rad: siffran
      //    hade blivit "fran instampling till midnatt", vilket ar en pahittad
      //    arbetsdag i ett lonegrundande arkiv. Dagen lamnas utan rad, plockas
      //    upp av nasta korning och syns under tiden som blockering i
      //    loneperioden (AC-2.14).
      const fortfarandeOppen = gallande(egna)[gallande(egna).length - 1]?.kind !== "out";
      if (fortfarandeOppen) continue;

      const arbetat = arbetadeMinuter(egna, new Date(till));
      const rastMinuter = tagnaRaster(egna)
        .filter((r) => r.slut)
        .reduce((s, r) => s + Math.round((Date.parse(r.slut!) - Date.parse(r.start)) / 60000), 0);

      const { error: journalFel } = await db.from("work_time_journal").upsert(
        {
          employee_id: p.id,
          work_date: datum,
          worked_minutes: arbetat,
          break_minutes: rastMinuter,
          auto_closed: autoStangd,
        },
        { onConflict: "employee_id,work_date" },
      );
      if (!journalFel) utfall.journalrader++;

      // 4. Rastavvikelser.
      if (!RAST_AKTIV) continue;

      const mittRastschema = gallandeSchema(
        (raster ?? []).filter((r) => r.weekday === veckodag),
        p.id,
        p.team_id,
        datum,
      );
      if (mittRastschema.length === 0) continue;

      // AC-2.36: utan kvittens bedoms ingenting. Tystnad ar inte godkannande.
      const { data: kvitton } = await db
        .from("break_schedule_ack")
        .select("schedule_id")
        .eq("employee_id", p.id)
        .in(
          "schedule_id",
          mittRastschema.map((r) => r.id),
        );
      if ((kvitton ?? []).length < mittRastschema.length) continue;

      for (const a of avvikelser(egna, mittRastschema as unknown as Rastschema[], new Date(till))) {
        const { error } = await db.from("break_deviation").upsert(
          {
            employee_id: p.id,
            work_date: datum,
            kind: a.kind,
            minutes: a.minutes,
            schedule_id: a.schedule_id,
          },
          { onConflict: "employee_id,work_date,kind,minutes" },
        );
        if (!error) utfall.avvikelser++;
      }
    }
  }

  await gallra(db, utfall);
  await lyftLiggandeRattelser(db, utfall);

  return utfall;
}

/** 4. Summera forst, radera sedan — aldrig tvartom. */
async function gallra(db: SupabaseClient, utfall: Tidutfall) {
  const detaljGrans = dagarBakat(svensktDatum(new Date()), GALLRING_DAGAR);

  const { data: attSummera } = await db
    .from("break_deviation")
    .select("employee_id, work_date, kind")
    .lt("work_date", detaljGrans);

  const summa = new Map<string, number>();
  for (const d of attSummera ?? []) {
    const nyckel = `${d.employee_id}|${String(d.work_date).slice(0, 7)}-01|${d.kind}`;
    summa.set(nyckel, (summa.get(nyckel) ?? 0) + 1);
  }

  for (const [nyckel, antal] of summa) {
    const [employee_id, month, kind] = nyckel.split("|");
    const { data: fanns } = await db
      .from("break_deviation_month")
      .select("antal")
      .eq("employee_id", employee_id)
      .eq("month", month)
      .eq("kind", kind)
      .maybeSingle();

    await db
      .from("break_deviation_month")
      .upsert(
        { employee_id, month, kind, antal: (fanns?.antal ?? 0) + antal },
        { onConflict: "employee_id,month,kind" },
      );
  }

  utfall.gallrade = (attSummera ?? []).length;
  if (utfall.gallrade > 0) {
    await db.from("break_deviation").delete().lt("work_date", detaljGrans);
  }

  // Sena dagar gallras likadant.
  const { data: senaAttSummera } = await db
    .from("late_arrival")
    .select("employee_id, work_date, minutes_late")
    .lt("work_date", detaljGrans);

  const senSumma = new Map<string, { antal: number; minuter: number }>();
  for (const s of senaAttSummera ?? []) {
    const nyckel = `${s.employee_id}|${String(s.work_date).slice(0, 7)}-01`;
    const f = senSumma.get(nyckel) ?? { antal: 0, minuter: 0 };
    f.antal += 1;
    f.minuter += s.minutes_late;
    senSumma.set(nyckel, f);
  }

  for (const [nyckel, v] of senSumma) {
    const [employee_id, month] = nyckel.split("|");
    const { data: fanns } = await db
      .from("late_arrival_month")
      .select("antal, minuter")
      .eq("employee_id", employee_id)
      .eq("month", month)
      .maybeSingle();

    await db.from("late_arrival_month").upsert(
      {
        employee_id,
        month,
        antal: (fanns?.antal ?? 0) + v.antal,
        minuter: (fanns?.minuter ?? 0) + v.minuter,
      },
      { onConflict: "employee_id,month" },
    );
  }

  if ((senaAttSummera ?? []).length > 0) {
    await db.from("late_arrival").delete().lt("work_date", detaljGrans);
  }

  const gransAggregat = new Date();
  gransAggregat.setMonth(gransAggregat.getMonth() - AGGREGAT_MANADER);
  const aggregatGrans = svensktDatum(gransAggregat);
  await db.from("break_deviation_month").delete().lt("month", aggregatGrans);
  await db.from("late_arrival_month").delete().lt("month", aggregatGrans);
}

/** 5. AC-2.22. En rad per rattelse, inte en per natt — brus laser man forbi. */
async function lyftLiggandeRattelser(db: SupabaseClient, utfall: Tidutfall) {
  const fristGrans = new Date(Date.now() - RATTELSE_FRIST_TIMMAR * 3600_000).toISOString();

  const { data: liggande } = await db
    .from("time_event")
    .select("id, employee_id, created_at")
    .eq("correction_state", "pending")
    .lt("created_at", fristGrans);

  for (const r of liggande ?? []) {
    const { data: redanLoggad } = await db
      .from("audit_log")
      .select("id")
      .eq("action", "time.correction_overdue")
      .eq("object_id", r.id)
      .maybeSingle();

    if (redanLoggad) continue;

    await db.from("audit_log").insert({
      actor_id: null,
      action: "time.correction_overdue",
      object_type: "time_event",
      object_id: r.id,
      meta: { begard: r.created_at, timmar: RATTELSE_FRIST_TIMMAR },
    });
    utfall.rattelser_over_frist++;
  }
}

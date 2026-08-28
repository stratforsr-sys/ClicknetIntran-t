import type { SupabaseClient } from "@supabase/supabase-js";
import { svensktDatum, svenskVeckodag, svenskTidpunkt, svenskDygnsslut, dagarBakat } from "@/lib/klocka";
import { gallandeSchema } from "@/lib/raster";
import { boreskalera, dagarna, sjukfrister, type Regelverk, type Sjukanmalan } from "@/lib/franvaro";
import { stampelfriaAnstallda } from "@/lib/stampelfri-server";

/**
 * Nattjobbets frånvarosteg (E7.8, E7.11, AC-3.17, AC-3.19, AC-3.23).
 *
 * Fyra saker som alla har det gemensamt att de handlar om något som INTE hänt:
 * en bekräftelse som uteblivit, en frånvaro som ingen registrerat, en frist som
 * passerat. Det är precis den sortens sak ett schemalagt jobb ska bevaka, för
 * ingen människa upptäcker frånvaron av något.
 *
 * Varje steg är oberoende av de andra och ett fel i ett stoppar inte resten —
 * samma ordning som `korTidjobbet`.
 */

export type Franvaroutfall = {
  eskalerade: number;
  frister_skapade: number;
  paminnelser: number;
  paminnelser_stangda: number;
  hoppade_over?: string;
};

/** Hur många dygn bakåt jobbet letar efter oregistrerad frånvaro. */
const IKAPP_DAGAR = 14;

export async function korFranvarojobbet(
  db: SupabaseClient,
  stamplingPa: boolean,
): Promise<Franvaroutfall> {
  const utfall: Franvaroutfall = {
    eskalerade: 0,
    frister_skapade: 0,
    paminnelser: 0,
    paminnelser_stangda: 0,
  };

  const { data: policy } = await db.from("absence_policy").select("*").maybeSingle();
  if (!policy) return { ...utfall, hoppade_over: "inget regelverk" };

  const regler = policy as Regelverk;
  const nu = new Date();
  const idag = svensktDatum(nu);

  // ---------------------------------------------------------------------------
  // 1. AC-3.17: sjukanmälningar som ingen chef bekräftat.
  //
  // Eskaleringen är inte en tillsägelse till chefen utan en försäkring för den
  // sjuke: någon ska ha sett anmälan. Markeringen syns i chefens kö och i
  // klockan; mejlet väntar på E0.8, precis som E4.20 löste samma sak.
  // ---------------------------------------------------------------------------
  const { data: obekraftade } = await db
    .from("sick_report")
    .select("id, employee_id, first_sick_day, registered_at, confirmed_at, escalated_at, last_sick_day, cancelled_at")
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .is("escalated_at", null);

  for (const a of (obekraftade ?? []) as Sjukanmalan[]) {
    if (!boreskalera(a, regler, nu)) continue;

    await db.from("sick_report").update({ escalated_at: nu.toISOString() }).eq("id", a.id);
    await db.from("audit_log").insert({
      actor_id: null,
      action: "sick.escalated",
      object_type: "sick_report",
      object_id: a.id,
      meta: { timmar: regler.sick_confirm_hours },
    });
    utfall.eskalerade++;
  }

  // ---------------------------------------------------------------------------
  // 2. K37: frister för pågående sjukperioder.
  //
  // Handlingen som registrerar en anmälan skapar dem redan. Steget här är ett
  // skyddsnät för rader som kom in på annat sätt — och för den dag någon ändrar
  // dagnumren i regelverket, då perioder som redan pågår ska få de nya
  // fristerna också.
  // ---------------------------------------------------------------------------
  const { data: pagaende } = await db
    .from("sick_report")
    .select("id, first_sick_day")
    .is("last_sick_day", null)
    .is("cancelled_at", null);

  if ((pagaende ?? []).length > 0) {
    const { data: befintliga } = await db
      .from("sick_deadline")
      .select("report_id, kind")
      .in("report_id", (pagaende ?? []).map((p) => p.id));

    const finns = new Set((befintliga ?? []).map((f) => `${f.report_id}:${f.kind}`));
    const nya: { report_id: string; kind: string; due_on: string }[] = [];

    for (const p of pagaende ?? []) {
      for (const f of sjukfrister(p.first_sick_day, regler)) {
        if (finns.has(`${p.id}:${f.kind}`)) continue;
        nya.push({ report_id: p.id, kind: f.kind, due_on: f.due_on });
      }
    }

    if (nya.length > 0) {
      await db.from("sick_deadline").insert(nya);
      utfall.frister_skapade = nya.length;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. AC-3.19: schemalagda dagar utan stämpling och utan registrerad frånvaro.
  //
  // DEN ANSTÄLLDA SER PÅMINNELSEN FÖRST. `visible_to_manager_from` ligger ett
  // dygn fram och spärren sitter i RLS-policyn (0020), inte i en vy som låter
  // bli att rita raden. Hinner personen registrera sin VAB-dag innan dess får
  // chefen aldrig veta att det fanns en lucka — det är hela poängen.
  //
  // Steget kräver att stämplingen är påslagen. Utan den finns ingen uppgift om
  // vem som var på plats, och varje schemalagd dag hade sett ut som frånvaro.
  // ---------------------------------------------------------------------------
  if (!stamplingPa) {
    return { ...utfall, hoppade_over: "stämplingen är av, ingen frånvaro kan saknas" };
  }

  const [{ data: personal }, { data: scheman }, stampelfria] = await Promise.all([
    db.from("employee").select("id, team_id, start_date").neq("status", "offboarded"),
    db.from("work_schedule").select("id, scope, employee_id, team_id, weekday, start_time, end_time, valid_from"),
    /**
     * VD, säljchef, ekonomi och projektledare stämplar inte (`lib/stampelfri.ts`).
     *
     * Steget nedan letar efter schemalagda dagar utan stämpling, och för dem är
     * varje sådan dag en. Utan filtret hade var och en av dem fått en påminnelse
     * om oregistrerad frånvaro per arbetsdag — och när påminnelsen blir daglig
     * betyder den ingenting för dem som faktiskt behöver den.
     *
     * Bolagsschemat rör de här rollerna också: de har ett schema i `work_schedule`
     * för att kollegorna ska veta när kontoret är bemannat. Det är alltså inte
     * schemat som avgör vem som ska stämpla, utan rollen.
     */
    stampelfriaAnstallda(db),
  ]);

  const fran = dagarBakat(idag, IKAPP_DAGAR);
  // Gårdagen och bakåt. Dagens frånvaro är inte oregistrerad än — den som är
  // hemma i dag kan mycket väl registrera den i eftermiddag.
  const till = dagarBakat(idag, 1);

  const [{ data: stamplingar }, { data: ledigheter }, { data: sjuka }, { data: befintligaPam }] =
    await Promise.all([
      db
        .from("time_event")
        .select("employee_id, occurred_at")
        .gte("occurred_at", svenskTidpunkt(fran, "00:00").toISOString())
        .lte("occurred_at", svenskDygnsslut(till)),
      db
        .from("absence_request")
        .select("employee_id, starts_on, ends_on")
        .eq("status", "approved")
        .lte("starts_on", till)
        .gte("ends_on", fran),
      db
        .from("sick_report")
        .select("employee_id, first_sick_day, last_sick_day")
        .is("cancelled_at", null)
        .lte("first_sick_day", till),
      db.from("absence_reminder").select("employee_id, work_date, resolved_at").gte("work_date", fran),
    ]);

  // Dagar personen är redovisad för, oavsett hur.
  const redovisad = new Map<string, Set<string>>();
  const lagg = (id: string, datum: string) => {
    const s = redovisad.get(id) ?? new Set<string>();
    s.add(datum);
    redovisad.set(id, s);
  };

  for (const s of stamplingar ?? []) lagg(s.employee_id, svensktDatum(s.occurred_at));
  for (const l of ledigheter ?? []) for (const d of dagarna(l.starts_on, l.ends_on)) lagg(l.employee_id, d);
  for (const s of sjuka ?? []) {
    for (const d of dagarna(s.first_sick_day, s.last_sick_day ?? till)) lagg(s.employee_id, d);
  }

  const redanPam = new Map(
    (befintligaPam ?? []).map((p) => [`${p.employee_id}:${String(p.work_date).slice(0, 10)}`, p.resolved_at]),
  );

  const nyaPam: {
    employee_id: string;
    work_date: string;
    visible_to_manager_from: string;
  }[] = [];
  const attStanga: { employee_id: string; work_date: string }[] = [];

  for (const datum of dagarna(fran, till)) {
    const veckodag = svenskVeckodag(`${datum}T12:00:00.000Z`);
    const dagensScheman = (scheman ?? []).filter((s) => s.weekday === veckodag);

    for (const p of personal ?? []) {
      // Ingen påminnelse till den som inte stämplar — och en påminnelse som
      // lades INNAN rollen sattes stängs, i stället för att bli kvar och skava
      // i klockan. Samma hantering som när frånvaron registreras i efterhand:
      // det som gjorde raden meningsfull finns inte längre.
      if (stampelfria.has(p.id)) {
        if (redanPam.get(`${p.id}:${datum}`) === null) {
          attStanga.push({ employee_id: p.id, work_date: datum });
        }
        continue;
      }

      // Ingen påminnelse för dagar före anställningens start.
      if (p.start_date && datum < String(p.start_date).slice(0, 10)) continue;

      const schemalagd = gallandeSchema(dagensScheman, p.id, p.team_id, datum).length > 0;
      if (!schemalagd) continue;

      const nyckel = `${p.id}:${datum}`;
      const harRedovisat = redovisad.get(p.id)?.has(datum) ?? false;

      if (harRedovisat) {
        // Registrerade personen sin frånvaro i efterhand ska påminnelsen
        // stängas, inte stå kvar och skava.
        if (redanPam.has(nyckel) && redanPam.get(nyckel) === null) {
          attStanga.push({ employee_id: p.id, work_date: datum });
        }
        continue;
      }

      if (redanPam.has(nyckel)) continue;

      nyaPam.push({
        employee_id: p.id,
        work_date: datum,
        visible_to_manager_from: new Date(
          nu.getTime() + regler.unregistered_reminder_hours * 3_600_000,
        ).toISOString(),
      });
    }
  }

  if (nyaPam.length > 0) {
    await db.from("absence_reminder").insert(nyaPam);
    utfall.paminnelser = nyaPam.length;
  }

  for (const s of attStanga) {
    await db
      .from("absence_reminder")
      .update({ resolved_at: nu.toISOString() })
      .eq("employee_id", s.employee_id)
      .eq("work_date", s.work_date)
      .is("resolved_at", null);
    utfall.paminnelser_stangda++;
  }

  return utfall;
}

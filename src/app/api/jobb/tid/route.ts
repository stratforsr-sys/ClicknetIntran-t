import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { M2_AKTIV, RAST_AKTIV, gallande, arbetadeMinuter, type Handelse } from "@/lib/tid";
import { avvikelser, gallandeSchema, tagnaRaster, type Rastschema } from "@/lib/raster";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AC-2.31: detaljerna gallras efter 90 dagar, aggregatet star kvar i 12 manader. */
const GALLRING_DAGAR = 90;
const AGGREGAT_MANADER = 12;

/**
 * Nattjobbet for M2. Kors efter dygnets slut och gor fyra saker, i ordning:
 *
 *   1. Stanger glomda utstamplingar vid schemaslut (AC-2.4)
 *   2. Skriver gardagens rader till arbetstidsjournalen (AC-2.6, AC-2.7)
 *   3. Genererar rastavvikelser mot det schema som gallde DA (AC-2.24, AC-2.35)
 *   4. Gallrar detaljer aldre an 90 dagar, efter att de summerats (AC-2.31)
 *
 * Ordningen ar inte godtycklig: en dag maste vara stangd innan den kan
 * bedomas, och bedomd innan den far gallras.
 */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`)
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  if (!M2_AKTIV) {
    return NextResponse.json({ hoppade_over: "M2 är inte påslagen (K12)" });
  }

  const db = supabaseAdmin();
  const igar = new Date();
  igar.setDate(igar.getDate() - 1);
  const datum = igar.toISOString().slice(0, 10);
  const fran = `${datum}T00:00:00.000Z`;
  const till = `${datum}T23:59:59.999Z`;

  const [{ data: personal }, { data: handelser }, { data: scheman }, { data: raster }] =
    await Promise.all([
      db.from("employee").select("id, team_id").neq("status", "offboarded"),
      db
        .from("time_event")
        .select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state")
        .gte("occurred_at", fran)
        .lte("occurred_at", till),
      db.from("work_schedule").select("id, scope, employee_id, team_id, weekday, end_time, valid_from"),
      db
        .from("scheduled_break")
        .select(
          `id, scope, employee_id, team_id, weekday, sort, window_start, window_end,
           duration_minutes, tol_early_start, tol_overrun, tol_missing, valid_from`,
        ),
    ]);

  const perPerson = new Map<string, Handelse[]>();
  for (const h of handelser ?? []) {
    perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
  }

  // Veckodag 1-7 med mandag forst, som i schematabellerna.
  const veckodag = ((igar.getDay() + 6) % 7) + 1;

  let stangda = 0;
  let journalrader = 0;
  let nyaAvvikelser = 0;

  for (const p of personal ?? []) {
    const egna = gallande(perPerson.get(p.id) ?? []);
    if (egna.length === 0) continue;

    // 1. Glomd utstampling. AC-2.4: stang vid schemaslut och flagga for
    //    rattelse — men hitta pa ingen tid om schema saknas. En pahittad
    //    sluttid ar samre an en oppen dag som nagon far reda ut.
    const sistaTyp = egna[egna.length - 1].kind;
    let autoStangd = false;

    if (sistaTyp !== "out") {
      const mitt = gallandeSchema(
        (scheman ?? []).filter((s) => s.weekday === veckodag),
        p.id,
        p.team_id,
        datum,
      )[0];

      if (mitt) {
        const slut = new Date(`${datum}T${mitt.end_time}`);
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
          stangda++;
          autoStangd = true;
          await db.from("audit_log").insert({
            actor_id: null,
            action: "time.auto_closed",
            object_type: "employee",
            object_id: p.id,
            meta: { datum, vid: mitt.end_time },
          });
        }
      }
    }

    // 2. Journalen. AC-2.19-2.21: over-, mer- och jourtid star som noll tills
    //    schemat kan skilja dem at — en gissad siffra i en compliance-vy ar
    //    varre an en tom.
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
    if (!journalFel) journalrader++;

    // 3. Avvikelser. RAST_AKTIV ar spärren fran K29 — utan dokumenterat
    //    rastschema genereras ingenting alls.
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
      if (!error) nyaAvvikelser++;
    }
  }

  // 4. Gallring. Summera forst, radera sedan — aldrig tvartom.
  const gransDetalj = new Date();
  gransDetalj.setDate(gransDetalj.getDate() - GALLRING_DAGAR);
  const detaljGrans = gransDetalj.toISOString().slice(0, 10);

  const { data: attSummera } = await db
    .from("break_deviation")
    .select("employee_id, work_date, kind")
    .lt("work_date", detaljGrans);

  const summa = new Map<string, number>();
  for (const d of attSummera ?? []) {
    const nyckel = `${d.employee_id}|${d.work_date.slice(0, 7)}-01|${d.kind}`;
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

  const gallrade = (attSummera ?? []).length;
  if (gallrade > 0) await db.from("break_deviation").delete().lt("work_date", detaljGrans);

  const gransAggregat = new Date();
  gransAggregat.setMonth(gransAggregat.getMonth() - AGGREGAT_MANADER);
  await db
    .from("break_deviation_month")
    .delete()
    .lt("month", gransAggregat.toISOString().slice(0, 10));

  return NextResponse.json({
    datum,
    stangda,
    journalrader,
    avvikelser: nyaAvvikelser,
    gallrade,
    raster_aktiva: RAST_AKTIV,
  });
}

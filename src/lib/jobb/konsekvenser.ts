import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gallandeSchema } from "@/lib/raster";
import { gallande, type Handelse } from "@/lib/tid";
import { uteblivenInstampling } from "@/lib/konsekvens";
import { stampelfriaAnstallda } from "@/lib/stampelfri-server";
import {
  svensktDatum,
  svenskTidpunkt,
  svenskDygnsslut,
  svenskVeckodag,
  dagarBakat,
} from "@/lib/klocka";

/**
 * E13 steg 6: forslagsmotorn for utebliven instampling.
 *
 * ===========================================================================
 * DEN HAR FILEN FORESLAR. DEN BESLUTAR ALDRIG.
 *
 * Varje rad den skriver far status `foreslagen`, och en foreslagen handelse har
 * ingen konsekvens alls: den syns inte for den den galler (RLS i 0037), den
 * raknas inte i trappan (`raknas()` i `konsekvens.ts`), och den ror inga pengar.
 * Forst nar en chef GODKANNER att personen faktiskt inte var pa plats blir den
 * en ogiltig franvaro.
 *
 * Det ar avsnitt 7.1 i PROVISION_SPEC.md, och det ar inte en artighet mot
 * chefen utan hela konstruktionen: navet KAN INTE SE skillnad pa "kom inte" och
 * "var har men glomde stampla". Bestallarens svar pa O15 var att den som varit
 * har aldrig raknas, och den enda som vet det ar en manniska.
 * ===========================================================================
 *
 * VARFOR DEN INTE LIGGER I `tid.ts`: nattjobbet dar gar igenom dagar SOM HAR
 * STAMPLINGAR. Den har motorn letar efter raka motsatsen — dagar som saknar
 * dem — och en dag da ingen alls stamplade hoppas over av den yttre slingan i
 * `korTidjobbet` innan den ens borjar. De tva behover olika material.
 */

/** Samma ikappfonster som `korTidjobbet`. Ett uteblivet jobb ska lakas. */
const IKAPP_DAGAR = 14;

/**
 * Hur farsk en dag maste vara for att lamnas i fred.
 *
 * Gardagen foreslas inte. Den som var sjuk igar ringer och sjukanmaler sig i
 * dag, och en rattelse for en glomd stampling har 48 timmar pa sig
 * (`RATTELSE_FRIST_TIMMAR` i `tid.ts`). Ett forslag som laggs samma natt hade
 * legat i chefens ko innan personen ens haft chans att forklara sig, och det
 * ar precis den sortens automatik avsnitt 7.1 finns for att undvika.
 */
const KARENS_DAGAR = 2;

export type Konsekvensutfall = {
  /** Nya forslag som lagts. */
  foreslagna: number;
  /** Forslag som dragits tillbaka for att franvaron kommit in i efterhand. */
  aterkallade: number;
  /** Dagar som hoppats over for att de tacks av godkand franvaro eller sjukdom. */
  tackta: number;
};

/**
 * Dagarna en person ar franvarande med giltigt skal.
 *
 * ===========================================================================
 * DEN HAR UPPGIFTEN LASES FOR ATT INTE GORA NAGOT. Den lagras inte, den visas
 * inte, och den star aldrig pa handelsen — `attendance_incident` har ingen
 * kolumn for skal, och det ar med flit.
 *
 * AC-3.26 och E7.14 sager att franvaro ska hamtas via
 * `payroll_row.absence_minutes` och aldrig genom att joina `sick_report`. Den
 * regeln handlar om VYER: RLS ger noll rader for `finance` och
 * `payroll_cost_viewer`, sa en vy som joinar far tyst fel data i stallet for
 * ett felmeddelande.
 *
 * Har ar laget ett annat, och skillnaden ar vard att skriva ut:
 *
 *   1. Jobbet kor med SERVICE ROLE. Det finns ingen RLS som tyst kan ge noll
 *      rader och darmed ingen tyst felkalla — motsatsen till vyfallet.
 *   2. `payroll_row` duger inte. Den bar minuter per LONEPERIOD, inte vilka
 *      DAGAR som var franvaro, och det ar dagen fragan galler.
 *   3. Riktningen ar den omvanda. Uppgiften anvands uteslutande for att
 *      UNDERLATA att foresla en disciplinar handelse. Att inte lasa den hade
 *      gett sjukskrivna personer forslag i chefens ko — vilket ar bade
 *      samre for den enskilde och exakt det AC-3.26 skyddar mot.
 *
 * Falle den har filtreringen bort ar felet inte teoretiskt: varje sjukdag i
 * bolaget blir ett forslag om ogiltig franvaro.
 * ===========================================================================
 */
async function tacktaDagar(
  db: SupabaseClient,
  fran: string,
  till: string,
): Promise<Set<string>> {
  const [{ data: ledighet }, { data: sjuk }] = await Promise.all([
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
  ]);

  const tackt = new Set<string>();

  const lagg = (person: string, start: string, slut: string) => {
    for (let d = start > fran ? start : fran; d <= (slut < till ? slut : till); ) {
      tackt.add(`${person}|${d}`);
      d = dagarBakat(d, -1);
    }
  };

  for (const l of ledighet ?? []) {
    lagg(String(l.employee_id), String(l.starts_on).slice(0, 10), String(l.ends_on).slice(0, 10));
  }

  for (const s of sjuk ?? []) {
    // `last_sick_day` null = pagaende sjukfranvaro. Den tacker allt fram till i
    // dag; en anmalan utan slutdatum ar inte avslutad.
    const slut = s.last_sick_day ? String(s.last_sick_day).slice(0, 10) : till;
    lagg(String(s.employee_id), String(s.first_sick_day).slice(0, 10), slut);
  }

  return tackt;
}

/**
 * Letar upp dagar som saknar instampling helt och lagger dem som forslag.
 *
 * Kors av nattjobbet efter `korTidjobbet`. Ordningen spelar roll: rattelser som
 * godkanns under natten ska rakas som stamplingar, och `korTidjobbet` ar det
 * som stanger dygnet.
 */
export async function foreslaOgiltigFranvaro(db: SupabaseClient): Promise<Konsekvensutfall> {
  const utfall: Konsekvensutfall = { foreslagna: 0, aterkallade: 0, tackta: 0 };

  const idag = svensktDatum(new Date());
  const senaste = dagarBakat(idag, KARENS_DAGAR);
  const tidigaste = dagarBakat(idag, IKAPP_DAGAR);

  const [
    { data: personal },
    { data: scheman },
    { data: befintliga },
    stampelfria,
  ] = await Promise.all([
    db.from("employee").select("id, team_id, start_date, end_date").neq("status", "offboarded"),
    db
      .from("work_schedule")
      .select("id, scope, employee_id, team_id, weekday, start_time, end_time, tol_late, valid_from"),
    db
      .from("attendance_incident")
      .select("id, employee_id, occurred_on, status")
      .gte("occurred_on", tidigaste),
    /**
     * Vilka som inte stamplar.
     *
     * DEN HAR MANGDEN AR DEN VIKTIGASTE FILTRERINGEN I FILEN. Motorn letar
     * efter dagar UTAN instampling, och for VD, saljchef, ekonomi och
     * projektledare ar varje arbetsdag en sadan dag. Utan den skulle var och
     * en av dem fa ett forslag om ogiltig franvaro per schemalagd dag — forsta
     * steget i konsekvenstrappan, i chefens ko, om nagot de inte gjort fel.
     *
     * Samma riktning som `tacktaDagar()` ovan: uppgiften lases uteslutande for
     * att UNDERLATA att foresla nagot.
     */
    stampelfriaAnstallda(db),
  ]);

  const tackt = await tacktaDagar(db, tidigaste, senaste);

  // En dag som redan har en rad rors aldrig igen — oavsett status. Det unika
  // indexet `attendance_incident_dag_idx` skulle neka en andra rad anda, men en
  // motor som forsokte hade byggt sin egen trappa av sina omkorningar.
  const harRad = new Map<string, { id: string; status: string }>();
  for (const b of befintliga ?? []) {
    harRad.set(`${b.employee_id}|${String(b.occurred_on).slice(0, 10)}`, {
      id: String(b.id),
      status: String(b.status),
    });
  }

  // -------------------------------------------------------------------------
  // 1. Aterkalla forslag som franvaron hunnit ikapp.
  //
  // Den som sjukanmaler sig i efterhand, eller far en ledighet godkand
  // retroaktivt, ska inte ha ett forslag liggande i chefens ko. Raderingen ar
  // tillaten just for att statusen ar `foreslagen` — triggern
  // `attendance_incident_ar_last` i 0037 nekar allt annat.
  // -------------------------------------------------------------------------
  for (const [nyckel, rad] of harRad) {
    if (rad.status !== "foreslagen") continue;

    // Tva skal att dra tillbaka, och det andra ar nytt: en person som blivit
    // stampelfri sedan forslaget lades ska inte ha det liggande kvar i kon.
    // Rollbytet ar svaret pa fragan forslaget stallde, och en ko som staddar
    // sig sjalv ar skillnaden mellan en regel som galler och en som galler
    // framat men lamnar en hog bakom sig.
    const stampelfriaRollen = stampelfria.has(nyckel.split("|")[0]);
    if (!tackt.has(nyckel) && !stampelfriaRollen) continue;

    const { error } = await db.from("attendance_incident").delete().eq("id", rad.id);
    if (!error) {
      utfall.aterkallade++;
      harRad.delete(nyckel);
      await db.from("audit_log").insert({
        actor_id: null,
        action: "attendance_incident.withdrawn",
        object_type: "attendance_incident",
        object_id: rad.id,
        meta: {
          orsak: stampelfriaRollen
            ? "rollen stämplar inte"
            : "franvaron registrerades i efterhand",
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Leta nya dagar.
  // -------------------------------------------------------------------------
  const dagar: string[] = [];
  for (let i = IKAPP_DAGAR; i >= KARENS_DAGAR; i--) dagar.push(dagarBakat(idag, i));

  for (const datum of dagar) {
    const fran = svenskTidpunkt(datum, "00:00").toISOString();
    const till = svenskDygnsslut(datum);
    const veckodag = svenskVeckodag(fran);

    const { data: handelser } = await db
      .from("time_event")
      .select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state")
      .gte("occurred_at", fran)
      .lte("occurred_at", till);

    const perPerson = new Map<string, Handelse[]>();
    for (const h of handelser ?? []) {
      perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
    }

    for (const p of personal ?? []) {
      // Den stampelfria rollen har ingen skyldighet att stampla, och darmed
      // ingen dag som kan vara utebliven. Se `lib/stampelfri.ts`.
      if (stampelfria.has(p.id)) continue;

      const nyckel = `${p.id}|${datum}`;
      if (harRad.has(nyckel)) continue;

      // Utanfor anstallningen finns ingen skyldighet att stampla. Den som
      // borjar den 20:e har inte uteblivit den 5:e.
      const start = p.start_date ? String(p.start_date).slice(0, 10) : null;
      const slut = p.end_date ? String(p.end_date).slice(0, 10) : null;
      if (start && datum < start) continue;
      if (slut && datum > slut) continue;

      if (tackt.has(nyckel)) {
        utfall.tackta++;
        continue;
      }

      const dagensSchema = gallandeSchema(
        (scheman ?? []).filter((s) => s.weekday === veckodag),
        p.id,
        p.team_id,
        datum,
      )[0];

      // `gallande()` sallar bort rattelser som inte godkants. En avvisad
      // rattelse ar inte en stampling — men en godkand ar det, aven om den kom
      // in efterat, och da ar dagen inte langre ett fall.
      const egna = gallande(perPerson.get(p.id) ?? []);

      const minuter = uteblivenInstampling(
        egna,
        dagensSchema
          ? { start_time: dagensSchema.start_time, end_time: dagensSchema.end_time }
          : null,
      );
      if (minuter === null) continue;

      const { data: skapad, error } = await db
        .from("attendance_incident")
        .insert({
          employee_id: p.id,
          occurred_on: datum,
          minutes: minuter,
          status: "foreslagen",
          source: "stampling",
        })
        .select("id")
        .maybeSingle();

      // 23505 = unique_violation, alltsa en rad som kom till mellan
      // hamtningen och skrivningen. Det ar inte ett fel — det ar indexet som
      // gor sitt jobb.
      if (error && error.code !== "23505") continue;
      if (error) continue;

      utfall.foreslagna++;
      harRad.set(nyckel, { id: String(skapad?.id ?? ""), status: "foreslagen" });

      await db.from("audit_log").insert({
        actor_id: null,
        action: "attendance_incident.suggested",
        object_type: "attendance_incident",
        object_id: skapad?.id ?? null,
        meta: { employee_id: p.id, datum, minuter },
      });
    }
  }

  return utfall;
}

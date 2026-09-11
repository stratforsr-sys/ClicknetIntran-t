import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/roles";
import { granskningslage } from "@/lib/dokument";
import { kursLage, LAGE_ETIKETT, LAGE_TON } from "@/lib/utbildning";
/**
 * Coachningen har sina EGNA lagesetiketter, och de dops om vid importen.
 *
 * `utbildning.ts` och `coachning.ts` exporterar bada `LAGE_ETIKETT` och
 * `LAGE_TON`, for de svarar pa samma sorts fraga om tva olika saker: en kurs ar
 * certifierad eller utgangen, en coachningsuppgift ar inlamnad eller underkand.
 * Att lata dem dela namn hade betytt att den ena tyst vann.
 */
import {
  LAGE_ETIKETT as LAGE_ETIKETT_COACHNING,
  LAGE_TON as LAGE_TON_COACHNING,
  TYP_ETIKETT,
  sorteraUppgifter,
} from "@/lib/coachning";
import { uppgifterFor } from "@/lib/coachning-server";
import { forsenad, fristtext } from "@/lib/uppgifter";
import {
  attGranska,
  hamtaUppgiftsbild,
  minaIdag,
  minaOppna,
  vantarPaAndra,
} from "@/lib/uppgifter-server";
import { slaLage } from "@/lib/arenden";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri, STAMPELFRI_FORKLARING } from "@/lib/stampelfri";
import { gallandeSchema } from "@/lib/raster";
import { svensktDatum, svenskVeckodag } from "@/lib/klocka";
import { hamtaProvision } from "@/lib/provision-server";
import { kronor, manadFore, manadsnamn, manadsnyckel, sammanfatta } from "@/lib/provision";
import {
  arbetadeMinuter,
  dygnetsStart,
  gallande,
  lageNu,
  tillatna,
  type Handelse,
} from "@/lib/tid";
import { FONSTER, hamtaDagsbild, hamtaFramat } from "@/lib/dagslage-server";
import { Dagslagekort, type Lagesrad } from "./Dagslagekort";
import { Kokort, type Bradskande, type Kopost } from "./Kokort";
import {

  omfattning,
  periodtext,
  periodtextOppen,
  saldoFor,
  sjukdag,
  startlage,
  STATUS_ETIKETT,
  STATUS_TON,
  type Ansokningsstatus,
  type Saldo,
} from "@/lib/franvaro";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaDrift } from "@/lib/jobb/drift-server";
import { DRIFT_ETIKETT } from "@/lib/jobb/larm";
import { Stamplar } from "./tid/Stamplar";
import { Statusband } from "./Statusband";
import { Dagslinje } from "./Dagslinje";
import { snabbvalFor } from "./snabbval";

export const dynamic = "force-dynamic";

/**
 * §12 Q9: ordningen ar rollstyrd. Saljaren ser stampelknappen forst — det ar
 * det enda hen gor har varje dag, och hen gor det fran telefonen i dorren.
 * Chefen ser sina koer forst, for hens arende med sidan ar att veta vad som
 * ligger och vantar pa ett beslut.
 *
 * "Att gora" hamtar bara ur levererade moduler. En rad som inte gar att
 * atgarda hor inte hemma har — da blir listan nagot man slutar titta pa.
 *
 * ===========================================================================
 * OMBYGGD 2026-08-23. TRE SAKER ANDRADES, OCH ETT AV DEM ETT AVSTEG.
 *
 * 1. UI-PRD §7 sa att startsidan inte har nagon hero. Den har nu ett
 *    STATUSBAND — halsning, levande stamplingslage och arbetad tid som tickar.
 *    Avsteget ar bestallarens beslut och star i DECISIONS.md. Skillnaden mot
 *    en hero ar att bandet bar information: det svarar pa "ar jag inne och hur
 *    lange" utan en sidladdning till /tid.
 *
 * 2. Dagen ritas som en TIDSLINJE. Den ar en avbildning av vad som stamplats,
 *    aldrig en bedomning av det — se `src/lib/dagslinje.ts` for varfor inget
 *    fargas rott har.
 *
 * 3. PROVISIONEN star pa samma sida som tiden. Det var K13 emot. Bestallaren
 *    ompravade K13 2026-08-23 efter en direkt fraga. Det som star kvar: ingen
 *    FRAGA joinar de tva tabellerna, och rastavvikelser nar fortfarande aldrig
 *    provisionen — den delen ar ett loften till personalen i K12 §5 och ar
 *    inte omprovad.
 * ===========================================================================
 */
export default async function Startsida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const supabase = await supabaseServer();
  const sparr = await hamtaLage();

  // Behorigheterna star var for sig med flit. "Chef" ar inte en roll utan tre
  // olika saker: se personalen, hantera arenden och attestera rattelser. Ett
  // enda samlat begrepp hade gett teamledaren en arendeko hen inte kan rora.
  const serPersonal = canManageEmployees(user) || hasRole(user, "ceo", "team_lead");
  const hanterarArenden = hasRole(user, "sales_manager", "ceo");
  const attesterar = canManageEmployees(user);
  const serAvvikelser = canManageEmployees(user) || hasRole(user, "team_lead");
  const chef = serPersonal || hanterarArenden;

  /**
   * Stamplar DEN HAR personen? Tva villkor, och de svarar pa olika fragor.
   *
   * `sparr.stampling` ar modulens: ar stamplingen paslagen i bolaget alls.
   * `stampelfri` ar personens: har rollen en arbetstid som mats in och ut. VD,
   * saljchef, ekonomi och projektledare har inte det — se `lib/stampelfri.ts`.
   *
   * Skillnaden mot att bara dolja knappen ar att BADA fragorna nedan ocksa
   * uteblir. En stamplingsfraga for nagon som inte stamplar hamtar alltid noll
   * rader; att stalla den anda ar tva turer per sidvisning for ett svar som ar
   * kant i forvag.
   */
  const stamplar = sparr.stampling && !stampelfri(user.roles);

  // E0.7. Exakt kretsen i `audit_log_read`, alltsa samma som `hanterar` pa
  // /fel. Se driftraden langre ner for varfor fragan stalls villkorat.
  const serDrift = hasRole(user, "sales_manager", "ceo", "admin");

  /**
   * DAGSBILDEN — vem som ar sjuk, ledig eller inte instamplad i dag.
   *
   * Kretsen ar INTE `serPersonal`, och det ar avsiktligt. `absence_request` och
   * `sick_report` slapper inte in `admin` (0019, 0020), sa en admin hade fatt
   * ett kort dar personalen ser fulltalig ut aven en dag halva bolaget ar
   * sjukt. Ett kort som ljuger tyst ar varre an inget kort. Samma tre roller
   * som slapps in pa /franvaro/planering slapps in har.
   */
  const serDagslage = hasRole(user, "sales_manager", "ceo", "team_lead");

  /**
   * ===========================================================================
   * EN VAG, INTE SEX.
   *
   * Startsidan stallde tidigare sina fragor i sex omgangar efter varandra. Ingen
   * av dem behovde svaret fran den forra — de vantade bara for att de rakade
   * sta i den ordningen i filen. Allt harnedan beror pa `user` och `sparr`, och
   * bada ar kanda redan har.
   *
   * De villkorade fragorna star kvar som villkorade. En ko som inte ska visas
   * ska inte heller hamtas, och `Promise.resolve` haller platsen i listan utan
   * att kosta en tur.
   *
   * LAGGER DU TILL EN FRAGA: lagg den i den har listan. En fraga som behover
   * svaret fran en annan hor hemma i en andra omgang langre ner — men kolla
   * forst om den verkligen gor det. Det gjorde ingen av de fem som lag har.
   * ===========================================================================
   */
  const nu = new Date();
  const idagFran = dygnetsStart();
  const idagDatum = new Date().toISOString().slice(0, 10);
  const idagSvenskt = svensktDatum(nu);
  const veckodag = svenskVeckodag(nu);
  const dennaManad = manadsnyckel(nu);


  const [
    { data: kravDok },
    { data: minaAck },
    { data: mittAgande },
    { data: minaArenden },
    { data: kurser },
    { data: kursModuler },
    { data: minProgress },
    { data: minaCert },
    { data: idag },
    { data: scheman },
    { data: rastscheman },
    provisionsposter,
    { data: koArenden },
    { count: attKvittera },
    { data: koFranvaro },
    { data: obekraftadSjuk },
    { data: koRollspel },
    { count: antalAktiva },
    { count: antalOnboarding },
    drift,
    coachning,
    dagsbild,
    { data: minaAnsokningar },
    { data: minaSaldon },
    { data: minSjuk },
    framat,
  ] = await Promise.all([
    // RLS avgor vilka dokument som syns: audience_roles filtreras redan i
    // policyn, sa listan nedan behover inte upprepa den kontrollen.
    supabase
      .from("document")
      .select("id, slug, title, version, review_due")
      .eq("status", "published")
      .eq("requires_ack", true)
      .order("review_due"),
    supabase
      .from("document_ack")
      .select("document_id, version")
      .eq("employee_id", user.employee.id),
    supabase
      .from("document")
      .select("id, slug, title, review_due")
      .eq("owner_id", user.employee.id)
      .eq("status", "published")
      .lte("review_due", idagDatum)
      .order("review_due"),
    // AC-11.1 lovar arenden i listan. `waiting` satts nar nagon ANNAN an
    // agaren skrivit i traden — alltsa precis nar ledningen har svarat och
    // bollen ligger hos den anstallda. Se arenden/actions.ts.
    supabase
      .from("hr_case")
      .select("id, subject, status, resolved_at, due_at, sla_hours")
      .eq("employee_id", user.employee.id)
      .eq("status", "waiting")
      .is("resolved_at", null)
      .order("due_at"),

    // AC-6.6 pa startsidan: en kurs som ligger och skraper ar lika mycket en
    // uppgift som en okvitterad rutin.
    supabase
      .from("course")
      .select("id, slug, title, due_days")
      .eq("status", "published")
      .order("title"),
    supabase.from("course_module").select("id, course_id"),
    supabase.from("module_progress").select("module_id").eq("employee_id", user.employee.id),
    supabase
      .from("certification")
      .select("course_id, issued_at, expires_at")
      .eq("employee_id", user.employee.id)
      .order("issued_at", { ascending: false }),

    // Stamplingen. Bara dagens handelser — resten hor hemma pa /tid.
    stamplar
      ? supabase
          .from("time_event")
          .select("id, kind, occurred_at, source, supersedes_id, correction_state, note")
          .eq("employee_id", user.employee.id)
          .gte("occurred_at", idagFran)
          .order("occurred_at")
      : Promise.resolve({ data: null }),

    // Dagens schema, for tidslinjens ram och for "kvar till schemats slut".
    // RLS ger bolagets, teamets och det egna — `gallandeSchema` valjer sedan
    // den mest specifika, precis som nattjobbet gor.
    stamplar
      ? supabase
          .from("work_schedule")
          .select("scope, employee_id, team_id, start_time, end_time, valid_from")
          .eq("weekday", veckodag)
          .lte("valid_from", idagSvenskt)
      : Promise.resolve({ data: null }),

    // Rastschemat behovs bara till nedrakningen, och nedrakningen finns bara
    // nar rasten ar pa. Utan schemalagd langd raknas ingenting ner — en
    // nedrakning mot en gissad rastlangd vore varre an ingen alls.
    stamplar && sparr.rast
      ? supabase
          .from("scheduled_break")
          .select("scope, employee_id, team_id, sort, duration_minutes, valid_from")
          .eq("weekday", veckodag)
          .lte("valid_from", idagSvenskt)
      : Promise.resolve({ data: null }),

    // E13. Egna poster, tolv manader bakat — kortet visar innevarande manad,
    // men jamforelsen med forra manaden och arssumman kommer ur samma svar.
    hamtaProvision(user.employee.id, manadFore(dennaManad, 11)),

    /**
     * Chefens ko.
     *
     * Avvikelserna raknas medvetet INTE. K19 kraver att varje chefsoppning av
     * avvikelsevyn loggas, och en siffra pa startsidan hade betytt en oppning
     * per sidladdning — bade en logg full av brus och en insyn som skett utan
     * att nagon valde den. Posten ar darfor en lank och ingenting mer.
     */
    hanterarArenden
      ? supabase
          .from("hr_case")
          .select("id, due_at, sla_hours, resolved_at")
          .is("resolved_at", null)
          .in("status", ["new", "in_progress"])
      : Promise.resolve({ data: null }),
    attesterar && sparr.stampling
      ? supabase
          .from("time_event")
          .select("id", { count: "exact", head: true })
          .eq("correction_state", "pending")
      : Promise.resolve({ count: null }),
    // E7. Bada laser med anvandarens egen token: absence_request_read och
    // sick_report_read slapper igenom egen rad, den man leder och ledningen.
    // Egna rader filtreras bort i koden — ingen beslutar om sin egen ledighet,
    // och en ko med sin egen ansokan i ar en ko man inte kan tomma.
    // Kon visar sedan 2026-09-07 de tre som bradskar, inte bara ett antal.
    // Namnet och typen kommer som inbaddade resurser — och nyckeln ar NAMNGIVEN,
    // for `absence_request` har fyra frammande nycklar mot `employee` och en
    // otvetydig inbaddning svarar med ett fel i stallet for med rader.
    supabase
      .from("absence_request")
      .select(
        "id, employee_id, starts_on, ends_on, part_day_minutes, rules_broken, absence_type!inner(label), employee!absence_request_employee_id_fkey(first_name, last_name)",
      )
      .eq("status", "submitted"),
    supabase
      .from("sick_report")
      .select(
        "id, employee_id, registered_at, first_sick_day, employee!sick_report_employee_id_fkey(first_name, last_name)",
      )
      .is("confirmed_at", null)
      .is("cancelled_at", null),

    // E8.7: inlamnade rollspel som ingen bedomt. RLS ger bara egna rader plus
    // dem man leder (0024), sa filtret nedan tar bort just de egna — resten ar
    // per definition nagon annans, och alltsa chefens att bedoma.
    supabase
      .from("roleplay_submission")
      .select("id, employee_id, submitted_at")
      .is("graded_at", null),

    serPersonal
      ? supabase.from("employee").select("id", { count: "exact", head: true }).eq("status", "active")
      : Promise.resolve({ count: null }),
    serPersonal
      ? supabase
          .from("employee")
          .select("id", { count: "exact", head: true })
          .eq("status", "onboarding")
      : Promise.resolve({ count: null }),

    /**
     * E0.7. Nattjobbets senaste kvitto — i den BEFINTLIGA vagen, inte i en
     * egen. Vagantalet ar det som vaxer nar navet vaxer, och den har fragan
     * beror bara pa `user`, som ar kand redan har.
     *
     * Anvandarens EGEN token. `audit_log_read` slapper in sales_manager, ceo
     * och admin, sa RLS har redan svarat pa fragan om vem som far se raden.
     *
     * Att fragan anda ar villkorad ar inte ett andra rollfilter — kretsen kan
     * inte bli vidare an RLS. Skalet ar att noll rader annars betyder tva
     * olika saker, "jobbet har aldrig kort" och "du far inte se
     * handelseloggen", och saljaren hade fatt en larmrad om det forsta nar det
     * andra var sant.
     */
    serDrift ? hamtaDrift(supabase, nu) : Promise.resolve(null),

    /**
     * MINA COACHNINGSUPPGIFTER.
     *
     * Fragan ar OVILLKORAD, till skillnad fran chefskoerna ovan. Coachning
     * galler alla anstallda och inte bara saljare — det var bestallarens beslut
     * i utredningens avsnitt 0 — sa det finns ingen roll att villkora pa.
     * `uppgifterFor()` filtrerar pa `assignee_id` och RLS avgor resten.
     *
     * Funktionen staller flera fragor inuti sig, men de ar sekventiellt
     * beroende av varandra (uppgifterna innan handelserna) och kan darfor inte
     * plattas ut i den har listan. Som EN post i `Promise.all` loper de
     * atminstone parallellt med startsidans ovriga arton.
     */
    uppgifterFor(user.employee.id, nu),

    /**
     * CHEFENS DAGSBILD. Sju fragor inuti en post, av samma skal som
     * coachningen ovan: de hor ihop, de loper parallellt med varandra, och som
     * EN post loper de dessutom parallellt med startsidans ovriga fragor.
     *
     * Villkoret ar inte ett andra rollfilter — kretsen kan inte bli vidare an
     * RLS. Skalet ar att saljaren annars stallt sju fragor per sidvisning for
     * ett svar som ar kant i forvag: noll rader, inget kort.
     */
    serDagslage ? hamtaDagsbild(supabase, nu, sparr.stampling) : Promise.resolve(null),

    /**
     * =====================================================================
     * MIN EGEN FRANVARO (bestallarens val 2026-09-07).
     *
     * Startsidan bar chefens dagsbild sedan 2026-09-03, men den anstallda
     * sjalv sag ingenting alls om sin franvaro har — inte sin obeslutade
     * ansokan, inte sin inbokade semester, inte sitt saldo. Den som ville
     * veta om chefen svarat fick oppna /franvaro och titta efter.
     *
     * Fragorna ar OVILLKORADE. De galler den inloggades EGNA rader, och
     * `absence_request_read` slapper alltid igenom dem — det finns ingen roll
     * att villkora pa och ingen krets att skydda.
     * =====================================================================
     */
    // Etiketten hamtas som inbaddad resurs och inte i en egen fraga:
    // `absence_type_read` slapper in varje inloggad (0019), sa det finns
    // ingenting att filtrera och ingen tur att spara pa att fraga separat.
    supabase
      .from("absence_request")
      .select("id, type_id, starts_on, ends_on, part_day_minutes, status, absence_type!inner(label)")
      .eq("employee_id", user.employee.id)
      .in("status", ["submitted", "approved"])
      .gte("ends_on", idagDatum)
      .order("starts_on"),

    supabase
      .from("absence_balance")
      .select("type_id, days, as_of, earned_year, absence_type!inner(label)")
      .eq("employee_id", user.employee.id),

    supabase
      .from("sick_report")
      .select("id, first_sick_day, extent_percent, confirmed_at")
      .eq("employee_id", user.employee.id)
      .is("last_sick_day", null)
      .is("cancelled_at", null)
      .order("first_sick_day", { ascending: false })
      .limit(1),

    /**
     * CHEFENS FRAMATBLICK, som en post och inte som en fraga.
     *
     * `hamtaFramat` staller tva fragor och far ut alla fonster pa en gang —
     * det storsta ar ett superset av de mindre. En fraga per flik hade gett
     * tre turer for ett svar som redan lag i den forsta.
     */
    serDagslage ? hamtaFramat(supabase, idagDatum) : Promise.resolve(null),
  ]);

  // ---------------------------------------------------------------------------
  // Harifran och ner raknas det bara i minnet. Ingen fraga till.
  // ---------------------------------------------------------------------------

  const modulerPerKurs = new Map<string, string[]>();
  for (const m of kursModuler ?? []) {
    modulerPerKurs.set(m.course_id, [...(modulerPerKurs.get(m.course_id) ?? []), m.id]);
  }
  const klaraModuler = new Set((minProgress ?? []).map((p) => p.module_id));
  const certPerKurs = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of minaCert ?? []) if (!certPerKurs.has(c.course_id)) certPerKurs.set(c.course_id, c);

  const kursUppgifter = (kurser ?? [])
    .map((k) => {
      const ids = modulerPerKurs.get(k.id) ?? [];
      return {
        ...k,
        antal: ids.length,
        klara: ids.filter((id) => klaraModuler.has(id)).length,
        lage: kursLage({
          certifikat: certPerKurs.get(k.id) ?? null,
          klaraModuler: ids.filter((id) => klaraModuler.has(id)).length,
          antalModuler: ids.length,
          startDatum: user.employee!.start_date,
          fristDagar: k.due_days,
        }),
      };
    })
    .filter((k) => k.antal > 0 && k.lage !== "certifierad");

  /**
   * VAD SOM AR "ATT JOBBA PA I DAG" — och vad som inte ar det.
   *
   * En INLAMNAD uppgift star inte har. Bollen ligger hos den som ska kvittera,
   * och en rad man inte kan gora nagot at hor inte hemma pa startsidan — samma
   * regel som rubriken langst upp i filen drar for hela "Att gora".
   *
   * En UNDERKAND star har, och den star hogt. Nagon har tittat och sagt att det
   * ska goras om, och det ar det narmaste ett direkt tilltal modulen har.
   *
   * Ordningen inom varje grupp ar lagvyns egen, `sorteraUppgifter()` — hade
   * startsidan sorterat pa egen hand hade de tva vyerna kunnat saga olika om
   * samma dag. `kraverDinBock` ar falskt for alla: faltet betyder "vantar pa
   * din kvittering", och det ar aldrig sant om en uppgift man sjalv ska GORA.
   * De underkanda lyfts i stallet som en egen grupp fore de ovriga.
   */
  const attGoraNu = coachning
    .filter((u) => u.lage === "ej_paborjad" || u.lage === "pagar" || u.lage === "underkand")
    .map((u) => ({ ...u, kraverDinBock: false }));

  const minaCoachning = [
    ...sorteraUppgifter(attGoraNu.filter((u) => u.lage === "underkand")),
    ...sorteraUppgifter(attGoraNu.filter((u) => u.lage !== "underkand")),
  ];

  const ackade = new Set((minaAck ?? []).map((a) => `${a.document_id}:${a.version}`));
  const okvitterade = (kravDok ?? []).filter((d) => !ackade.has(`${d.id}:${d.version}`));
  const forfallna = mittAgande ?? [];
  const obesvarade = minaArenden ?? [];

  const handelser: Handelse[] = idag ?? [];
  let stamplingslage = null;
  if (stamplar) {
    const lage = lageNu(handelser);
    const giltiga = gallande(handelser);
    const senaste = giltiga[giltiga.length - 1] ?? null;

    stamplingslage = {
      lage,
      tillatna: tillatna(lage, sparr.rast),
      minuter: arbetadeMinuter(handelser),
      // Nar det nuvarande laget borjade. Utstamplad person har inget "sedan".
      sedan: lage === "ute" ? null : (senaste?.occurred_at ?? null),
    };
  }

  const dagsschema =
    gallandeSchema(
      (scheman ?? []) as {
        scope: string;
        employee_id: string | null;
        team_id: string | null;
        valid_from: string;
        start_time: string;
        end_time: string;
      }[],
      user.employee.id,
      user.employee.team_id,
      idagSvenskt,
    )[0] ?? null;

  // Forsta rasten i schemat bar langden nedrakningen mats mot. Fler raster an
  // en pa samma dag: nedrakningen galler den som pagar, och `sort 1` ar den
  // enda som har en langd att rakna mot innan navet vet vilken rast det ar.
  const rastLangd =
    gallandeSchema(
      (rastscheman ?? []) as {
        scope: string;
        employee_id: string | null;
        team_id: string | null;
        valid_from: string;
        sort: number;
        duration_minutes: number;
      }[],
      user.employee.id,
      user.employee.team_id,
      idagSvenskt,
    ).sort((a, b) => a.sort - b.sort)[0]?.duration_minutes ?? null;

  const provision = sammanfatta(provisionsposter, nu);
  const harProvision = provisionsposter.length > 0;

  const attBesluta = (koFranvaro ?? []).filter((a) => a.employee_id !== user.employee!.id);
  const attBekrafta = (obekraftadSjuk ?? []).filter((s) => s.employee_id !== user.employee!.id);
  const attBedoma = (koRollspel ?? []).filter((r) => r.employee_id !== user.employee!.id);

  const overTiden = (koArenden ?? []).filter((a) => slaLage(a) === "over").length;
  const snart = (koArenden ?? []).filter((a) => slaLage(a) === "snart").length;

  const snabbval = snabbvalFor(user, stamplar);

  /**
   * ===========================================================================
   * E0.7 DRIFTRADEN. RITAS BARA NAR NAGOT AR FEL.
   *
   * Ingen notis nar allt ar gront. En rad som varje dag sager "nattjobbet
   * kordes" ar en ruta man slutar lasa, och nar den en dag sager nagot annat
   * har ogat redan lart sig att hoppa over den — samma skal som gomde
   * arendekortet nedan.
   *
   * VARFOR DET INTE AR EN ANDRA CRON: en cron som vaktar cron dor samma dod.
   * Tre cron-poster deklarerades en gang, planen tar tva, ingen av dem kordes,
   * och en instampling stod oppen i tva dygn utan att nagon markte det. En
   * vaktpost hade varit tyst genom hela det forloppet. Den enda observator som
   * ar oberoende av att cron fungerar ar en manniska som oppnar en sida — och
   * startsidan ar den sida som faktiskt oppnas.
   *
   * ETT DELVIS FALLET JOBB RITAR INGEN RAD, och det ar med flit. Jobbet larmar
   * sjalvt om varje fallet steg, larmet hamnar i `error_report` och darmed i
   * notisklockan. Raden ar reserverad for det enda felet jobbet omojligt kan
   * rapportera om sig sjalvt: att det inte kort alls.
   * ===========================================================================
   */
  const driftrad =
    drift && drift.besked.lage !== "ok" ? (
      <Card status="danger">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-body text-ink-900">{DRIFT_ETIKETT[drift.besked.lage]}</p>
            <p className="mt-1 text-small text-ink-500">
              {drift.besked.lage === "aldrig"
                ? "Det finns inget kvitto i händelseloggen. Kontrollera cron-posten."
                : `Senaste kvittot är ${drift.besked.timmar} timmar gammalt. Stämplingar har inte stängts och sena ankomster inte registrerats för den natten.`}
            </p>
          </div>
          <ButtonLink href="/fel" size="sm">
            Se driftläget
          </ButtonLink>
        </div>
      </Card>
    ) : null;

  /**
   * DAGSKORTET. Stampelknapparna, dagens linje och snabbvalen i ett.
   *
   * De hor ihop for att de svarar pa samma fraga: vad gor jag har och nu. Att
   * dela dem i tre kort hade gett tre rubriker att lasa innan man hittar
   * knappen man kom for.
   */
  const dagskort = (
    <Card status="brand">
      {stamplingslage ? (
        <>
          <Stamplar lage={stamplingslage.lage} tillatna={stamplingslage.tillatna} kompakt />
          <div className="mt-5">
            <Dagslinje
              handelser={handelser}
              schema={dagsschema}
              rastLangd={rastLangd}
              serverTid={nu.toISOString()}
            />
          </div>
        </>
      ) : (
        <p className="text-small text-ink-500">
          {/* Tva olika besked, for det ar tva olika saker. "Avstangd" galler
              hela bolaget och ar tillfalligt; den stampelfria rollen ar ett
              varaktigt forhallande, och den som last det ska inte behova
              undra om nagot ar trasigt. */}
          {sparr.stampling
            ? `${STAMPELFRI_FORKLARING} Snabbvalen nedan fungerar som vanligt.`
            : "Stämplingen är avstängd. Snabbvalen nedan fungerar som vanligt."}
        </p>
      )}

      {snabbval.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-canvas pt-5">
          {snabbval.map((s) => (
            <ButtonLink key={s.href} href={s.href} size="sm" variant="sekundar">
              <Ikon namn={s.ikon} className="size-4" />
              {s.text}
            </ButtonLink>
          ))}
        </div>
      )}
    </Card>
  );

  const attGora = (
    <Card>
      <CardHeader
        titel="Att göra"
        beskrivning="Coachning, kvittenser, kurser och ärenden som väntar på dig."
      />
      {okvitterade.length === 0 &&
      forfallna.length === 0 &&
      kursUppgifter.length === 0 &&
      obesvarade.length === 0 &&
      minaCoachning.length === 0 ? (
        <EmptyState
          rubrik="Ingenting väntar på dig"
          text="Här samlas coachningsuppgifter, rutiner du inte kvitterat, kurser som pågår och ärenden med svar."
        />
      ) : (
        <ul className="flex flex-col">
          {/* COACHNINGEN LIGGER OVERST, och det ar ett val om vad sidan ar till
              for. En okvitterad rutin ar administration; en coachningsuppgift
              ar det nagon bett just den har personen att TRANA pa. Underlaget
              bakom modulen ar entydigt om att det ar uppfoljningens frekvens
              som skiljer, och en uppgift langst ner i en lista foljs inte upp. */}
          {minaCoachning.map((u) => (
            <Uppgift
              key={`coachning-${u.id}`}
              href={`/coachning/uppgift/${u.id}`}
              titel={u.title}
              detalj={
                [
                  TYP_ETIKETT[u.kind],
                  u.due_date ? `klar senast ${u.due_date}` : null,
                  u.lage === "pagar" ? "påbörjad" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              markering={
                u.lage === "underkand" ? (
                  <Badge ton="danger">Gör om</Badge>
                ) : u.forsenad ? (
                  <Badge ton="danger">Försenad</Badge>
                ) : (
                  <Badge ton={LAGE_TON_COACHNING[u.lage]}>{LAGE_ETIKETT_COACHNING[u.lage]}</Badge>
                )
              }
            />
          ))}
          {okvitterade.map((d) => (
            <Uppgift
              key={d.id}
              href={`/rutiner/${d.slug}`}
              titel={d.title}
              detalj={`Version ${d.version} · ${granskningslage(d.review_due).text}`}
              markering={<Badge ton="accent">Kvittera</Badge>}
            />
          ))}
          {obesvarade.map((a) => (
            <Uppgift
              key={`arende-${a.id}`}
              href={`/arenden/${a.id}`}
              titel={a.subject}
              detalj="Ledningen har svarat och väntar på dig"
              markering={<Badge ton={slaLage(a) === "over" ? "danger" : "accent"}>Svara</Badge>}
            />
          ))}
          {kursUppgifter.map((k) => (
            <Uppgift
              key={`kurs-${k.id}`}
              href={`/utbildning/${k.slug}`}
              titel={k.title}
              detalj={`${k.klara} av ${k.antal} moduler klara`}
              markering={<Badge ton={LAGE_TON[k.lage]}>{LAGE_ETIKETT[k.lage]}</Badge>}
            />
          ))}
          {forfallna.map((d) => (
            <Uppgift
              key={`agare-${d.id}`}
              href={`/rutiner/${d.slug}/redigera`}
              titel={d.title}
              detalj={`Du äger dokumentet · ${granskningslage(d.review_due).text}`}
              markering={<Badge ton="danger">Granska</Badge>}
            />
          ))}
        </ul>
      )}
    </Card>
  );

  /**
   * ==========================================================================
   * KON. Antal per omrade, och de tre som bradskar.
   *
   * Posterna ar sammanfattningar; `bradskande` ar faktiska saker MED EN FRIST.
   * Bara sadana gar att rangordna mot varandra — se rubriken i `Kokort.tsx`
   * for varfor en tidsrattelse och ett rollspel star utanfor topplistan.
   * ==========================================================================
   */
  const koposter: Kopost[] = [];

  if (hanterarArenden && overTiden > 0)
    koposter.push({
      nyckel: "arende-over",
      omrade: "arenden",
      href: "/arenden",
      text: `${overTiden} ärende${overTiden === 1 ? "" : "n"} över tiden`,
      detalj: "Svarstiden har passerat",
      ton: "danger",
    });
  if (hanterarArenden && snart > 0)
    koposter.push({
      nyckel: "arende-snart",
      omrade: "arenden",
      href: "/arenden",
      text: `${snart} snart förfallna`,
      detalj: "Sista fjärdedelen av fristen",
      ton: "warn",
    });
  if (attesterar && (attKvittera ?? 0) > 0)
    koposter.push({
      nyckel: "tid-rattelse",
      omrade: "tid",
      href: "/tid",
      text: `${attKvittera} rättelse${attKvittera === 1 ? "" : "r"} att besluta`,
      detalj: "Både den gamla och den nya tiden visas",
      ton: "warn",
    });
  // AC-3.17: en obekraftad sjukanmalan ligger overst. Bekraftelsen ar inte
  // administration utan hela poangen — nagon ska ha sett anmalan, och den som
  // ar sjuk ska veta att nagon gjort det.
  if (attBekrafta.length > 0)
    koposter.push({
      nyckel: "sjuk-bekrafta",
      omrade: "franvaro",
      href: "/franvaro/sjuk",
      text: `${attBekrafta.length} ${attBekrafta.length === 1 ? "sjukanmälan" : "sjukanmälningar"} att bekräfta`,
      detalj: "Bekräfta att du sett den",
      ton: "danger",
    });

  if (attBesluta.length > 0)
    koposter.push({
      nyckel: "franvaro-besluta",
      omrade: "franvaro",
      href: "/franvaro/attest",
      text: `${attBesluta.length} ${attBesluta.length === 1 ? "ledighetsansökan" : "ledighetsansökningar"} att besluta`,
      detalj: attBesluta.some((a) => ((a.rules_broken ?? []) as string[]).length > 0)
        ? "Minst en bryter mot en regel"
        : "Alla följer reglerna",
      ton: "warn",
    });

  if (attBedoma.length > 0)
    koposter.push({
      nyckel: "rollspel",
      omrade: "utbildning",
      href: "/utbildning/rollspel",
      text: `${attBedoma.length} rollspel att bedöma`,
      detalj: "Lyssna först — öppningen loggas och syns för säljaren",
      ton: "warn",
    });

  if (serAvvikelser && sparr.stampling)
    koposter.push({
      nyckel: "rastavvikelser",
      omrade: "tid",
      href: "/tid/avvikelser",
      text: "Rastavvikelser",
      detalj: "Din öppning av vyn loggas",
      ton: "neutral",
    });

  /**
   * DE BRADSKANDE. Obekraftad sjukanmalan forst, sedan allt med en frist,
   * narmast forst. Rollspel och rattelser saknar frist och star darfor inte
   * har — bara som antal ovan.
   */
  const bradskande: Bradskande[] = [
    ...attBekrafta.map((s0) => {
      const p0 = (s0 as unknown as { employee: { first_name: string; last_name: string } | null }).employee;
      return {
        nyckel: `sjuk-${s0.id}`,
        omrade: "franvaro" as const,
        href: "/franvaro/sjuk",
        titel: `${p0 ? `${p0.first_name} ${p0.last_name}` : "En medarbetare"} är sjukanmäld`,
        detalj: `Sjuk sedan ${periodtext(String(s0.first_sick_day), String(s0.first_sick_day))} · ingen har bekräftat`,
        frist: "Bekräfta",
        ton: "danger" as const,
        sortering: -1,
      };
    }),
    ...attBesluta.map((a) => {
      const rad = a as unknown as {
        id: string;
        starts_on: string;
        ends_on: string;
        part_day_minutes: number | null;
        absence_type: { label: string } | null;
        employee: { first_name: string; last_name: string } | null;
      };
      const lage = startlage(rad.starts_on, idagSvenskt);
      return {
        nyckel: `franvaro-${rad.id}`,
        omrade: "franvaro" as const,
        href: "/franvaro/attest",
        titel: `${rad.employee ? `${rad.employee.first_name} ${rad.employee.last_name}` : "En medarbetare"} söker ${(rad.absence_type?.label ?? "ledigt").toLowerCase()}`,
        detalj: `${periodtext(rad.starts_on, rad.ends_on)} · ${omfattning(rad)}`,
        frist: lage.text,
        ton: (lage.dagar <= 3 ? "danger" : "warn") as "danger" | "warn",
        sortering: lage.dagar,
      };
    }),
    ...(hanterarArenden
      ? (koArenden ?? [])
          .filter((a) => slaLage(a) === "over" || slaLage(a) === "snart")
          .map((a) => ({
            nyckel: `arende-${a.id}`,
            omrade: "arenden" as const,
            href: "/arenden",
            /**
             * ARENDETS RUBRIK STAR INTE HAR, och det ar inte for att kolumnen
             * saknades i fragan — den lades medvetet inte till.
             *
             * Ett personalarende heter "Konflikt med kollega" eller
             * "Lonesamtal". Ledningen far lasa det pa /arenden, dar man gatt in
             * med avsikt. Startsidan ar den yta som star oppen pa en delad
             * skarm nar nagon gar forbi, och en rubrik som hamnar dar har
             * lamnat sin krets utan att nagon valde det.
             *
             * Raden sager alltsa VAD som bradskar och HUR mycket, och lanken
             * leder dit rubriken hor hemma.
             */
            titel: "Personalärende väntar på svar",
            detalj: "Öppna ärenden för att se vilket",
            frist: slaLage(a) === "over" ? "Svarstiden passerad" : "Snart förfallet",
            ton: (slaLage(a) === "over" ? "danger" : "warn") as "danger" | "warn",
            sortering: slaLage(a) === "over" ? -0.5 : 1,
          }))
      : []),
  ]
    .sort((a, b) => a.sortering - b.sortering)
    .map(({ sortering: _sortering, ...rest }) => rest);

  const kokort = chef ? <Kokort poster={koposter} bradskande={bradskande} /> : null;

  /**
   * ===========================================================================
   * DAGENS LAGE. VEM SOM AR SJUK, LEDIG ELLER INTE INSTAMPLD — I DAG.
   *
   * Bestallt 2026-09-03: chefen ska se pa startsidan vilka som blir sena, vilka
   * som lagt in franvaro och vilka som ar sjuka.
   *
   * KORTET RITAS AVEN NAR DET AR TOMT, till skillnad fran arendekortet nedan.
   * Det ar ett medvetet undantag fran regeln om rutor man slutar lasa. "Alla ar
   * pa plats" ar ett SVAR pa chefens fraga, inte franvaron av ett svar — och
   * gomdes kortet nar listan var tom skulle en tom skarm betyda tva saker:
   * fulltalig personal, eller nagot som slutat fungera.
   *
   * RADEN "INTE INSTAMPLAD" AR INGEN ANKLAGELSE, och tonen ar vald efter det.
   * Den betyder att navet inte sett nagon instampling an — ingenting mer. Den
   * ar inte oregistrerad franvaro (`absence_reminder`), skriver ingen rad och
   * bar ingen konsekvens. Konsekvenstrappan gar sin egen vag genom nattjobbet,
   * dar den anstallda far ett dygn pa sig att registrera sin egen franvaro
   * innan chefen ser luckan (AC-3.19). Den vagen ror det har kortet inte.
   *
   * SJUKDOMEN STAR HAR FOR ATT DEN REDAN STAR PA /franvaro/sjuk for exakt samma
   * krets — RLS ar densamma i bada. Kortet flyttar ingen grans, det flyttar en
   * fraga chefen anda staller varje morgon till den sida hen anda oppnar.
   * Diagnoser finns inte i navet alls (K35), sa det finns ingenting att lacka
   * utover att nagon ar franvarande.
   * ===========================================================================
   */
  /**
   * ==========================================================================
   * DIN FRANVARO — den anstalldas eget kort (bestallarens val 2026-09-07).
   *
   * Startsidan har sedan 2026-09-03 svarat pa chefens franvarofraga och inte pa
   * den anstalldas. Foljden var att den som skickat en ansokan pa fredagen fick
   * oppna /franvaro och leta for att se om nagon svarat.
   *
   * KORTET DOLJS NAR DET INTE HAR NAGOT ATT SAGA, till skillnad fran dagsbilden
   * ovan. Skalet ar detsamma som for arendekortet: "ingen ledighet inbokad" ar
   * inte ett svar pa en fraga nagon staller, det ar en ruta man slutar lasa.
   * Saldot ensamt racker inte som skal att rita det — det andras nagra ganger
   * om aret och hor hemma pa /franvaro.
   *
   * SJUKRADEN STAR OVERST och inte i datumordning. Ar man sjukanmald just nu ar
   * det det enda pa kortet som galler i dag.
   * ==========================================================================
   */
  const minaFranvarorader = (minaAnsokningar ?? []) as unknown as {
    id: string;
    type_id: string;
    starts_on: string;
    ends_on: string;
    part_day_minutes: number | null;
    status: string;
    absence_type: { label: string } | null;
  }[];

  const minSjukrad = ((minSjuk ?? []) as { id: string; first_sick_day: string; extent_percent: number; confirmed_at: string | null }[])[0] ?? null;

  const minaSaldorader: Saldo[] = ((minaSaldon ?? []) as unknown as {
    type_id: string;
    days: string | number;
    as_of: string;
    earned_year: number | null;
    absence_type: { label: string } | null;
  }[]).map((x) => ({ type_id: x.type_id, days: Number(x.days), as_of: x.as_of, earned_year: x.earned_year }));

  const saldoetikett = new Map(
    ((minaSaldon ?? []) as unknown as { type_id: string; absence_type: { label: string } | null }[]).map(
      (x) => [x.type_id, x.absence_type?.label ?? x.type_id] as const,
    ),
  );
  const minaSaldotyper = [...new Set(minaSaldorader.map((x) => x.type_id))];

  const harEgenFranvaro = minSjukrad !== null || minaFranvarorader.length > 0;

  const minFranvarokort = harEgenFranvaro ? (
    <Card>
      <CardHeader
        titel="Din frånvaro"
        beskrivning="Det du väntar svar på och det som är inbokat framåt."
        handling={
          <ButtonLink href="/franvaro" size="sm" variant="diskret">
            Öppna
          </ButtonLink>
        }
      />

      {minSjukrad && (
        <div className="mb-3">
          <Notis ton="info">
            Du är sjukanmäld — {periodtextOppen(minSjukrad.first_sick_day, null).toLowerCase()},
            sjukdag {sjukdag(minSjukrad.first_sick_day, idagSvenskt)}
            {minSjukrad.extent_percent < 100 ? `, ${minSjukrad.extent_percent} procent` : ""}.{" "}
            {minSjukrad.confirmed_at
              ? "Din chef har bekräftat anmälan."
              : "Väntar på att din chef bekräftar."}{" "}
            <Link href="/franvaro/sjuk" className="font-semibold underline">
              Anmäl dig frisk
            </Link>
          </Notis>
        </div>
      )}

      {minaFranvarorader.length > 0 && (
        <ul className="flex flex-col">
          {minaFranvarorader.map((a) => {
            const status = a.status as Ansokningsstatus;
            return (
              <Uppgift
                key={`min-franvaro-${a.id}`}
                href={`/franvaro/${a.id}`}
                titel={a.absence_type?.label ?? a.type_id}
                detalj={`${periodtext(a.starts_on, a.ends_on)} · ${omfattning(a)} · ${startlage(a.starts_on, idagSvenskt).text}`}
                markering={<Badge ton={STATUS_TON[status]}>{STATUS_ETIKETT[status]}</Badge>}
              />
            );
          })}
        </ul>
      )}

      {minaSaldotyper.length > 0 && (
        <dl className="mt-4 flex flex-col gap-2 border-t border-canvas pt-4">
          {minaSaldotyper.map((typId) => {
            const s = saldoFor(minaSaldorader, typId);
            if (!s) return null;
            return (
              <div key={`saldo-${typId}`} className="flex items-baseline justify-between gap-4">
                <dt className="text-small text-ink-500">{saldoetikett.get(typId) ?? typId}</dt>
                <dd className="tnum text-body text-ink-900">{s.days} dagar</dd>
              </div>
            );
          })}
        </dl>
      )}
    </Card>
  ) : null;

  /**
   * Chefens framatblick, som en rad under dagsbilden.
   *
   * Bara antalet och de tre narmaste namnen. Hela listan finns pa
   * /franvaro/attest, och ett kort som forsoker vara bade dagsbild och
   * tvaveckorsvy blir svarlast pa 375 px — dar allt ligger i en spalt.
   */
  /**
   * Dagsbilden formas om till det kortet behover och inget mer.
   *
   * `Dagslagekort` ar en klientkomponent: allt som skickas dit serialiseras och
   * hamnar i sidans nyttolast. Darfor fardiga meningar och inga `Map` eller
   * `Date` — de hade antingen fallit i serialiseringen eller foljt med
   * webblasaren utan att behovas dar.
   *
   * NYCKELN maste vara stabil och unik. En person kan ha bade en sjukrad och en
   * ledigrad i samma fonster, sa `employee_id` ensamt racker inte.
   */
  const dagslagekort =
    dagsbild !== null ? (
      <Dagslagekort
        vy={{
          idag: dagsbild.rader.map((r) => ({
            nyckel: `idag-${r.employee_id}-${r.lage}`,
            namn: r.namn,
            lage: r.lage,
            etikett: r.etikett,
            ton: r.ton,
            detalj: r.detalj,
            href: r.href,
          })),
          framat: Object.fromEntries(
            FONSTER.map((d) => [
              d,
              (framat?.per[d] ?? []).map((r, i) => ({
                nyckel: `f${d}-${r.employee_id}-${r.lage}-${i}`,
                namn: r.namn,
                lage: r.lage as Lagesrad["lage"],
                etikett: r.etikett,
                ton: r.ton as Lagesrad["ton"],
                detalj: r.detalj,
                href: r.href,
              })),
            ]),
          ),
          fonster: [...FONSTER],
          senRaknad: dagsbild.senRaknad,
          datum: `${VECKODAG[veckodag] ?? ""} ${idagSvenskt}`.trim(),
          attBesluta: attBesluta.length,
        }}
      />
    ) : null;

  /**
   * ARENDEKORTET SYNS BARA NAR DET HAR NAGOT ATT SAGA.
   *
   * Bestallarens val 2026-08-23. Ett kort som varje dag sager "inga arenden"
   * ar en ruta man slutar lasa, och nar den en dag sager nagot annat har ogat
   * redan lart sig att hoppa over den. Vagen till ett nytt arende ligger i
   * snabbvalen ovan och forsvinner alltsa aldrig.
   */
  const egnaArenden = obesvarade.length;
  const oppnaIKon = hanterarArenden ? (koArenden ?? []).length : 0;

  // Kortet upprepar INTE "over tiden" och "snart forfallna". De star redan i
  // kon ovan, och en siffra som star pa tva stallen pa samma skarm blir en
  // siffra man borjar jamfora i stallet for att agera pa.
  const arendekort =
    egnaArenden + oppnaIKon > 0 ? (
      <Card>
        <CardHeader titel="Ärenden" />
        <dl className="flex flex-col gap-3">
          {egnaArenden > 0 && <Rad etikett="Väntar på ditt svar" varde={egnaArenden} />}
          {oppnaIKon > 0 && <Rad etikett="Öppna i kön" varde={oppnaIKon} />}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink href="/arenden" size="sm">
            Öppna ärenden
          </ButtonLink>
          <ButtonLink href="/arenden/nytt" size="sm" variant="diskret">
            Nytt ärende
          </ButtonLink>
        </div>
      </Card>
    ) : null;

  /**
   * PROVISIONSKORTET.
   *
   * Visar INTJANAT, aldrig utbetalt och aldrig berakat — navet raknar ingen
   * provision, se `src/lib/provision.ts`. Kortet doljs helt tills den forsta
   * posten bokforts: en ruta med "0 kr" varje dag ar inte information, det ar
   * en paminnelse om att modulen inte anvands an.
   */
  const provisionskort = harProvision ? (
    <Card>
      <CardHeader titel="Din provision" beskrivning={manadsnamn(provision.denna.manad)} />
      <p className="tnum text-display text-ink-900">{kronor(provision.denna.belopp)}</p>
      <dl className="mt-4 flex flex-col gap-3">
        {provision.denna.affarer !== null && (
          <Rad etikett="Affärer" varde={provision.denna.affarer} />
        )}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-small text-ink-500">Förra månaden</dt>
          <dd className="tnum text-body text-ink-900">{kronor(provision.forra.belopp)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-small text-ink-500">Hittills i år</dt>
          <dd className="tnum text-body text-ink-900">{kronor(provision.iAr)}</dd>
        </div>
      </dl>
      <div className="mt-5">
        <ButtonLink href="/provision" size="sm">
          Se posterna
        </ButtonLink>
      </div>
    </Card>
  ) : null;

  const personalkort = serPersonal ? (
    <Card>
      <CardHeader titel="Personalen" />
      <dl className="flex flex-col gap-3">
        <Rad etikett="Aktiva" varde={antalAktiva ?? 0} />
        <Rad etikett="Under onboarding" varde={antalOnboarding ?? 0} />
      </dl>
      <div className="mt-5">
        <ButtonLink href="/personal" size="sm">
          Öppna personalregistret
        </ButtonLink>
      </div>
    </Card>
  ) : null;

  /**
   * DINA UPPGIFTER — kortet som gor att listan inte behover oppnas for att
   * man ska veta att den har nagot att saga.
   *
   * Bestallarens beslut 2026-09-11 var att uppgifterna ska mota en pa
   * startsidan. Stamplingen ligger kvar overst: den ar dagens forsta handling
   * och far inte flytta pa sig for nagot.
   *
   * Kortet ar en SAMMANFATTNING och inte en andra uppgiftslista. Ingen bock,
   * inga knappar, fem rader. Skalet ar att tva stallen som gor samma sak
   * borjar svara olika — och det stalle som far ratt ska vara modulens eget.
   */
  const uppgiftsbild = await hamtaUppgiftsbild(user);
  const minaUppgifterIdag = minaIdag(uppgiftsbild, user.employee.id);
  const uppgiftskort =
    uppgiftsbild.uppgifter.length === 0 ? null : (
      <Uppgiftskort
        idag={uppgiftsbild.idag}
        rader={minaUppgifterIdag.slice(0, 5).map((u) => ({
          id: u.id,
          title: u.title,
          due_date: u.due_date,
          due_time: u.due_time,
          forsenad: forsenad(u, uppgiftsbild.idag),
        }))}
        antalIdag={minaUppgifterIdag.length}
        antalOppna={minaOppna(uppgiftsbild, user.employee.id).length}
        antalVantar={vantarPaAndra(uppgiftsbild, user.employee.id).length}
        antalGranska={attGranska(uppgiftsbild, user.employee.id).length}
      />
    );

  const roller = user.roles.length
    ? user.roles.map((r) => ROLE_LABEL[r]).join(" · ")
    : "Din roll är inte satt än.";

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Overst, over halsningen: raden betyder att navet varit tyst trasigt
          sedan i natt, och den ska inte behova letas efter. */}
      {driftrad}

      {/* Omslaget bar ankaret. `Statusband` och `Card` tar inte emot
          godtyckliga attribut, och att oppna dem for det vore att bjuda in
          data-guide pa stallen dar ingen guide vet om att den star. */}
      <div data-guide="hem.statusband">
        <Statusband
          fornamn={user.employee.first_name}
          undertext={`${roller} · ${STATUS_LABEL[user.employee.status] ?? user.employee.status}`}
          lage={stamplingslage?.lage ?? null}
          minuterVidRendering={stamplingslage?.minuter ?? 0}
          serverTid={nu.toISOString()}
          sedan={stamplingslage?.sedan ?? null}
        />
      </div>

      <div data-guide="hem.dagskort">{dagskort}</div>

      {/* Ordningen ar hela poangen med E5.4, och den maste halla aven pa
          375 px dar allt ligger i en enda spalt. Darfor byter korten plats i
          traden i stallet for med CSS. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Uppgifterna forst i spalten, direkt under stamplingen. Det ar
              enda kortet som svarar pa "vad skulle jag gora idag", och den
              fragan staller man sig innan chefens koer. */}
          {uppgiftskort}
          {kokort}
          {/* Efter kon och fore "Att gora". Kon ar det som vantar pa ett
              BESLUT av chefen; dagsbilden ar det hen behover veta for att
              bemanna dagen, och den fragan ar farsk bara pa morgonen. Bada
              ligger over den egna att-gora-listan, av samma skal som §12 Q9
              lagger chefens koer forst. */}
          {dagslagekort}
          {attGora}
        </div>
        <div className="flex flex-col gap-4">
          {/* Egen franvaro over arendekortet: "har chefen svarat pa min
              ansokan" ar en fraga med ett datum i sig, och den blir inaktuell
              om man laser den for sent. */}
          {minFranvarokort}
          {arendekort}
          {provisionskort}
          {personalkort}
        </div>
      </div>
    </div>
  );
}

function Uppgift({
  href,
  titel,
  detalj,
  markering,
}: {
  href: string;
  titel: string;
  detalj: string;
  markering: ReactNode;
}) {
  return (
    <li className="border-b border-canvas last:border-0">
      <Link
        href={href}
        className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
      >
        <span className="flex-1">
          <span className="block text-body text-ink-900 group-hover:text-brand-700">{titel}</span>
          <span className="block text-small text-ink-500">{detalj}</span>
        </span>
        {markering}
        <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
      </Link>
    </li>
  );
}

/**
 * Veckodagens namn. `svenskVeckodag()` ger ett TAL (1 = mandag, 7 = sondag) —
 * det ar vad `work_schedule.weekday` lagras som, och talet ska inte bli en
 * strang i biblioteket bara for att ett kort vill skriva ut det.
 */
const VECKODAG: Record<number, string> = {
  1: "Måndag",
  2: "Tisdag",
  3: "Onsdag",
  4: "Torsdag",
  5: "Fredag",
  6: "Lördag",
  7: "Söndag",
};

/**
 * Uppgiftskortet.
 *
 * TRE TAL OCH FEM RADER. Talen svarar pa "har jag nagot att gora", raderna pa
 * "vad da". Det som inte far plats ligger i modulen, och knappen dit star i
 * kortets huvud och inte langst ned — den som redan sett att det finns fjorton
 * uppgifter ska inte behova skrolla forbi fem for att komma at dem.
 */
function Uppgiftskort({
  idag,
  rader,
  antalIdag,
  antalOppna,
  antalVantar,
  antalGranska,
}: {
  idag: string;
  rader: { id: string; title: string; due_date: string | null; due_time: string | null; forsenad: boolean }[];
  antalIdag: number;
  antalOppna: number;
  antalVantar: number;
  antalGranska: number;
}) {
  const forsenade = rader.filter((r) => r.forsenad).length;

  return (
    <Card status={forsenade > 0 ? "danger" : undefined}>
      <CardHeader
        titel="Dina uppgifter"
        beskrivning={
          antalIdag === 0
            ? antalOppna === 0
              ? "Ingenting öppet."
              : `Inget med dagens datum. ${antalOppna} öppna totalt.`
            : `${antalIdag} idag${forsenade > 0 ? `, varav ${forsenade} försenade` : ""}.`
        }
        handling={
          <ButtonLink href="/uppgifter" variant="sekundar" size="sm">
            Öppna
          </ButtonLink>
        }
      />

      {rader.length === 0 ? (
        <EmptyState
          rubrik="Inget planerat idag"
          text="Skriv ner nästa sak du inte vill glömma, så står den här i morgon bitti."
          handling={
            <ButtonLink href="/uppgifter" size="sm">
              Lägg upp en uppgift
            </ButtonLink>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {rader.map((r) => (
            <Uppgift
              key={r.id}
              href={`/uppgifter/${r.id}`}
              titel={r.title}
              detalj={[fristtext(r.due_date, idag), r.due_time].filter(Boolean).join(" ")}
              markering={r.forsenad ? <Badge ton="danger">Försenad</Badge> : null}
            />
          ))}
        </ul>
      )}

      {(antalVantar > 0 || antalGranska > 0) && (
        <div className="mt-4 flex flex-wrap gap-4 border-t border-canvas pt-4">
          {antalVantar > 0 && (
            <Link href="/uppgifter" className="text-small text-ink-500 hover:text-brand-700">
              <span className="tnum font-semibold text-ink-900">{antalVantar}</span> väntar på andra
            </Link>
          )}
          {antalGranska > 0 && (
            <Link href="/uppgifter" className="text-small text-ink-500 hover:text-brand-700">
              <span className="tnum font-semibold text-ink-900">{antalGranska}</span> väntar på ditt godkännande
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="tnum text-h1 text-ink-900">{varde}</dd>
    </div>
  );
}

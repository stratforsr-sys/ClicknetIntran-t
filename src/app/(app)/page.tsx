import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/roles";
import { granskningslage } from "@/lib/dokument";
import { kursLage, LAGE_ETIKETT, LAGE_TON } from "@/lib/utbildning";
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
    supabase
      .from("absence_request")
      .select("id, employee_id, starts_on, rules_broken")
      .eq("status", "submitted"),
    supabase
      .from("sick_report")
      .select("id, employee_id")
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
        beskrivning="Kvittenser, kurser och ärenden som väntar på dig."
      />
      {okvitterade.length === 0 &&
      forfallna.length === 0 &&
      kursUppgifter.length === 0 &&
      obesvarade.length === 0 ? (
        <EmptyState
          rubrik="Ingenting väntar på dig"
          text="Här samlas rutiner du inte kvitterat, kurser som pågår och ärenden med svar."
        />
      ) : (
        <ul className="flex flex-col">
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

  const koposter: { href: string; text: string; detalj: string; ton: "danger" | "warn" | "neutral" }[] = [];
  if (hanterarArenden && overTiden > 0)
    koposter.push({
      href: "/arenden",
      text: `${overTiden} ärende${overTiden === 1 ? "" : "n"} över tiden`,
      detalj: "Svarstiden har passerat",
      ton: "danger",
    });
  if (hanterarArenden && snart > 0)
    koposter.push({
      href: "/arenden",
      text: `${snart} snart förfallna`,
      detalj: "Sista fjärdedelen av fristen",
      ton: "warn",
    });
  if (attesterar && (attKvittera ?? 0) > 0)
    koposter.push({
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
      href: "/franvaro/sjuk",
      text: `${attBekrafta.length} ${attBekrafta.length === 1 ? "sjukanmälan" : "sjukanmälningar"} att bekräfta`,
      detalj: "Bekräfta att du sett den",
      ton: "danger",
    });

  if (attBesluta.length > 0)
    koposter.push({
      href: "/franvaro/attest",
      text: `${attBesluta.length} ${attBesluta.length === 1 ? "ledighetsansökan" : "ledighetsansökningar"} att besluta`,
      detalj: attBesluta.some((a) => ((a.rules_broken ?? []) as string[]).length > 0)
        ? "Minst en bryter mot en regel"
        : "Alla följer reglerna",
      ton: "warn",
    });

  if (attBedoma.length > 0)
    koposter.push({
      href: "/utbildning/rollspel",
      text: `${attBedoma.length} rollspel att bedöma`,
      detalj: "Lyssna först — öppningen loggas och syns för säljaren",
      ton: "warn",
    });

  if (serAvvikelser && sparr.stampling)
    koposter.push({
      href: "/tid/avvikelser",
      text: "Rastavvikelser",
      detalj: "Din öppning av vyn loggas",
      ton: "neutral",
    });

  const kokort = chef ? (
    <Card>
      <CardHeader titel="Din kö" beskrivning="Det som väntar på ditt beslut." />
      {koposter.length === 0 ? (
        <EmptyState rubrik="Kön är tom" text="Inget ärende och ingen rättelse väntar på dig." />
      ) : (
        <ul className="flex flex-col">
          {koposter.map((p) => (
            <Uppgift
              key={p.href + p.text}
              href={p.href}
              titel={p.text}
              detalj={p.detalj}
              markering={p.ton === "neutral" ? null : <Badge ton={p.ton}>Öppna</Badge>}
            />
          ))}
        </ul>
      )}
    </Card>
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
          {kokort}
          {attGora}
        </div>
        <div className="flex flex-col gap-4">
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

function Rad({ etikett, varde }: { etikett: string; varde: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="tnum text-h1 text-ink-900">{varde}</dd>
    </div>
  );
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { epostArKonfigurerad, skickaKo, type Brev } from "@/lib/epost";
import { svensktDatum } from "@/lib/klocka";
import { lageAv, arStangd, fristtext, type Handelsetyp, type Lage } from "@/lib/uppgifter";
import { kursLage } from "@/lib/utbildning";

/**
 * Morgonbrevet: dagens plan, en gång per arbetsdag.
 *
 * ===========================================================================
 * VARFÖR ETT MEJL FINNS ÖVER HUVUD TAGET, NÄR KLOCKAN REDAN SÄGER TILL
 *
 * Notisklockan säger till DEN SOM ÖPPNAR NAVET. Det är precis fel krets för en
 * påminnelse: den som har uppgifterna i huvudet öppnar navet ändå, och den som
 * glömt bort dem gör det inte. En lista över det man inte får glömma, som bara
 * syns för den som kommit ihåg att titta, löser ingenting.
 *
 * VARFÖR DET INTE ÄR EN PUSH PÅ KLOCKSLAG. Vercels Hobby-plan tar två
 * cron-poster per projekt och kör var och en EN gång per dygn — se rubriken i
 * `natt/route.ts` om vad som hände när tre poster deklarerades. Det som går att
 * skicka därifrån är ett brev på morgonen; det som behöver hända mitt på dagen
 * ligger i `jobb/dagtid.ts` och drivs av `pg_cron` i databasen i stället.
 *
 * ===========================================================================
 * ETT BREV PER PERSON, INTE ETT BREV PER SORTS PÅMINNELSE
 *
 * Det här är filens viktigaste val, och det blev viktigare 2026-09-14 när
 * brevet gick från en källa till sex.
 *
 * Sex jobb som var för sig skickar "du har en försenad uppgift", "du har en
 * ansökan att besluta om", "din utbildning är försenad" ger sex brev samma
 * morgon till samma person. Det är inte sex påminnelser — det är en person som
 * skapar en filterregel före lunch, och därefter är ALLA sex osynliga.
 *
 * Därför samlar varje `samla*`-funktion in i SAMMA `Samling`, och breven byggs
 * först när allt är insamlat. Lägger någon till en sjunde sorts påminnelse är
 * rätt sätt att göra det en ny `samla*` och en rad i `AVSNITT` — inte ett nytt
 * utskick.
 *
 * ===========================================================================
 * BREVET SKICKAS BARA NÄR DET HAR NÅGOT ATT SÄGA
 *
 * Ingen "du har 0 uppgifter idag". Ett återkommande brev som oftast är tomt är
 * ett brev man skapar en filterregel för, och då är även det femte brevet —
 * det som faktiskt betydde något — bortfiltrerat. Forskningen om notisträtthet
 * pekar entydigt åt samma håll, och det är billigare att lita på den än att
 * upptäcka det själv.
 *
 * HELGER HOPPAS ÖVER. En påminnelse om arbetsuppgifter en söndag morgon är
 * inte en tjänst.
 *
 * ===========================================================================
 * DE HÄR PÅMINNELSERNA ÄR TILLSTÅND, INTE HÄNDELSER
 *
 * Skillnaden mot `epost-notis.ts` är hela arbetsdelningen mellan filerna.
 *
 * En HÄNDELSE (order makulerad, ledighet inställd) mejlas i samma sekund den
 * sker, en gång, och sedan aldrig mer. Ett TILLSTÅND (ansökan väntar på ditt
 * beslut, utbildningen är försenad) står kvar tills någon gör något åt det —
 * och därför står det i brevet VARJE morgon tills det är åtgärdat.
 *
 * Upprepningen är poängen, inte en biverkning. Beställarens oro 2026-09-14 var
 * att chefen missar att godkänna en ledighetsansökan, och ett engångsbrev som
 * kommer när man har fullt upp löser inte det. Ett brev varje morgon tills den
 * är avgjord gör det.
 * ===========================================================================
 */

type Utfall = {
  mottagare: number;
  skickade: number;
  fel: string[];
  /** Sant när dagen inte är en arbetsdag och jobbet därför inte gjorde något. */
  helg: boolean;
  /** Antal rader per avsnitt över alla brev. Gör det synligt i kvittot vilken
   *  källa som faktiskt bidrog — ett avsnitt som alltid är noll är antingen
   *  onödigt eller trasigt, och de två går inte att skilja utan siffran. */
  avsnitt: Record<string, number>;
};

/**
 * Avsnitten, i den ordning de ska stå i brevet.
 *
 * Ordningen är inte alfabetisk utan efter HUR BRÅTTOM DET ÄR. Det försenade
 * först, dagens sedan, och det som väntar på ens bock därefter — en chef som
 * bara läser de tre första raderna ska ha fått det viktigaste.
 */
const AVSNITT = [
  "FÖRSENAT",
  "IDAG",
  "VÄNTAR PÅ DITT GODKÄNNANDE",
  "FRÅNVARO ATT BESLUTA OM",
  "COACHNING",
  "UTBILDNING",
  "RUTINER ATT GRANSKA",
] as const;

type Avsnitt = (typeof AVSNITT)[number];

/** employee_id → avsnitt → rader. */
type Samling = Map<string, Map<Avsnitt, string[]>>;

/** Lägger en rad i en persons avsnitt. Skapar facken när de behövs. */
type Lagg = (employeeId: string, avsnitt: Avsnitt, rad: string) => void;

function skapaLagg(samling: Samling): Lagg {
  return (employeeId, avsnitt, rad) => {
    if (!employeeId) return;
    let personens = samling.get(employeeId);
    if (!personens) {
      personens = new Map();
      samling.set(employeeId, personens);
    }
    personens.set(avsnitt, [...(personens.get(avsnitt) ?? []), rad]);
  };
}

/**
 * Hur nyligen en coachningsuppgift ska ha tilldelats för att räknas som "ny".
 *
 * Tre dygn, inte ett: tilldelas något på en fredag ska personen se det på
 * måndagen. Och inte trettio — en uppgift som stått en månad är inte ny, den
 * är försenad, och den fångas av det andra villkoret.
 */
const NYA_DYGN = 3;

export async function korMorgonjobbet(db: SupabaseClient, nu = new Date()): Promise<Utfall> {
  const idag = svensktDatum(nu);
  const tomt: Record<string, number> = {};

  // 1 = måndag … 7 = söndag. Räknat på det svenska datumet, inte på serverns.
  const veckodag = ((new Date(`${idag}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  if (veckodag >= 6) {
    return { mottagare: 0, skickade: 0, fel: [], helg: true, avsnitt: tomt };
  }

  if (!epostArKonfigurerad()) {
    return {
      mottagare: 0,
      skickade: 0,
      fel: ["E-post är inte konfigurerad"],
      helg: false,
      avsnitt: tomt,
    };
  }

  const samling: Samling = new Map();
  const lagg = skapaLagg(samling);

  /**
   * Läses med SERVICE ROLE, och det är riktigt just här.
   *
   * Jobbet har ingen inloggad användare att låna en token av — det körs av
   * Vercels cron. Urvalet görs i stället i koden: varje brev innehåller
   * uteslutande rader som mottagaren själv är adressat för, och breven byggs
   * per person. Ingen får se någon annans rader, och ingen får ett brev om
   * något hen inte redan ser i navet.
   *
   * VARJE SAMLARE FÅNGAR SITT EGET FEL. Att utbildningstabellen inte svarar får
   * inte betyda att ingen får veta om sina försenade uppgifter — det vore att
   * byta en tyst lucka mot en tyst morgon.
   */
  const fel: string[] = [];
  const samlare: [string, () => Promise<void>][] = [
    ["uppgifter", () => samlaUppgifter(db, idag, lagg)],
    ["frånvaro", () => samlaFranvaro(db, lagg)],
    ["coachning", () => samlaCoachning(db, idag, nu, lagg)],
    ["utbildning", () => samlaUtbildning(db, nu, lagg)],
    ["rutiner", () => samlaRutiner(db, idag, lagg)],
  ];

  for (const [namn, kor] of samlare) {
    try {
      await kor();
    } catch (e) {
      fel.push(`${namn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const harNagot = [...samling.entries()].filter(([, avsnitten]) =>
    [...avsnitten.values()].some((rader) => rader.length > 0),
  );

  const avsnittsraknare: Record<string, number> = {};
  for (const [, avsnitten] of harNagot) {
    for (const [namn, rader] of avsnitten) {
      avsnittsraknare[namn] = (avsnittsraknare[namn] ?? 0) + rader.length;
    }
  }

  if (harNagot.length === 0) {
    return { mottagare: 0, skickade: 0, fel, helg: false, avsnitt: avsnittsraknare };
  }

  const { data: personer } = await db
    .from("employee")
    .select("id, first_name, email, status")
    .in(
      "id",
      harNagot.map(([id]) => id),
    );

  const brevlada: Brev[] = [];

  for (const [id, avsnitten] of harNagot) {
    const person = (personer ?? []).find((p) => p.id === id) as
      | { id: string; first_name: string; email: string; status: string }
      | undefined;

    // En avslutad anställd får inga påminnelser. Samma spärr som iCal-flödet
    // drar i 0021, och av samma skäl: den ska inte kräva att offboardingkoden
    // kommer ihåg den här filen.
    if (!person?.email || person.status === "offboarded") continue;

    brevlada.push({
      till: person.email,
      amne: amne(avsnitten),
      text: brevtext(person.first_name, avsnitten),
    });
  }

  const utfall = await skickaKo(brevlada);

  return {
    mottagare: brevlada.length,
    skickade: utfall.filter((u) => u.utfall.skickat).length,
    fel: [
      ...fel,
      ...utfall
        .filter((u) => !u.utfall.skickat)
        .map((u) => `${String(u.brev.till)}: ${"orsak" in u.utfall ? u.utfall.orsak : "okänt"}`),
    ],
    helg: false,
    avsnitt: avsnittsraknare,
  };
}

// =============================================================================
// SAMLARNA
//
// En per sorts påminnelse. Var och en läser sitt eget, och ingen av dem vet om
// de andra — de möts först i `Samling`.
// =============================================================================

type Uppgiftsrad = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
  due_date: string | null;
  due_time: string | null;
};

/**
 * Uppgifterna: försenade, dagens, och det som väntar på ens bock.
 *
 * `uppgift-godkand` finns med flit inte här och inte i `epost-notis.ts`.
 * Beställarens besked 2026-09-14: ett godkännande är ett kvitto på något man
 * själv lämnat ifrån sig, och det behöver inte ett brev.
 */
async function samlaUppgifter(db: SupabaseClient, idag: string, lagg: Lagg): Promise<void> {
  const [{ data: uppgifter }, { data: handelser }, { data: medlemmar }] = await Promise.all([
    db
      .from("task")
      .select("id, title, assignee_id, created_by, due_date, due_time")
      .is("parent_id", null),
    db.from("task_event").select("task_id, type").order("at"),
    db.from("task_member").select("task_id, employee_id, role"),
  ]);

  const perUppgift = new Map<string, { type: Handelsetyp }[]>();
  for (const h of (handelser ?? []) as { task_id: string; type: Handelsetyp }[]) {
    const lista = perUppgift.get(h.task_id);
    if (lista) lista.push(h);
    else perUppgift.set(h.task_id, [h]);
  }

  const lagen = new Map<string, Lage>();
  for (const u of (uppgifter ?? []) as Uppgiftsrad[]) {
    lagen.set(u.id, lageAv(perUppgift.get(u.id) ?? []));
  }

  /**
   * Redigerarna per uppgift.
   *
   * 2026-09-23: brevet räknade fram till då bara på `assignee_id`, precis som
   * vyerna på /uppgifter gjorde — och en redigerare som fått en frist på sig
   * fick därmed varken lista eller brev. `mittAttGora()` i `lib/uppgifter.ts`
   * äger gränsen; den här kartan är samma fråga ställd på ett dataurval som
   * inte har `minRoll` på raden.
   *
   * VISAREN STÅR INTE MED. Ett brev om något man bara får titta på är precis
   * den sortens rad som får folk att sluta öppna morgonbrevet.
   */
  const redigerarePer = new Map<string, string[]>();
  for (const m of (medlemmar ?? []) as { task_id: string; employee_id: string; role: string }[]) {
    if (m.role !== "redigerare") continue;
    const lista = redigerarePer.get(m.task_id);
    if (lista) lista.push(m.employee_id);
    else redigerarePer.set(m.task_id, [m.employee_id]);
  }

  for (const u of (uppgifter ?? []) as Uppgiftsrad[]) {
    const lage = lagen.get(u.id) ?? "ej_paborjad";
    if (arStangd(lage)) continue;

    const nar = [fristtext(u.due_date, idag), u.due_time?.slice(0, 5)].filter(Boolean).join(" ");
    const rad = `${u.title}${nar ? ` (${nar})` : ""}`;

    if (u.due_date) {
      const avsnitt = u.due_date < idag ? "FÖRSENAT" : u.due_date === idag ? "IDAG" : null;
      if (avsnitt) {
        if (u.assignee_id) lagg(u.assignee_id, avsnitt, rad);
        for (const e of redigerarePer.get(u.id) ?? []) {
          if (e !== u.assignee_id) lagg(e, avsnitt, rad);
        }
      }
    }

    // Det som väntar på någons bock. Först till kvarn — alla granskare får
    // raden, och den som hinner först stänger den för de andra.
    if (lage === "granskas") {
      for (const m of (medlemmar ?? []) as {
        task_id: string;
        employee_id: string;
        role: string;
      }[]) {
        if (m.task_id === u.id && m.role === "granskare") {
          lagg(m.employee_id, "VÄNTAR PÅ DITT GODKÄNNANDE", u.title);
        }
      }
    }
  }
}

/**
 * Ledighets- och sjukansökningar som väntar på ett beslut.
 *
 * ===========================================================================
 * GÅR TILL CHEFEN, OCH TILL BÅDA SORTERS CHEF
 *
 * `manager_id` och teamets `lead_id` är två olika vägar att vara någons chef,
 * och 0001 släpper fram raden för båda (`leads_employee()`). Skickas brevet
 * bara till den ena kan en ansökan bli liggande därför att just den personen är
 * ledig — vilket är precis det beställaren ville undvika.
 *
 * UPPSLAGNINGEN GÖRS EN GÅNG FÖR ALLA, inte en gång per ansökan. `cheferFor()`
 * i `notishandelse-server.ts` gör två frågor per person, och det är rätt när en
 * server action ska nå EN persons chefer. Här är det fel: tjugo ansökningar
 * hade blivit fyrtio frågor för att besvara något två frågor räcker till.
 * ===========================================================================
 */
async function samlaFranvaro(db: SupabaseClient, lagg: Lagg): Promise<void> {
  const { data: ansokningar } = await db
    .from("absence_request")
    .select("id, employee_id, type_id, starts_on, ends_on, submitted_at")
    .eq("status", "submitted");

  if (!ansokningar?.length) return;

  const [{ data: personal }, { data: team }, { data: typer }] = await Promise.all([
    db.from("employee").select("id, first_name, last_name, manager_id, team_id"),
    db.from("team").select("id, lead_id"),
    db.from("absence_type").select("id, label"),
  ]);

  const personPerId = new Map(
    ((personal ?? []) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      manager_id: string | null;
      team_id: string | null;
    }[]).map((p) => [p.id, p]),
  );
  const ledPerTeam = new Map(
    ((team ?? []) as { id: string; lead_id: string | null }[]).map((t) => [t.id, t.lead_id]),
  );
  const typPerId = new Map(
    ((typer ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]),
  );

  for (const a of (ansokningar ?? []) as {
    id: string;
    employee_id: string;
    type_id: string;
    starts_on: string;
    ends_on: string;
  }[]) {
    const sokande = personPerId.get(a.employee_id);
    if (!sokande) continue;

    const chefer = new Set<string>();
    if (sokande.manager_id) chefer.add(sokande.manager_id);
    if (sokande.team_id) {
      const lead = ledPerTeam.get(sokande.team_id);
      if (lead) chefer.add(lead);
    }
    // Ingen beslutar om sin egen ansökan.
    chefer.delete(a.employee_id);

    const namn = [sokande.first_name, sokande.last_name].filter(Boolean).join(" ") || "En medarbetare";
    const typ = typPerId.get(a.type_id) ?? "Frånvaro";
    const period = a.starts_on === a.ends_on ? a.starts_on : `${a.starts_on}–${a.ends_on}`;

    for (const chef of chefer) {
      lagg(chef, "FRÅNVARO ATT BESLUTA OM", `${namn} · ${typ} · ${period}`);
    }
  }
}

/**
 * Coachningsuppgifter: nyss tilldelade, och de som passerat fristen.
 *
 * En uppgift är STÄNGD när den kvitterats eller avbrutits — samma två
 * händelsetyper som spärren i 0043 vaktar. Allt annat är öppet, inklusive
 * `underkand`: en underkänd uppgift ska göras om, inte glömmas.
 */
async function samlaCoachning(
  db: SupabaseClient,
  idag: string,
  nu: Date,
  lagg: Lagg,
): Promise<void> {
  const [{ data: uppgifter }, { data: handelser }] = await Promise.all([
    db
      .from("coaching_task")
      .select("id, title, assignee_id, due_date, created_at, cancelled_at")
      .is("cancelled_at", null),
    db.from("coaching_task_event").select("task_id, type, at"),
  ]);

  const perUppgift = new Map<string, Set<string>>();
  for (const h of (handelser ?? []) as { task_id: string; type: string }[]) {
    const fanns = perUppgift.get(h.task_id);
    if (fanns) fanns.add(h.type);
    else perUppgift.set(h.task_id, new Set([h.type]));
  }

  const nyGrans = new Date(nu.getTime() - NYA_DYGN * 86_400_000).toISOString();

  for (const u of (uppgifter ?? []) as {
    id: string;
    title: string;
    assignee_id: string | null;
    due_date: string | null;
    created_at: string;
  }[]) {
    if (!u.assignee_id) continue;

    const typer = perUppgift.get(u.id) ?? new Set<string>();
    if (typer.has("kvitterad") || typer.has("avbruten")) continue;

    // Förbi fristen väger tyngre än ny, och en uppgift ska bara ge EN rad.
    if (u.due_date && u.due_date < idag) {
      lagg(u.assignee_id, "COACHNING", `Förbi fristen: ${u.title} (${fristtext(u.due_date, idag)})`);
      continue;
    }

    const paborjad = typer.has("paborjad") || typer.has("inlamnad") || typer.has("underkand");
    if (!paborjad && u.created_at >= nyGrans) {
      lagg(u.assignee_id, "COACHNING", `Ny uppgift: ${u.title}`);
    }
  }
}

/**
 * Utbildningar som är tilldelade men inte gjorda, och de som är försenade.
 *
 * ===========================================================================
 * LÄGET RÄKNAS AV `kursLage()` OCH INTE AV EN EGEN REGEL HÄR
 *
 * Fristen går från den ANSTÄLLDAS startdatum plus kursens `due_days` — inte
 * från när kursen publicerades. Det är lätt att gissa fel på, och en egen
 * uträkning här hade gett ett brev som säger "försenad" om en kurs navet visar
 * som i tid. Samma funktion, samma svar.
 *
 * MÅLGRUPPEN PRÖVAS I KODEN, för jobbet läser med service role och har ingen
 * RLS som gör det. Regeln är `matches_audience()` i databasen: tom lista
 * betyder alla, annars måste personen ha en av rollerna. Certifikat som gått ut
 * står utanför — beställarens besked 2026-09-14 var att certifikat inte mejlas.
 * ===========================================================================
 */
async function samlaUtbildning(db: SupabaseClient, nu: Date, lagg: Lagg): Promise<void> {
  const [{ data: kurser }, { data: moduler }, { data: personal }, { data: roller }] =
    await Promise.all([
      db
        .from("course")
        .select("id, slug, title, due_days, audience_roles")
        .eq("status", "published"),
      db.from("course_module").select("id, course_id"),
      db.from("employee").select("id, start_date, status").neq("status", "offboarded"),
      db.from("employee_role").select("employee_id, role"),
    ]);

  if (!kurser?.length) return;

  const [{ data: forsok }, { data: certifikat }] = await Promise.all([
    db.from("course_attempt").select("employee_id, module_id, passed").eq("passed", true),
    // Tabellen heter `certification`, inte `certificate`. Supabase-klienten är
    // otypad mot schemat här, så ett felstavat tabellnamn hade inte fallit i
    // bygget — det hade gett ett tomt svar, och alla hade sett ut att sakna
    // certifikat. Alltså: försenade brev till folk som redan var klara.
    db.from("certification").select("employee_id, course_id, issued_at, expires_at"),
  ]);

  const modulerPerKurs = new Map<string, string[]>();
  for (const m of (moduler ?? []) as { id: string; course_id: string }[]) {
    modulerPerKurs.set(m.course_id, [...(modulerPerKurs.get(m.course_id) ?? []), m.id]);
  }

  const rollerPerPerson = new Map<string, Set<string>>();
  for (const r of (roller ?? []) as { employee_id: string; role: string }[]) {
    const fanns = rollerPerPerson.get(r.employee_id);
    if (fanns) fanns.add(r.role);
    else rollerPerPerson.set(r.employee_id, new Set([r.role]));
  }

  const klaraModuler = new Map<string, Set<string>>();
  for (const f of (forsok ?? []) as { employee_id: string; module_id: string }[]) {
    const fanns = klaraModuler.get(f.employee_id);
    if (fanns) fanns.add(f.module_id);
    else klaraModuler.set(f.employee_id, new Set([f.module_id]));
  }

  const certPerPersonKurs = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of (certifikat ?? []) as {
    employee_id: string;
    course_id: string;
    issued_at: string;
    expires_at: string | null;
  }[]) {
    const nyckel = `${c.employee_id}:${c.course_id}`;
    if (!certPerPersonKurs.has(nyckel)) certPerPersonKurs.set(nyckel, c);
  }

  for (const p of (personal ?? []) as { id: string; start_date: string | null }[]) {
    const minaRoller = rollerPerPerson.get(p.id) ?? new Set<string>();
    const mina = klaraModuler.get(p.id) ?? new Set<string>();

    for (const k of (kurser ?? []) as {
      id: string;
      title: string;
      due_days: number | null;
      audience_roles: string[] | null;
    }[]) {
      // `matches_audience()`: tom eller null lista betyder alla.
      const malgrupp = k.audience_roles ?? [];
      if (malgrupp.length > 0 && !malgrupp.some((r) => minaRoller.has(r))) continue;

      const ids = modulerPerKurs.get(k.id) ?? [];
      if (ids.length === 0) continue;

      const lage = kursLage({
        certifikat: certPerPersonKurs.get(`${p.id}:${k.id}`) ?? null,
        klaraModuler: ids.filter((id) => mina.has(id)).length,
        antalModuler: ids.length,
        startDatum: p.start_date,
        fristDagar: k.due_days,
        nu,
      });

      if (lage === "forsenad") lagg(p.id, "UTBILDNING", `Försenad: ${k.title}`);
      else if (lage === "ej_paborjad") lagg(p.id, "UTBILDNING", `Ej påbörjad: ${k.title}`);
    }
  }
}

/**
 * Rutiner vars granskningsdatum passerat. Gäller dokumentets ÄGARE och ingen
 * annan — samma krets som den härledda `rutin-granskning` i klockan.
 */
async function samlaRutiner(db: SupabaseClient, idag: string, lagg: Lagg): Promise<void> {
  const { data: dokument } = await db
    .from("document")
    .select("id, title, slug, owner_id, review_due")
    .eq("status", "published")
    .not("owner_id", "is", null)
    .not("review_due", "is", null)
    .lte("review_due", idag);

  for (const d of (dokument ?? []) as {
    title: string;
    owner_id: string;
    review_due: string;
  }[]) {
    lagg(d.owner_id, "RUTINER ATT GRANSKA", `${d.title} (${fristtext(d.review_due, idag)})`);
  }
}

// =============================================================================
// BREVET
// =============================================================================

/**
 * Ämnesraden säger vad som väntar, inte att brevet finns.
 *
 * "Dagens uppgifter" är sant om varenda brev och skiljer därför inte den dag
 * något brinner från den dag ingenting gör det. Den som ser "3 försenade" i
 * inkorgen har fått veta det utan att öppna brevet — vilket är hela poängen
 * med en påminnelse.
 *
 * TVÅ DELAR RÄCKER I ÄMNESRADEN. Sex avsnitt hade gett en rad som klipps mitt
 * i av varje mejlklient, och det som klipps bort är alltid slutet — alltså det
 * som stod sist och därför var minst brådskande ändå. Resten står i brevet.
 */
function amne(avsnitten: Map<Avsnitt, string[]>): string {
  const delar: string[] = [];

  for (const namn of AVSNITT) {
    const antal = avsnitten.get(namn)?.length ?? 0;
    if (antal > 0) delar.push(`${antal} ${ETIKETT[namn]}`);
  }

  const visade = delar.slice(0, 2);
  const kvar = delar.length - visade.length;

  return `Clicknet Nav: ${visade.join(", ")}${kvar > 0 ? ` +${kvar} till` : ""}`;
}

/** Kort form av avsnittsnamnet, för ämnesraden. */
const ETIKETT: Record<Avsnitt, string> = {
  FÖRSENAT: "försenade",
  IDAG: "idag",
  "VÄNTAR PÅ DITT GODKÄNNANDE": "att godkänna",
  "FRÅNVARO ATT BESLUTA OM": "frånvaro att besluta",
  COACHNING: "coachning",
  UTBILDNING: "utbildning",
  "RUTINER ATT GRANSKA": "att granska",
};

/** Vart varje avsnitt leder. Ett brev utan väg in i navet är en återvändsgränd. */
const LANK: Record<Avsnitt, string> = {
  FÖRSENAT: "/uppgifter",
  IDAG: "/uppgifter",
  "VÄNTAR PÅ DITT GODKÄNNANDE": "/uppgifter",
  "FRÅNVARO ATT BESLUTA OM": "/franvaro/attest",
  COACHNING: "/coachning",
  UTBILDNING: "/utbildning",
  "RUTINER ATT GRANSKA": "/rutiner",
};

function navadress(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://clicknet-nav.vercel.app").replace(
    /\/+$/,
    "",
  );
}

function brevtext(fornamn: string, avsnitten: Map<Avsnitt, string[]>): string {
  const rader: string[] = [`Hej ${fornamn},`, ""];
  const lankar = new Set<string>();

  for (const namn of AVSNITT) {
    const poster = avsnitten.get(namn) ?? [];
    if (poster.length === 0) continue;

    rader.push(namn);
    for (const p of poster) rader.push(`  - ${p}`);
    rader.push("");
    lankar.add(LANK[namn]);
  }

  const bas = navadress();
  for (const l of lankar) rader.push(`${bas}${l}`);

  rader.push("");
  rader.push("Det här brevet går bara ut de dagar du har något som väntar.");

  return rader.join("\n");
}

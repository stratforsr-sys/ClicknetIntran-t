import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum, svenskaMinuter } from "@/lib/klocka";
import { forfallodag, kursLage } from "@/lib/utbildning";
import { arbetsdagarIManad } from "@/lib/saljtakt";
import { arStangd, type Lage } from "@/lib/uppgifter";
import { hamtaUppgiftsbild, type Uppgiftsbild } from "@/lib/uppgifter-server";
import {
  arDelningsniva,
  attPlinga,
  dagPlus,
  serDetaljer,
  type Delningsniva,
  type Kalenderpost,
} from "@/lib/kalender";

/**
 * Kalenderns läsning.
 *
 * =============================================================================
 * TVÅ VÄGAR IN, OCH DE ÄR OLIKA MED FLIT
 *
 * `hamtaEgenKalender()` läser med användarens EGEN token och sätter ihop fem
 * källor i TypeScript. Det går för att alla fem redan har en RLS-policy som
 * svarar på "får hon se den här raden", och den egna dagen består uteslutande
 * av rader hon får se.
 *
 * `hamtaKollegasKalender()` går i stället genom `kalender_poster()` i
 * databasen. Den vägen finns för att grundläget — ledig/upptagen för alla —
 * INTE är en fråga RLS kan svara på: en kollega som står på nivå ett ska se att
 * tiden är bokad utan att få läsa raden. Projektionen sker därför i Postgres,
 * innan raden lämnar databasen, och inte i en if-sats i en renderingsfil. Se
 * rubriken i 0057.
 *
 * DET ÄR NAVETS FÖRSTA `.rpc()`. Tidigare har ingenting anropat en funktion
 * genom PostgREST, och 0027 stängde den vägen för de två som fanns. Skillnaden
 * är att de två skrev; den här läser, och den lämnar ut mindre än vad som
 * ligger i tabellen. Granten står utskriven i 0057 och gäller bara
 * `authenticated` — `anon` får den aldrig.
 * =============================================================================
 */

export type Kalenderbild = {
  poster: Kalenderpost[];
  /** Svenskt datum, räknat en gång för hela sidan. */
  idag: string;
  /** Uppgiftsbilden ligger kvar: planeringsvyn behöver de OPLANERADE raderna. */
  bild: Uppgiftsbild;
};

/**
 * Min egen kalender mellan två datum, båda inklusive.
 *
 * FEM KÄLLOR OCH INTE EN TABELL. Det fanns en frestelse att spegla allt till en
 * `calendar_event`-tabell och läsa den — snabbare, enklare att sortera, och fel
 * på det sätt som kostar mest: speglingen måste uppdateras av varje väg in och
 * ut ur fem moduler, och den dag en av dem glöms bort visar kalendern något som
 * inte längre är sant. Det är samma val som projektets siffror gjorde i 0054,
 * och `coaching_task` gjorde i 0043 när den vägrade en status-kolumn.
 */
export async function hamtaEgenKalender(
  user: CurrentUser,
  fran: string,
  till: string,
): Promise<Kalenderbild> {
  const idag = svensktDatum();
  const bild = await hamtaUppgiftsbild(user);

  if (!user.employee) return { poster: [], idag, bild };
  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [{ data: ledigheter }, { data: samtal }, { data: kurser }, { data: moduler }, { data: progress }, { data: certifikat }] =
    await Promise.all([
      /**
       * `.eq("employee_id", mig)` är INTE ett andra svar på RLS fråga.
       *
       * Regeln i notiser-server.ts säger att man inte ska filtrera på det
       * policyn redan avgjort, och den gäller. Här är filtret något annat: en
       * teamledare FÅR läsa sitt lags ledighet, men hennes egen kalender är
       * hennes egen dag. Att rita lagets semestrar i den hade varit att svara
       * på en annan fråga än den sidan ställer.
       */
      supabase
        .from("absence_request")
        .select("id, starts_on, ends_on, part_day_minutes")
        .eq("employee_id", mig)
        .eq("status", "approved")
        .lte("starts_on", till)
        .gte("ends_on", fran),

      /**
       * Coachningssamtalet står i BÅDAS kalendrar — den coachades och coachens.
       * RLS i 0043 släpper fram båda hållen, så en fråga räcker; vem raden
       * gäller avgör bara hur posten formuleras.
       */
      supabase
        .from("coaching_session")
        .select("id, employee_id, coach_id, held_on")
        .or(`employee_id.eq.${mig},coach_id.eq.${mig}`)
        .gte("held_on", fran)
        .lte("held_on", till),

      supabase.from("course").select("id, slug, title, due_days").eq("status", "published"),
      supabase
        .from("course_module")
        .select("id, course_id, course!inner(status)")
        .eq("course.status", "published"),
      supabase.from("module_progress").select("module_id").eq("employee_id", mig),
      supabase
        .from("certification")
        .select("course_id, issued_at, expires_at")
        .eq("employee_id", mig),
    ]);

  const poster: Kalenderpost[] = [];

  // --- Uppgifterna -----------------------------------------------------------
  //
  // MINA, plus inkorgen jag själv skrivit. En uppgift jag lagt på någon annan
  // står i HENNES dag och inte i min — den listan heter "Väntar på andra" och
  // finns redan. Att rita den i min kalender hade betytt att min dag ser dubbelt
  // så full ut som den är, vilket är precis fel för ett tal som heter
  // "planerat 4 h av 6 h".
  for (const u of bild.uppgifter) {
    if (!u.due_date || u.due_date < fran || u.due_date > till) continue;
    const min = u.assignee_id === mig || (u.assignee_id === null && u.created_by === mig);
    if (!min) continue;

    poster.push(uppgiftspost(u, mig, idag));
  }

  // --- Ledigheten ------------------------------------------------------------
  //
  // TYPEN FÖLJER INTE MED, precis som i iCal-flödet. Att någon är föräldraledig
  // eller vabbar är en upplysning om varför, och den här vyn ritas bredvid
  // uppgifter som kan vara delade. "Ledig" räcker för att dagen ska gå att
  // planera, och det är vad kalendern är till för.
  for (const a of (ledigheter ?? []) as unknown as Ledighetsrad[]) {
    const fromDag = a.starts_on > fran ? a.starts_on : fran;
    const tomDag = a.ends_on < till ? a.ends_on : till;
    for (let d = fromDag; d <= tomDag; d = dagPlus(d, 1)) {
      poster.push({
        id: `franvaro-${a.id}-${d}`,
        slag: "franvaro",
        ref: a.id,
        employee_id: mig,
        dag: d,
        tid: null,
        minuter: a.part_day_minutes,
        rubrik: a.part_day_minutes ? "Ledig del av dagen" : "Ledig",
        href: "/franvaro",
        flyttbar: false,
        forsenad: false,
        klar: false,
      });
    }
  }

  // --- Coachningssamtalen ----------------------------------------------------
  //
  // `held_on` är en DAG och inte en tidpunkt (0043), så posten är en heldagsrad
  // och inte ett klockslag. Att lägga den på en påhittad tid — "alla samtal är
  // klockan nio" — hade varit att låta kalendern påstå något ingen skrivit.
  for (const s of (samtal ?? []) as unknown as Samtalsrad[]) {
    const jagCoachas = s.employee_id === mig;
    const motpart = bild.namn.get(jagCoachas ? s.coach_id : s.employee_id);
    poster.push({
      id: `coachning-${s.id}`,
      slag: "coachning",
      ref: s.id,
      employee_id: mig,
      dag: s.held_on,
      tid: null,
      minuter: null,
      rubrik: motpart ? `Coachningssamtal med ${motpart}` : "Coachningssamtal",
      href: `/coachning/${jagCoachas ? mig : s.employee_id}`,
      flyttbar: false,
      forsenad: false,
      klar: false,
    });
  }

  // --- Kursfristerna ---------------------------------------------------------
  //
  // Fristen räknas som överallt annars: anställningsdatum plus kursens
  // `due_days` (0008). Den räknas alltså INTE om per person i den här filen —
  // `forfallodag()` i utbildning.ts är samma funktion som kurslistan och klockan
  // använder, och ett andra sätt att räkna hade gett två olika datum för samma
  // frist beroende på var man tittade.
  const modulerPerKurs = new Map<string, string[]>();
  for (const m of (moduler ?? []) as unknown as { id: string; course_id: string }[]) {
    modulerPerKurs.set(m.course_id, [...(modulerPerKurs.get(m.course_id) ?? []), m.id]);
  }
  const klaraModuler = new Set(((progress ?? []) as { module_id: string }[]).map((p) => p.module_id));
  const certPerKurs = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of (certifikat ?? []) as unknown as { course_id: string; issued_at: string; expires_at: string | null }[]) {
    if (!certPerKurs.has(c.course_id)) certPerKurs.set(c.course_id, c);
  }

  for (const k of (kurser ?? []) as unknown as Kursrad[]) {
    const ids = modulerPerKurs.get(k.id) ?? [];
    if (ids.length === 0) continue;

    const lage = kursLage({
      certifikat: certPerKurs.get(k.id) ?? null,
      klaraModuler: ids.filter((id) => klaraModuler.has(id)).length,
      antalModuler: ids.length,
      startDatum: user.employee.start_date,
      fristDagar: k.due_days,
    });
    // En avklarad kurs har ingen frist kvar att rita.
    if (lage === "certifierad") continue;

    const forfaller = forfallodag(user.employee.start_date, k.due_days);
    if (!forfaller) continue;
    const dag = svensktDatum(forfaller);
    if (dag < fran || dag > till) continue;

    poster.push({
      id: `kurs-${k.id}`,
      slag: "kurs",
      ref: k.id,
      employee_id: mig,
      dag,
      tid: null,
      minuter: null,
      rubrik: `Frist: ${k.title}`,
      href: `/utbildning/${k.slug}`,
      flyttbar: false,
      forsenad: dag < idag,
      klar: false,
    });
  }

  // --- Orderfristen ----------------------------------------------------------
  for (const post of orderfrister(user, fran, till, idag)) poster.push(post);

  return { poster, idag, bild };
}

/**
 * Månadens sista arbetsdag — den dag en order måste vara signerad för att räknas.
 *
 * =============================================================================
 * TOLKNINGEN AV "ORDERFRISTER", OCH VARFÖR DEN INTE KOM UR EN KOLUMN
 *
 * Beställaren bad om orderfrister i kalendern. `sales_order` har ingen
 * fristkolumn och har aldrig haft en — den bär `signed_on`, och `period_month`
 * räknas fram ur det datumet av databasen (0034). Det finns alltså ingen rad
 * att hämta.
 *
 * Men det finns en frist, och den är den enda som betyder något för en säljare:
 * en order som signeras den första i nästa månad tillhör NÄSTA månads provision
 * och nästa månads volymtrappa. Sista arbetsdagen är därför en riktig vägg, och
 * den är dessutom den enda deadline i ordermodulen som återkommer.
 *
 * ARBETSDAG OCH INTE SISTA DAGEN I MÅNADEN. `arArbetsdag()` i saljtakt.ts bär
 * redan de svenska röda dagarna, plus julafton, midsommarafton och nyårsafton —
 * ingen säljare tecknar avtal på dem. En frist på en söndag är en frist som
 * flyttas i praktiken utan att någon skrivit det, och då är den inte en frist.
 *
 * POSTEN GÄLLER DEN SOM HAR ORDER. Rollen `salesperson` och de som godkänner
 * dem; samma krets som ordermenyn i `nav-items.ts`. En projektledare ska inte
 * ha en röd rad sista fredagen varje månad om något hon aldrig rör.
 * =============================================================================
 */
function orderfrister(user: CurrentUser, fran: string, till: string, idag: string): Kalenderpost[] {
  if (!user.employee) return [];
  if (!hasRole(user, "salesperson", "sales_manager", "ceo", "finance")) return [];

  const ut: Kalenderpost[] = [];
  const manader = new Set<string>();
  for (let d = fran; d <= till; d = dagPlus(d, 1)) manader.add(`${d.slice(0, 7)}-01`);

  for (const manad of manader) {
    const arbetsdagar = arbetsdagarIManad(manad);
    const sista = arbetsdagar[arbetsdagar.length - 1];
    if (!sista || sista < fran || sista > till) continue;

    ut.push({
      id: `orderfrist-${manad}`,
      slag: "order",
      ref: null,
      employee_id: user.employee.id,
      dag: sista,
      tid: null,
      minuter: null,
      rubrik: "Sista dagen order räknas till månaden",
      href: "/order",
      flyttbar: false,
      forsenad: sista < idag,
      klar: false,
    });
  }

  return ut;
}

/**
 * En kollegas kalender, projicerad till min nivå.
 *
 * Returnerar `null` när det inte går att läsa alls — offboardad person, eller
 * ett id som inte finns. Tom lista betyder något annat: personen finns och har
 * ingenting inlagt de här dagarna.
 */
export async function hamtaKollegasKalender(
  user: CurrentUser,
  personId: string,
  fran: string,
  till: string,
): Promise<{ poster: Kalenderpost[]; niva: Delningsniva } | null> {
  if (!user.employee) return null;

  const supabase = await supabaseServer();
  const idag = svensktDatum();

  const [{ data: nivarad }, { data: rader, error }] = await Promise.all([
    supabase.rpc("kalender_niva", { p_owner: personId, p_viewer: user.employee.id }),
    supabase.rpc("kalender_poster", { p_owner: personId, p_fran: fran, p_till: till }),
  ]);

  const niva = arDelningsniva(nivarad) ? nivarad : null;
  if (!niva) return null;

  /**
   * Ett fel från PostgREST är inte samma sak som noll rader, och skillnaden
   * spelar roll precis här: en funktion som inte hunnit in i schemacachen ger
   * ett fel, och att rita det som en tom dag hade påstått att kollegan är ledig.
   */
  if (error) return { poster: [], niva };

  const poster: Kalenderpost[] = ((rader ?? []) as unknown as Projektionsrad[]).map((r) => ({
    id: `${r.slag}-${r.ref ?? r.dag}-${r.tid ?? "heldag"}`,
    slag: r.slag === "franvaro" ? "franvaro" : "uppgift",
    ref: serDetaljer(niva) ? r.ref : null,
    employee_id: personId,
    dag: r.dag,
    tid: r.tid ? r.tid.slice(0, 5) : null,
    minuter: r.minuter,
    rubrik: r.rubrik,
    // Länken finns bara när nivån faktiskt öppnar raden. `ref` är null under
    // "alla detaljer" just för att den här raden inte ska kunna bygga en.
    href: r.ref && serDetaljer(niva) ? `/uppgifter/${r.ref}` : null,
    // Att flytta någon annans uppgift sker på uppgiftssidan, inte genom att dra
    // i en vy som är en projektion. Se `farPlaneraOm()`.
    flyttbar: false,
    forsenad: !r.klar && r.dag < idag,
    klar: r.klar,
  }));

  return { poster, niva };
}

/**
 * Vem jag delat med, och vem som delat med mig.
 *
 * Namnen slås upp med användarens EGEN token och följer `employee_read`
 * oförändrat. Följden är att en säljare bara kan dela med dem hon redan ser —
 * samma gräns som uppgiftsmodulens väljare, och samma öppna fråga till
 * beställaren om personalregistret ska öppnas.
 */
export async function hamtaDelningar(user: CurrentUser): Promise<{
  utat: { employee_id: string; namn: string; niva: Delningsniva }[];
  inat: { employee_id: string; namn: string; niva: Delningsniva }[];
  kollegor: { id: string; namn: string }[];
}> {
  const tom = { utat: [], inat: [], kollegor: [] };
  if (!user.employee) return tom;

  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [{ data: delningar }, { data: personer }] = await Promise.all([
    supabase.from("calendar_share").select("owner_id, viewer_id, level"),
    supabase.from("employee").select("id, first_name, last_name, status").neq("status", "offboarded"),
  ]);

  const namn = new Map(
    ((personer ?? []) as unknown as { id: string; first_name: string; last_name: string }[]).map((p) => [
      p.id,
      fullName(p),
    ]),
  );

  const rader = (delningar ?? []) as unknown as { owner_id: string; viewer_id: string; level: string }[];

  return {
    utat: rader
      .filter((r) => r.owner_id === mig && arDelningsniva(r.level))
      .map((r) => ({ employee_id: r.viewer_id, namn: namn.get(r.viewer_id) ?? "Okänd", niva: r.level as Delningsniva }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    inat: rader
      .filter((r) => r.viewer_id === mig && arDelningsniva(r.level))
      .map((r) => ({ employee_id: r.owner_id, namn: namn.get(r.owner_id) ?? "Okänd", niva: r.level as Delningsniva }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    // Alla jag alls kan se. Grundläget gäller dem också — de står i listan för
    // att man ska kunna öppna deras dag, inte för att de delat något.
    kollegor: [...namn.entries()]
      .filter(([id]) => id !== mig)
      .map(([id, n]) => ({ id, namn: n }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
  };
}

/**
 * Vad som är på väg att hända, för plinget i webbläsaren.
 *
 * =============================================================================
 * EGEN LÄSNING OCH INTE HELA KALENDERBILDEN
 *
 * `hamtaEgenKalender()` är sex frågor och bygger fem källor. Plinget frågar en
 * gång var femte minut så länge någon har navet öppet, och det ska därför kosta
 * så lite som möjligt: bara dagens uppgifter, bara de med ett klockslag.
 *
 * INGEN AV DE ANDRA KÄLLORNA KAN PLINGA, och det följer av vad de är. En
 * ledighetsdag, en kursfrist och en orderfrist är heldagsposter utan klockslag
 * — det finns ingen tidpunkt att plinga tio minuter före. Coachningssamtalet
 * likaså: `held_on` är en dag (0043).
 * =============================================================================
 */
export async function kommandeposter(user: CurrentUser): Promise<Kalenderpost[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;
  const idag = svensktDatum();
  const nu = svenskaMinuter(new Date());

  const supabase = await supabaseServer();

  const { data: rader } = await supabase
    .from("task")
    .select("id, title, due_date, due_time, estimate_minutes, assignee_id")
    .eq("assignee_id", mig)
    .eq("due_date", idag)
    .is("parent_id", null)
    .not("due_time", "is", null);

  const uppgifter = (rader ?? []) as unknown as {
    id: string;
    title: string;
    due_date: string;
    due_time: string;
    estimate_minutes: number | null;
  }[];

  if (uppgifter.length === 0) return [];

  // Avbockade ska inte plinga. Läget räknas fram ur händelserna (0054), så det
  // krävs en andra fråga — men bara för de uppgifter som faktiskt står på tur.
  const { data: handelser } = await supabase
    .from("task_event")
    .select("task_id, type")
    .in(
      "task_id",
      uppgifter.map((u) => u.id),
    )
    .order("at");

  const stangda = new Set<string>();
  const perUppgift = new Map<string, { type: string }[]>();
  for (const h of (handelser ?? []) as unknown as { task_id: string; type: string }[]) {
    perUppgift.set(h.task_id, [...(perUppgift.get(h.task_id) ?? []), h]);
  }
  for (const [id, hs] of perUppgift) {
    const sista = hs[hs.length - 1]?.type;
    if (sista === "klar" || sista === "godkand" || sista === "avbruten") stangda.add(id);
  }

  const poster: Kalenderpost[] = uppgifter.map((u) => ({
    id: `uppgift-${u.id}`,
    slag: "uppgift",
    ref: u.id,
    employee_id: mig,
    dag: u.due_date,
    tid: u.due_time.slice(0, 5),
    minuter: u.estimate_minutes,
    rubrik: u.title,
    href: `/uppgifter/${u.id}`,
    flyttbar: true,
    forsenad: false,
    klar: stangda.has(u.id),
  }));

  return attPlinga(poster, idag, nu);
}

// -----------------------------------------------------------------------------
// Hjälp
// -----------------------------------------------------------------------------

function uppgiftspost(
  u: {
    id: string;
    title: string;
    due_date: string | null;
    due_time: string | null;
    estimate_minutes: number | null;
    lage: Lage;
  },
  mig: string,
  idag: string,
): Kalenderpost {
  return {
    id: `uppgift-${u.id}`,
    slag: "uppgift",
    ref: u.id,
    employee_id: mig,
    dag: u.due_date!,
    tid: u.due_time,
    minuter: u.estimate_minutes,
    rubrik: u.title,
    href: `/uppgifter/${u.id}`,
    // Den egna uppgiften går att dra. En stängd gör det inte: att planera om
    // något man redan bockat av är att öppna det igen utan att säga det.
    flyttbar: !arStangd(u.lage),
    forsenad: !arStangd(u.lage) && u.due_date! < idag,
    klar: arStangd(u.lage),
  };
}

type Ledighetsrad = { id: string; starts_on: string; ends_on: string; part_day_minutes: number | null };
type Samtalsrad = { id: string; employee_id: string; coach_id: string; held_on: string };
type Kursrad = { id: string; slug: string; title: string; due_days: number | null };

/**
 * Raden `kalender_poster()` lämnar ut.
 *
 * Typas om EN gång, här. Supabase-klienten kan inte härleda formen på en
 * `.rpc()` — den blir `any` respektive `never` beroende på vad generatorn sett —
 * och en cast vid varje användning hade blivit tre ställen som måste hållas
 * lika. Samma val som `Lankrad` i uppgifter-server.ts.
 */
type Projektionsrad = {
  slag: string;
  ref: string | null;
  dag: string;
  tid: string | null;
  minuter: number | null;
  rubrik: string | null;
  klar: boolean;
};

import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { fullName, type CurrentUser } from "@/lib/auth";
import { notisId, type Notis } from "@/lib/notiser";
import { svensktDatum } from "@/lib/klocka";
import {
  arStangd,
  dagarMellan,
  forsenad,
  fristtext,
  lageAv,
  sorteraUppgifter,
  type Handelsetyp,
  type Lage,
  type Medlemsroll,
  type Prioritet,
  type Uppgiftsrad,
} from "@/lib/uppgifter";

/**
 * Läsningen i uppgiftsmodulen.
 *
 * VARJE UPPGIFTSFRÅGA LÄSES MED ANVÄNDARENS EGEN TOKEN. Det är inte en
 * försiktighetsåtgärd utan hela behörighetsmodellen: `task_read` i 0054 är den
 * enda platsen där kretsen står, och ett eget `.eq("assignee_id", mig)` här
 * hade varit ett andra svar på samma fråga. Två svar glider isär, och det som
 * glider isär i den här modulen är vem som får läsa någons anteckningar.
 *
 * EN ENDA LÄSNING GÖR UNDANTAG, och den läser inga uppgifter: `namnkarta()`
 * slår upp namnen bakom de id:n som RLS redan lämnat ut. Motiveringen står i
 * sin helhet vid funktionen längst ned — läs den innan du kopierar mönstret.
 *
 * Se även rubriken i 0054 om varför ingen roll ger insyn.
 */

const FALT =
  "id, title, description_md, project_id, parent_id, assignee_id, created_by," +
  " starts_on, due_date, due_time, estimate_minutes, priority, created_at, updated_at";

type TaskRad = {
  id: string;
  title: string;
  description_md: string;
  project_id: string | null;
  parent_id: string | null;
  assignee_id: string | null;
  created_by: string;
  starts_on: string | null;
  due_date: string | null;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type Medlem = { task_id: string; employee_id: string; role: Medlemsroll; namn: string };

export type Handelse = {
  id: string;
  task_id: string;
  type: Handelsetyp;
  by_employee_id: string;
  note: string | null;
  at: string;
};

export type Koppling = {
  id: string;
  task_id: string;
  slag: Kopplingsslag;
  /** Vad kopplingen pekar på, skrivet för en människa. */
  etikett: string;
  /** Dit man klickar. Null när målet saknar egen sida. */
  href: string | null;
  visible_to_subject: boolean;
};

export const KOPPLINGSSLAG = [
  "order",
  "arende",
  "person",
  "coachning",
  "kurs",
  "dokument",
  "kandidat",
  "avtal",
  "samtal",
] as const;
export type Kopplingsslag = (typeof KOPPLINGSSLAG)[number];

export const KOPPLING_ETIKETT: Record<Kopplingsslag, string> = {
  order: "Order",
  arende: "Ärende",
  person: "Person",
  coachning: "Coachning",
  kurs: "Utbildning",
  dokument: "Rutin",
  kandidat: "Kandidat",
  avtal: "Avtal",
  samtal: "Samtal",
};

export type Uppgift = Uppgiftsrad & {
  description_md: string;
  created_at: string;
  updated_at: string;
  medlemmar: Medlem[];
  kopplingar: Koppling[];
  delar: Uppgiftsrad[];
  /** Den inloggades roll bland de inbjudna, om någon. */
  minRoll: Medlemsroll | null;
};

export type Projektmedlem = { employee_id: string; role: "redigerare" | "visare"; namn: string };

export type Projekt = {
  id: string;
  name: string;
  description_md: string;
  owner_id: string;
  color: string;
  due_date: string | null;
  archived_at: string | null;
  medlemmar: Projektmedlem[];
  /** Räknat ur uppgifterna, inte lagrat. Se rubriken nedan. */
  antal: number;
  klara: number;
  forsenade: number;
};

export type Uppgiftsbild = {
  /** Allt den inloggade ser, deluppgifter undantagna. Sorterat. */
  uppgifter: Uppgift[];
  projekt: Projekt[];
  namn: Map<string, string>;
  idag: string;
};

/**
 * Hela bilden i ett anrop.
 *
 * FEM FRÅGOR OCH INTE EN PER UPPGIFT. Listan, kalendern i pass 2 och
 * startsidans kort behöver alla samma fem tabeller, och den som hämtar
 * medlemmar och händelser per rad bygger en sida som blir långsammare ju mer
 * den används. RLS gör redan urvalet, så frågorna är små även utan filter.
 */
export async function hamtaUppgiftsbild(user: CurrentUser): Promise<Uppgiftsbild> {
  const idag = svensktDatum();
  const tom: Uppgiftsbild = { uppgifter: [], projekt: [], namn: new Map(), idag };
  if (!user.employee) return tom;

  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [
    { data: rader },
    { data: medlemsrader },
    { data: handelser },
    { data: projektrader },
    { data: projektmedlemmar },
    { data: lankar },
  ] = await Promise.all([
      supabase.from("task").select(FALT),
      supabase.from("task_member").select("task_id, employee_id, role"),
      supabase.from("task_event").select("id, task_id, type, by_employee_id, note, at").order("at"),
      supabase
        .from("project")
        .select("id, name, description_md, owner_id, color, due_date, archived_at")
        .order("created_at", { ascending: false }),
      supabase.from("project_member").select("project_id, employee_id, role"),
      supabase
        .from("task_link")
        .select(
          "id, task_id, visible_to_subject, order_id, case_id, employee_id, coaching_task_id," +
            " course_id, document_id, candidate_id, contract_id, kv_call_id," +
            " sales_order(company_name), hr_case(subject), coaching_task(title)," +
            " course(title, slug), document(title, slug), candidate(first_name, last_name)," +
            " contract(title), kv_call(customer, call_date)",
        ),
    ]);

  const alla = (rader ?? []) as unknown as TaskRad[];

  /**
   * Länkraderna typas om EN gång, här.
   *
   * Supabase-klientens typparser klarar inte den inbäddade select-strängen och
   * ger `GenericStringError` för hela raden — frågan är riktig, men typen säger
   * ingenting. Att casta vid varje användning blir två ställen som måste hållas
   * lika; en omtypning är ett.
   */
  const lankrader = (lankar ?? []) as unknown as Lankrad[];
  if (alla.length === 0 && (projektrader ?? []).length === 0) return tom;

  /**
   * Namnen på ett ställe.
   *
   * Personer bäddas medvetet INTE in i frågorna ovan. `task` pekar två gånger
   * på `employee` (assignee_id och created_by), och det gör `task_member` och
   * `task_link` också — en inbäddning utan namngiven nyckel avvisas då med
   * PGRST201 och hela frågan kommer tillbaka tom. Se rubriken i `auth.ts`.
   * En uppslagning är dessutom en fråga i stället för fem.
   */
  const behover = new Set<string>();
  for (const r of alla) {
    if (r.assignee_id) behover.add(r.assignee_id);
    behover.add(r.created_by);
  }
  for (const m of medlemsrader ?? []) behover.add((m as { employee_id: string }).employee_id);
  for (const h of handelser ?? []) behover.add((h as { by_employee_id: string }).by_employee_id);
  for (const p of projektrader ?? []) behover.add((p as { owner_id: string }).owner_id);
  for (const m of projektmedlemmar ?? []) behover.add((m as { employee_id: string }).employee_id);
  for (const l of lankrader) {
    if (l.employee_id) behover.add(l.employee_id);
  }

  const namn = await namnkarta(supabase, [...behover]);

  // Händelserna per uppgift, i tidsordning. Frågan är redan sorterad.
  const perUppgift = new Map<string, Handelse[]>();
  for (const h of (handelser ?? []) as unknown as Handelse[]) {
    const lista = perUppgift.get(h.task_id);
    if (lista) lista.push(h);
    else perUppgift.set(h.task_id, [h]);
  }

  const medlemmar = new Map<string, Medlem[]>();
  for (const m of (medlemsrader ?? []) as unknown as Omit<Medlem, "namn">[]) {
    const rad: Medlem = { ...m, namn: namn.get(m.employee_id) ?? "Okänd" };
    const lista = medlemmar.get(m.task_id);
    if (lista) lista.push(rad);
    else medlemmar.set(m.task_id, [rad]);
  }

  const kopplingar = new Map<string, Koppling[]>();
  for (const rad of lankrader) {
    const k = tolkaKoppling(rad, namn);
    if (!k) continue;
    const lista = kopplingar.get(k.task_id);
    if (lista) lista.push(k);
    else kopplingar.set(k.task_id, [k]);
  }

  const lagen = new Map<string, Lage>();
  for (const r of alla) lagen.set(r.id, lageAv(perUppgift.get(r.id) ?? []));

  const bygg = (r: TaskRad): Uppgiftsrad => ({
    id: r.id,
    title: r.title,
    assignee_id: r.assignee_id,
    created_by: r.created_by,
    project_id: r.project_id,
    parent_id: r.parent_id,
    due_date: r.due_date,
    due_time: r.due_time ? r.due_time.slice(0, 5) : null,
    starts_on: r.starts_on,
    estimate_minutes: r.estimate_minutes,
    priority: (r.priority as Prioritet) ?? 3,
    lage: lagen.get(r.id) ?? "ej_paborjad",
    granskare: (medlemmar.get(r.id) ?? []).filter((m) => m.role === "granskare").length,
  });

  const delarAv = new Map<string, Uppgiftsrad[]>();
  for (const r of alla) {
    if (!r.parent_id) continue;
    const lista = delarAv.get(r.parent_id);
    if (lista) lista.push(bygg(r));
    else delarAv.set(r.parent_id, [bygg(r)]);
  }

  const uppgifter: Uppgift[] = alla
    .filter((r) => !r.parent_id)
    .map((r) => ({
      ...bygg(r),
      description_md: r.description_md,
      created_at: r.created_at,
      updated_at: r.updated_at,
      medlemmar: medlemmar.get(r.id) ?? [],
      kopplingar: kopplingar.get(r.id) ?? [],
      delar: sorteraUppgifter(delarAv.get(r.id) ?? [], idag),
      minRoll: (medlemmar.get(r.id) ?? []).find((m) => m.employee_id === mig)?.role ?? null,
    }));

  /**
   * Projektets siffror RÄKNAS FRAM ur uppgifterna. De lagras inte.
   *
   * En räknare i tabellen hade behövt uppdateras av varje väg in och ut —
   * bocken, returneringen, borttagningen, flytten mellan projekt — och den dag
   * en av dem glöms bort visar kortet ett tal som ingen kan härleda. Det är
   * samma val som 0043 gjorde när den vägrade en status-kolumn.
   *
   * DELUPPGIFTER RÄKNAS INTE. De hör till sin rubrik, och ett projekt med tre
   * uppgifter och tjugo checklistepunkter ska säga tre.
   */
  const projekt: Projekt[] = (
    (projektrader ?? []) as unknown as Omit<Projekt, "antal" | "klara" | "forsenade" | "medlemmar">[]
  ).map((p) => {
    const mina = uppgifter.filter((u) => u.project_id === p.id);
    return {
      ...p,
      medlemmar: ((projektmedlemmar ?? []) as unknown as { project_id: string; employee_id: string; role: "redigerare" | "visare" }[])
        .filter((m) => m.project_id === p.id)
        .map((m) => ({ employee_id: m.employee_id, role: m.role, namn: namn.get(m.employee_id) ?? "Okänd" })),
      antal: mina.length,
      klara: mina.filter((u) => u.lage === "klar").length,
      forsenade: mina.filter((u) => forsenad(u, idag)).length,
    };
  });

  return { uppgifter: sorteraUppgifter(uppgifter, idag), projekt, namn, idag };
}

// -----------------------------------------------------------------------------
// Vyerna
//
// Funktionerna nedan är FILTER ÖVER SAMMA BILD, inte egna frågor. Skälet är att
// en uppgift ska kunna räknas i två vyer utan att hämtas två gånger — "väntar
// på andra" och "att granska" överlappar för den som både delegerat och står
// som granskare.
// -----------------------------------------------------------------------------

/** Mitt att göra idag: förfallet och dagens, det jag själv ansvarar för. */
export function minaIdag(bild: Uppgiftsbild, mig: string): Uppgift[] {
  return bild.uppgifter.filter(
    (u) =>
      u.assignee_id === mig &&
      !arStangd(u.lage) &&
      (forsenad(u, bild.idag) || u.due_date === bild.idag),
  );
}

/** Allt öppet som är mitt, oavsett datum. Inkorgen är den utan ansvarig. */
export function minaOppna(bild: Uppgiftsbild, mig: string): Uppgift[] {
  return bild.uppgifter.filter((u) => u.assignee_id === mig && !arStangd(u.lage));
}

/**
 * VÄNTAR PÅ ANDRA — delegeringslistan.
 *
 * GTD kallar den "Waiting For", och för en chef är den modulens mest värdefulla
 * vy: det man lämnat ifrån sig är precis det man själv slutar tänka på. Den
 * visar därför inte bara VAD som ligger hos andra utan HUR LÄNGE, för det är
 * den frågan man annars ställer i efterhand.
 *
 * Uppgifter som väntar på MIN granskning står inte här — de ligger hos mig och
 * inte hos någon annan, och `attGranska()` nedan är deras plats.
 */
export function vantarPaAndra(bild: Uppgiftsbild, mig: string): Uppgift[] {
  return bild.uppgifter.filter(
    (u) => u.created_by === mig && u.assignee_id !== mig && u.assignee_id !== null && !arStangd(u.lage),
  );
}

/** Inlämnade uppgifter där jag står som granskare. Först till kvarn. */
export function attGranska(bild: Uppgiftsbild, mig: string): Uppgift[] {
  return bild.uppgifter.filter(
    (u) => u.lage === "granskas" && u.medlemmar.some((m) => m.employee_id === mig && m.role === "granskare"),
  );
}

/** Uppgifter utan ansvarig. Det man skrivit ner men inte tagit ställning till. */
export function inkorgen(bild: Uppgiftsbild, mig: string): Uppgift[] {
  return bild.uppgifter.filter((u) => u.assignee_id === null && u.created_by === mig && !arStangd(u.lage));
}

/**
 * Dygn sedan något hände på uppgiften.
 *
 * `updated_at` och inte `created_at`: en uppgift som fått en kommentar i går
 * har inte stått still i tre veckor, även om den lades upp då.
 */
export function stilla(u: Uppgift, idag: string): number {
  return Math.max(0, dagarMellan(svensktDatum(u.updated_at), idag));
}

// -----------------------------------------------------------------------------
// Notiserna
//
// ALLA FYRA ÄR HÄRLEDDA, ingen är en rad i `notification_event`. Valet följer
// regeln i notiser.ts: en händelsekälla är rätt när händelsen SKRIVER ÖVER
// tillståndet den kom ur, och det gör ingen av de här. En uppgift som väntar på
// mig står kvar som väntande tills någon gör något åt den, och en tilldelning
// syns i `assignee_id` så länge den gäller. Hade de varit händelser hade en
// bortglömd `notifiera()` i en ny server action gett en tyst lucka.
// -----------------------------------------------------------------------------

/** Så länge får något ligga hos någon annan innan delegeringslistan säger till. */
const VANTAT_FOR_LANGE_DAGAR = 5;

export async function uppgiftsnotiser(user: CurrentUser): Promise<Notis[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;

  const bild = await hamtaUppgiftsbild(user);
  if (bild.uppgifter.length === 0) return [];

  const notiser: Notis[] = [];
  const nu = new Date().toISOString();

  /**
   * FÖRFALLET OCH DAGENS, SOM EN POST OCH INTE SOM TIO.
   *
   * Den som ligger efter med elva uppgifter behöver inte elva notiser om det —
   * hon behöver veta att hon ligger efter och komma till listan. Elva rader i
   * klockan är dessutom elva rader som trycker ut allt annat navet vill säga,
   * och forskningen om notisträtthet pekar entydigt åt samma håll: samla ihop,
   * pinga inte per händelse.
   *
   * ID:T BÄR DAGENS DATUM, så posten återuppstår i morgon för den som klickat
   * bort den och fortfarande inte gjort något. Ett stabilt id hade betytt att
   * en enda bortklickning tystade förseningarna för alltid.
   */
  const forsenade = bild.uppgifter.filter((u) => u.assignee_id === mig && forsenad(u, bild.idag));
  const idagsrader = bild.uppgifter.filter(
    (u) => u.assignee_id === mig && !arStangd(u.lage) && u.due_date === bild.idag,
  );

  if (forsenade.length > 0) {
    notiser.push({
      id: notisId("uppgift", "forsenade", bild.idag),
      typ: "uppgift",
      rubrik:
        forsenade.length === 1
          ? `Försenad: ${forsenade[0].title}`
          : `${forsenade.length} uppgifter är försenade`,
      detalj:
        forsenade.length === 1
          ? (fristtext(forsenade[0].due_date, bild.idag) ?? "")
          : forsenade
              .slice(0, 3)
              .map((u) => u.title)
              .join(" · "),
      href: "/uppgifter",
      tidpunkt: nu,
      olast: true,
    });
  }

  if (idagsrader.length > 0) {
    notiser.push({
      id: notisId("uppgift-idag", bild.idag),
      typ: "uppgift",
      rubrik: idagsrader.length === 1 ? idagsrader[0].title : `${idagsrader.length} uppgifter idag`,
      detalj:
        idagsrader.length === 1
          ? (idagsrader[0].due_time ? `Klockan ${idagsrader[0].due_time}` : "Klar idag")
          : idagsrader
              .slice(0, 3)
              .map((u) => u.title)
              .join(" · "),
      href: "/uppgifter",
      tidpunkt: nu,
      olast: true,
    });
  }

  /**
   * NÅGON HAR LAGT EN UPPGIFT PÅ MIG — ett besked, inte en påminnelse.
   *
   * Egen källa av exakt samma skäl som coachningens `coachning-ny`: en uppgift
   * som just tilldelats har ingen passerad frist och hade därför varit tyst
   * tills den blev försenad. Den som får något att göra ska få veta det medan
   * det fortfarande går att göra i tid.
   *
   * Bara uppgifter någon ANNAN lagt på mig. Mina egna anteckningar behöver
   * ingen som berättar att jag skrev dem.
   */
  for (const u of bild.uppgifter) {
    if (u.assignee_id !== mig || u.created_by === mig) continue;
    if (u.lage !== "ej_paborjad") continue;

    notiser.push({
      id: notisId("uppgift-ny", u.id),
      typ: "uppgift",
      rubrik: u.title,
      detalj: [`Från ${bild.namn.get(u.created_by) ?? "en kollega"}`, fristtext(u.due_date, bild.idag)]
        .filter(Boolean)
        .join(" · "),
      href: `/uppgifter/${u.id}`,
      tidpunkt: u.created_at,
      olast: true,
    });
  }

  /** Returnerad av en granskare. Ett besked från en människa — säger till direkt. */
  for (const u of bild.uppgifter) {
    if (u.assignee_id !== mig || u.lage !== "returnerad") continue;
    notiser.push({
      id: notisId("uppgift-returnerad", u.id),
      typ: "uppgift",
      rubrik: `Returnerad: ${u.title}`,
      detalj: "Läs skälet och gör om",
      href: `/uppgifter/${u.id}`,
      tidpunkt: u.updated_at,
      olast: true,
    });
  }

  /** Väntar på MIN bock. */
  for (const u of attGranska(bild, mig)) {
    notiser.push({
      id: notisId("uppgift-granska", u.id),
      typ: "uppgift",
      rubrik: `Godkänn: ${u.title}`,
      detalj: `Inlämnad av ${bild.namn.get(u.assignee_id ?? "") ?? "en kollega"}`,
      href: `/uppgifter/${u.id}`,
      tidpunkt: u.updated_at,
      olast: true,
    });
  }

  /**
   * Något jag delegerat har stått still.
   *
   * ID:T BÄR ANTALET VECKOR, så posten återuppstår en gång i veckan för den som
   * klickat bort den medan saken fortfarande ligger. Samma trappa som
   * coachningens påminnelse — en delegering som ingen följer upp är en
   * delegering som blev en glömska.
   */
  for (const u of vantarPaAndra(bild, mig)) {
    const dagar = stilla(u, bild.idag);
    if (dagar < VANTAT_FOR_LANGE_DAGAR) continue;

    notiser.push({
      id: notisId("uppgift-vantar", u.id, Math.floor(dagar / 7)),
      typ: "uppgift",
      rubrik: `Väntar: ${u.title}`,
      detalj: `Hos ${bild.namn.get(u.assignee_id ?? "") ?? "en kollega"} sedan ${dagar} dagar`,
      href: `/uppgifter/${u.id}`,
      tidpunkt: u.updated_at,
      olast: true,
    });
  }

  return notiser;
}

// -----------------------------------------------------------------------------
// Hjälp
// -----------------------------------------------------------------------------

/**
 * Namnen bakom id:na.
 *
 * ===========================================================================
 * DEN ENDA LÄSNINGEN I MODULEN SOM GÅR VIA SERVICE ROLE, OCH DEN ÄR MOTIVERAD
 *
 * `employee_read` (0001, hårdad i 0002) släpper fram DIG SJÄLV, ditt lag om du
 * leder ett, och hela registret för säljchef, VD och administratör. En säljare
 * ser alltså ingen annans namn.
 *
 * Med användarens egen token hade den som FICK en uppgift därför mött "Okänd la
 * uppgiften på dig" — vilket är sämre än ingen uppgift alls: en anonym
 * tillsägelse är exakt det `guide_nudge.nudged_by` och `coaching_task.created_by`
 * infördes för att förhindra.
 *
 * URVALET ÄR SPÄRREN, INTE POLICYN. `ids` byggs uteslutande ur rader som RLS
 * REDAN har släppt fram till den här användaren — hennes egna uppgifter, deras
 * medlemmar, deras historik. Funktionen kan alltså bara röja namnet på någon
 * som hon redan står i en uppgift tillsammans med. Den går inte att fråga om
 * huset.
 *
 * DET HÄR ÄR INTE EN VÄG ATT BLÄDDRA I REGISTRET. Väljarna i gränssnittet —
 * vem du kan tilldela till och vem du kan bjuda in — läser med användarens
 * EGEN token och följer `employee_read` oförändrat. Följden är att en säljare
 * inte kan delegera till en kollega hen inte redan får se, och det är ett
 * medvetet val: att öppna registret är ett beslut om personalregistret, inte
 * om uppgiftsmodulen.
 * ===========================================================================
 */
async function namnkarta(_db: Db, ids: string[]): Promise<Map<string, string>> {
  const karta = new Map<string, string>();
  if (ids.length === 0) return karta;

  const { data } = await supabaseAdmin()
    .from("employee")
    .select("id, first_name, last_name")
    .in("id", ids);

  for (const p of data ?? []) {
    karta.set(p.id as string, fullName(p as { first_name: string; last_name: string }));
  }
  return karta;
}

type Db = Awaited<ReturnType<typeof supabaseServer>>;

type Lankrad = {
  id: string;
  task_id: string;
  visible_to_subject: boolean;
  order_id: string | null;
  case_id: string | null;
  employee_id: string | null;
  coaching_task_id: string | null;
  course_id: string | null;
  document_id: string | null;
  candidate_id: string | null;
  contract_id: string | null;
  kv_call_id: string | null;
  sales_order: { company_name: string } | null;
  hr_case: { subject: string } | null;
  coaching_task: { title: string } | null;
  course: { title: string; slug: string } | null;
  document: { title: string; slug: string } | null;
  candidate: { first_name: string; last_name: string } | null;
  contract: { title: string } | null;
  kv_call: { customer: string | null; call_date: string } | null;
};

/**
 * En länkrad till något läsbart.
 *
 * RADEN KAN HA EN NYCKEL UTAN ATT HA MÅLET. `task_link` läses med användarens
 * token, och de inbäddade tabellerna har sina egna RLS-policyer — en uppgift
 * kopplad till ett konfidentiellt ärende ger därför `case_id` men `hr_case:
 * null` för den som inte får se ärendet. Då visas kopplingens SLAG utan dess
 * innehåll, vilket är sanningen: det finns en koppling, och den är inte din att
 * läsa. Att dölja hela raden hade varit att låtsas att uppgiften saknar
 * sammanhang.
 */
function tolkaKoppling(rad: Lankrad, namn: Map<string, string>): Koppling | null {
  const bas = { id: rad.id, task_id: rad.task_id, visible_to_subject: rad.visible_to_subject };

  if (rad.order_id) {
    return {
      ...bas,
      slag: "order",
      etikett: rad.sales_order?.company_name ?? "Order",
      href: "/order",
    };
  }
  if (rad.case_id) {
    return {
      ...bas,
      slag: "arende",
      etikett: rad.hr_case?.subject ?? "Ärende",
      href: `/arenden/${rad.case_id}`,
    };
  }
  if (rad.employee_id) {
    return {
      ...bas,
      slag: "person",
      etikett: namn.get(rad.employee_id) ?? "Person",
      href: `/personal/${rad.employee_id}`,
    };
  }
  if (rad.coaching_task_id) {
    return {
      ...bas,
      slag: "coachning",
      etikett: rad.coaching_task?.title ?? "Coachningsuppgift",
      href: `/coachning/uppgift/${rad.coaching_task_id}`,
    };
  }
  if (rad.course_id) {
    return {
      ...bas,
      slag: "kurs",
      etikett: rad.course?.title ?? "Kurs",
      href: rad.course ? `/utbildning/${rad.course.slug}` : null,
    };
  }
  if (rad.document_id) {
    return {
      ...bas,
      slag: "dokument",
      etikett: rad.document?.title ?? "Rutin",
      href: rad.document ? `/rutiner/${rad.document.slug}` : null,
    };
  }
  if (rad.candidate_id) {
    return {
      ...bas,
      slag: "kandidat",
      etikett: rad.candidate ? `${rad.candidate.first_name} ${rad.candidate.last_name}` : "Kandidat",
      href: `/rekrytering/${rad.candidate_id}`,
    };
  }
  if (rad.contract_id) {
    return {
      ...bas,
      slag: "avtal",
      etikett: rad.contract?.title ?? "Avtal",
      href: `/avtal/${rad.contract_id}`,
    };
  }
  if (rad.kv_call_id) {
    return {
      ...bas,
      slag: "samtal",
      etikett: rad.kv_call?.customer ?? "Samtal",
      href: `/kv/${rad.kv_call_id}`,
    };
  }

  // `task_link_exakt_en` i 0054 gör det här omöjligt. Raden står ändå: en
  // koppling utan mål ska inte rita ett tomt chip.
  return null;
}

/**
 * Uppgiften med sin historik — detaljsidans läsning.
 *
 * Egen fråga och inte ett filter över `hamtaUppgiftsbild()`: detaljsidan
 * behöver HÄNDELSERNA med noteringar och namn, och de är det enda som inte
 * ryms i listan. Att lägga dem i bilden hade gjort varje listladdning tyngre
 * för en sida i taget.
 */
export async function hamtaUppgift(
  user: CurrentUser,
  id: string,
): Promise<{
  uppgift: Uppgift;
  handelser: (Handelse & { namn: string })[];
  namn: Map<string, string>;
  /** Alla projekt den inloggade ser — brödsmulan och projektväljaren behöver dem. */
  projekt: Projekt[];
} | null> {
  if (!user.employee) return null;

  const bild = await hamtaUppgiftsbild(user);
  const uppgift = bild.uppgifter.find((u) => u.id === id);
  if (!uppgift) return null;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("task_event")
    .select("id, task_id, type, by_employee_id, note, at")
    .eq("task_id", id)
    .order("at", { ascending: false });

  const handelser = ((data ?? []) as unknown as Handelse[]).map((h) => ({
    ...h,
    namn: bild.namn.get(h.by_employee_id) ?? "Okänd",
  }));

  return { uppgift, handelser, namn: bild.namn, projekt: bild.projekt };
}

/**
 * Ett projekt med sina uppgifter — projektsidans läsning.
 *
 * FILTRERAR ÖVER SAMMA BILD i stället för att fråga om projektets uppgifter.
 * En egen fråga hade behövt sin egen läsning av medlemmar, händelser och
 * kopplingar, alltså en andra väg fram till samma svar — och den dag de två
 * vägarna räknar läget olika är det projektsidan som ljuger, eftersom den är
 * den som öppnas mest sällan.
 *
 * `null` när projektet inte finns eller inte är den inloggades att se. RLS har
 * redan avgjort det; funktionen upprepar inte frågan.
 */
export async function hamtaProjektvy(
  user: CurrentUser,
  id: string,
): Promise<{ projekt: Projekt; uppgifter: Uppgift[]; namn: Map<string, string>; idag: string } | null> {
  const bild = await hamtaUppgiftsbild(user);
  const projekt = bild.projekt.find((p) => p.id === id);
  if (!projekt) return null;

  return {
    projekt,
    uppgifter: bild.uppgifter.filter((u) => u.project_id === id),
    namn: bild.namn,
    idag: bild.idag,
  };
}

// -----------------------------------------------------------------------------
// Projektchatten (0055)
// -----------------------------------------------------------------------------

export type Chattmeddelande = {
  id: string;
  author_id: string;
  namn: string;
  body: string;
  created_at: string;
};

/**
 * Samtalet i ett projekt.
 *
 * KAPAS VID TVÅHUNDRA, nyaste sist. En chattruta som laddar hela historiken
 * varje gång blir långsammare ju mer den används, och det är precis fel
 * riktning för en yta vars värde ligger i att man orkar öppna den. Det som
 * faller utanför är inte borta — det ligger kvar i tabellen — men en chatt är
 * inte ett arkiv, och den som letar efter något från i våras letar i uppgiften
 * och inte i samtalet.
 */
export async function hamtaProjektchatt(
  user: CurrentUser,
  projektId: string,
): Promise<{ meddelanden: Chattmeddelande[]; seenAt: string | null }> {
  if (!user.employee) return { meddelanden: [], seenAt: null };

  const supabase = await supabaseServer();

  const [{ data: rader }, { data: markering }] = await Promise.all([
    supabase
      .from("project_message")
      .select("id, author_id, body, created_at")
      .eq("project_id", projektId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("project_message_read")
      .select("seen_at")
      .eq("project_id", projektId)
      .eq("employee_id", user.employee.id)
      .maybeSingle(),
  ]);

  const poster = ((rader ?? []) as unknown as Omit<Chattmeddelande, "namn">[]).reverse();
  const namn = await namnkarta(supabase, [...new Set(poster.map((p) => p.author_id))]);

  return {
    meddelanden: poster.map((p) => ({ ...p, namn: namn.get(p.author_id) ?? "Okänd" })),
    seenAt: (markering?.seen_at as string | undefined) ?? null,
  };
}

/**
 * Olästa repliker, ett tal per projekt.
 *
 * ===========================================================================
 * EN POST PER PROJEKT OCH INTE PER MEDDELANDE
 *
 * Tio repliker i ett projekt ska ge "10 nya i Mässan", inte tio rader i
 * klockan. Det är hela skälet att `project_message_read` bär en tidpunkt i
 * stället för en rad per mottagare och meddelande — se rubriken i 0055.
 *
 * Härledd och inte händelse, av regeln i notiser.ts: oläst är ett TILLSTÅND
 * som står kvar tills någon gör något åt det. En händelsepost hade legat kvar
 * i klockan även efter att man läst tråden.
 *
 * EGNA REPLIKER RÄKNAS INTE. Den som just skrivit något har läst det.
 * ===========================================================================
 */
export async function projektchattnotiser(user: CurrentUser): Promise<Notis[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;

  const supabase = await supabaseServer();

  const [{ data: projekt }, { data: rader }, { data: markeringar }] = await Promise.all([
    supabase.from("project").select("id, name").is("archived_at", null),
    supabase.from("project_message").select("project_id, author_id, body, created_at"),
    supabase.from("project_message_read").select("project_id, seen_at").eq("employee_id", mig),
  ]);

  if ((projekt ?? []).length === 0 || (rader ?? []).length === 0) return [];

  const sedd = new Map<string, string>();
  for (const m of (markeringar ?? []) as { project_id: string; seen_at: string }[]) {
    sedd.set(m.project_id, m.seen_at);
  }

  const notiser: Notis[] = [];

  for (const p of (projekt ?? []) as { id: string; name: string }[]) {
    const nya = ((rader ?? []) as { project_id: string; author_id: string; body: string; created_at: string }[])
      .filter((m) => m.project_id === p.id && m.author_id !== mig)
      .filter((m) => {
        const sedan = sedd.get(p.id);
        return !sedan || m.created_at > sedan;
      })
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

    if (nya.length === 0) continue;

    const senaste = nya[nya.length - 1];

    notiser.push({
      id: notisId("projektchatt", p.id, nya.length),
      typ: "chatt",
      rubrik: nya.length === 1 ? `Ny replik i ${p.name}` : `${nya.length} nya repliker i ${p.name}`,
      // Den sista repliken i klartext. Att bara säga "3 nya" tvingar fram ett
      // klick för att ta reda på om det angår en.
      detalj: senaste.body.slice(0, 140),
      href: `/uppgifter/projekt/${p.id}`,
      tidpunkt: senaste.created_at,
      olast: true,
    });
  }

  return notiser;
}

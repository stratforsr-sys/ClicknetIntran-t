import { supabaseServer } from "@/lib/supabase/server";
import { canReadAllEmployees, fullName, type CurrentUser } from "@/lib/auth";
import { notisId, type Notis } from "@/lib/notiser";
import {
  LARMGRANS_DAGAR,
  PAMINNELSE_PERSON_DYGN,
  TYP_ETIKETT,
  arSjalvsann,
  dagarSedanCoachning,
  farKvittera,
  forsenad,
  grupperaOmgangar,
  lageFor,
  larmar,
  sorteraUppgifter,
  type Handelse,
  type Handelsetyp,
  type Uppgiftslage,
  type Uppgiftstyp,
  type Kvitterare,
  type Bevis,
} from "@/lib/coachning";

/**
 * Lasningen for coachningsmodulen.
 *
 * ALL FILTRERING SKER I DATABASEN. Vyerna nedan hamtar utan rollvillkor och
 * later RLS i 0043 avgora vem som ser vad — teamledaren sitt team, ledningen
 * alla, den anstallda sina egna. Ett andra filter i React hade varit ett andra
 * svar pa samma fraga, och den dagen de sager olika ar det React som vinner.
 * Samma linje som /utbildning/oversikt drog.
 */

export type Uppgiftsrad = {
  id: string;
  title: string;
  description_md: string;
  kind: Uppgiftstyp;
  assignee_id: string;
  partner_id: string | null;
  created_by: string;
  verify_by: Kvitterare;
  evidence: Bevis;
  due_date: string | null;
  starts_on: string | null;
  cancelled_at: string | null;
  course_id: string | null;
  module_id: string | null;
  document_id: string | null;
  /** Mallen respektive samtalet raden kom ur. Grupperar klockans nyheter. */
  template_id: string | null;
  session_id: string | null;
  created_at: string;
  handelser: Handelse[];
  lage: Uppgiftslage;
  forsenad: boolean;
  fokus: string[];
};

const UPPGIFTSFALT =
  "id, title, description_md, kind, assignee_id, partner_id, created_by, verify_by," +
  " evidence, due_date, starts_on, cancelled_at, course_id, module_id, document_id," +
  " template_id, session_id, created_at";

/**
 * Ar den har personen chef OVER den andra?
 *
 * Speglar `leads_employee()` i 0001: narmaste chef ELLER ledare for personens
 * team. Frageordningen ar densamma dar, och andras den dar maste den andras
 * har — annars sager gransnittet en sak och databasen en annan.
 *
 * Ledningen raknas alltid som chef. Det ar inte en genvag: `can_read_all_employees()`
 * ar samma krets i RLS, sa ett annat svar har hade betytt en knapp som syns men
 * inte fungerar.
 */
export async function arChefFor(user: CurrentUser | null, employeeId: string): Promise<boolean> {
  if (!user?.employee) return false;
  if (canReadAllEmployees(user)) return true;
  if (user.employee.id === employeeId) return false;

  const supabase = await supabaseServer();
  const [{ data: person }, { data: team }] = await Promise.all([
    supabase.from("employee").select("manager_id, team_id").eq("id", employeeId).maybeSingle(),
    supabase.from("team").select("id").eq("lead_id", user.employee.id),
  ]);

  if (!person) return false;
  if (person.manager_id === user.employee.id) return true;
  return Boolean(person.team_id && (team ?? []).some((t) => t.id === person.team_id));
}

/** Far den har personen alls oppna coachningsvyn som chef? */
export function farCoacha(user: CurrentUser | null): boolean {
  return Boolean(
    user?.employee &&
      (canReadAllEmployees(user) || user.roles.includes("team_lead")),
  );
}

// -----------------------------------------------------------------------------
// De sjalvsanna typernas kallor
// -----------------------------------------------------------------------------

type Kallor = {
  certifikat: Set<string>;   // `${employee_id}:${course_id}`
  godkanda: Set<string>;     // `${employee_id}:${module_id}`
  kvittenser: Set<string>;   // `${employee_id}:${document_id}`
};

const TOM_KALLA: Kallor = { certifikat: new Set(), godkanda: new Set(), kvittenser: new Set() };

/**
 * Hamtar certifikaten, rollspelsbedomningarna och rutinkvittenserna som avgor
 * om en sjalvsann uppgift ar klar.
 *
 * BARA DE ID:N SOM FAKTISKT FOREKOMMER FRAGAS EFTER. En coachningsuppgift som
 * pekar pa en kurs ingen har tilldelats ska inte dra in hela certifikatsregistret
 * i fragan — vyn oppnas en gang per sidvisning och lasten vaxer med navet.
 *
 * ETT UTGANGET CERTIFIKAT RAKNAS INTE. Det ar samma regel som `kursLage()`
 * foljer, och den ar viktig har: en coachningsuppgift som blev klar for tva ar
 * sedan pa ett certifikat som gatt ut ska oppna sig igen.
 */
async function hamtaKallor(uppgifter: { kind: Uppgiftstyp; assignee_id: string; course_id: string | null; module_id: string | null; document_id: string | null }[]): Promise<Kallor> {
  const sjalvsanna = uppgifter.filter((u) => arSjalvsann(u.kind));
  if (sjalvsanna.length === 0) return TOM_KALLA;

  const supabase = await supabaseServer();
  const personer = [...new Set(sjalvsanna.map((u) => u.assignee_id))];
  const kurser = [...new Set(sjalvsanna.filter((u) => u.course_id).map((u) => u.course_id!))];
  const moduler = [...new Set(sjalvsanna.filter((u) => u.kind === "rollspel_inspelat" && u.module_id).map((u) => u.module_id!))];
  const dokument = [...new Set(sjalvsanna.filter((u) => u.document_id).map((u) => u.document_id!))];

  /**
   * Fragorna stalls ALLTID, aven med tomma id-listor.
   *
   * Forsta utkastet hoppade over dem med en ternar och `Promise.resolve` — och
   * det gav en unionstyp dar `.data` betydde tva olika saker, vilket TypeScript
   * inte gar med pa. Ett tomt `in.()` kostar en tur men ar ETT svar med EN typ,
   * och funktionen har redan returnerat ovanfor nar det inte finns nagot
   * sjalvsant alls.
   */
  const [cert, forsok, ack, dok] = await Promise.all([
    supabase.from("certification").select("employee_id, course_id, expires_at").in("employee_id", personer).in("course_id", kurser),
    supabase.from("course_attempt").select("employee_id, module_id, passed").in("employee_id", personer).in("module_id", moduler).eq("passed", true),
    supabase.from("document_ack").select("employee_id, document_id, version").in("employee_id", personer).in("document_id", dokument),
    supabase.from("document").select("id, version").in("id", dokument),
  ]);

  const nu = new Date();
  const certifikat = new Set<string>();
  for (const c of cert.data ?? []) {
    if (c.expires_at && new Date(c.expires_at) <= nu) continue;
    certifikat.add(`${c.employee_id}:${c.course_id}`);
  }

  const godkanda = new Set<string>();
  for (const f of forsok.data ?? []) {
    if (f.module_id) godkanda.add(`${f.employee_id}:${f.module_id}`);
  }

  /**
   * KVITTENSEN GALLER EN VERSION, INTE ETT DOKUMENT. En rutin som skrivits om
   * ska kvitteras igen — det ar hela poangen med `document_ack.version` i 0003
   * — och da ska coachningsuppgiften oppna sig pa nytt i stallet for att sta
   * kvar som klar mot en text som inte langre finns.
   */
  const version = new Map((dok.data ?? []).map((d) => [d.id, d.version]));
  const kvittenser = new Set<string>();
  for (const a of ack.data ?? []) {
    if (version.get(a.document_id) === a.version) kvittenser.add(`${a.employee_id}:${a.document_id}`);
  }

  return { certifikat, godkanda, kvittenser };
}

function kallanKlar(u: { kind: Uppgiftstyp; assignee_id: string; course_id: string | null; module_id: string | null; document_id: string | null }, k: Kallor): boolean {
  switch (u.kind) {
    case "kurs":
      return Boolean(u.course_id && k.certifikat.has(`${u.assignee_id}:${u.course_id}`));
    case "rollspel_inspelat":
      return Boolean(u.module_id && k.godkanda.has(`${u.assignee_id}:${u.module_id}`));
    case "lasning":
      return Boolean(u.document_id && k.kvittenser.has(`${u.assignee_id}:${u.document_id}`));
    default:
      return false;
  }
}

// -----------------------------------------------------------------------------
// Uppgifterna
// -----------------------------------------------------------------------------

/**
 * Radtypen ur `coaching_task`.
 *
 * KASTEN GAR VIA `unknown`, OCH DET AR INTE SLARV. `UPPGIFTSFALT` ar en
 * hopslagen strang, och supabase-js harleder radtypen ur select-strangens
 * LITERAL — en konkatenering vidgas till `string` och ger `GenericStringError[]`
 * i stallet for kolumnerna. Bygget foll pa exakt det 2026-09-01.
 *
 * Alternativet vore en enda lang literal, men da ligger faltlistan pa fyra
 * stallen i stallet for ett, och den dagen en kolumn tillkommer glider de isar.
 * Formen kontrolleras i stallet av `bygg()`, som ar det enda stallet raderna
 * lases.
 */
type Rad = Record<string, unknown>;

async function bygg(rader: Rad[], nu: Date): Promise<Uppgiftsrad[]> {
  if (rader.length === 0) return [];
  const supabase = await supabaseServer();
  const ids = rader.map((r) => String(r.id));

  const [{ data: handelser }, { data: fokus }] = await Promise.all([
    // `by_employee_id` hamtas har och inte i en andra fraga fran vyerna:
    // historiken pa personkortet skriver ut VEM som kvitterade, och den som
    // hade slagit upp det per rad hade stallt en fraga per uppgift.
    supabase.from("coaching_task_event").select("task_id, type, at, by_employee_id").in("task_id", ids),
    supabase
      .from("coaching_task_focus")
      .select("task_id, coaching_focus(label)")
      .in("task_id", ids),
  ]);

  const perUppgift = new Map<string, Handelse[]>();
  for (const h of handelser ?? []) {
    const lista = perUppgift.get(h.task_id) ?? [];
    lista.push({ type: h.type as Handelse["type"], at: h.at, by: h.by_employee_id });
    perUppgift.set(h.task_id, lista);
  }

  const fokusPer = new Map<string, string[]>();
  for (const f of (fokus ?? []) as unknown as { task_id: string; coaching_focus: { label: string } | null }[]) {
    if (!f.coaching_focus) continue;
    fokusPer.set(f.task_id, [...(fokusPer.get(f.task_id) ?? []), f.coaching_focus.label]);
  }

  const kallor = await hamtaKallor(rader as never);

  return rader.map((r) => {
    const u = r as unknown as Omit<Uppgiftsrad, "handelser" | "lage" | "forsenad" | "fokus">;
    const h = perUppgift.get(u.id) ?? [];
    const lage = lageFor({
      kind: u.kind,
      handelser: h,
      kallanKlar: kallanKlar(u, kallor),
      cancelledAt: u.cancelled_at,
    });
    return {
      ...u,
      handelser: h,
      lage,
      forsenad: forsenad(lage, u.due_date, nu),
      fokus: fokusPer.get(u.id) ?? [],
    };
  });
}

export async function uppgifterFor(employeeId: string, nu = new Date()): Promise<Uppgiftsrad[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("coaching_task")
    .select(UPPGIFTSFALT)
    .eq("assignee_id", employeeId)
    .order("due_date", { nullsFirst: false });
  return bygg((data ?? []) as unknown as Rad[], nu);
}

export async function uppgift(id: string, nu = new Date()): Promise<Uppgiftsrad | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("coaching_task").select(UPPGIFTSFALT).eq("id", id).maybeSingle();
  if (!data) return null;
  return (await bygg([data as unknown as Rad], nu))[0] ?? null;
}

// -----------------------------------------------------------------------------
// Lagvyn
// -----------------------------------------------------------------------------

/** En oppen uppgift sedd fran lagvyn: raden plus svaret pa "kan JAG kvittera den?". */
export type Lagsuppgift = Uppgiftsrad & { kraverDinBock: boolean };

export type Lagperson = {
  employee_id: string;
  namn: string;
  team_id: string | null;
  team: string | null;
  status: string;
  /** Forvalt startdatum nar en mall tillamps fran lagvyn. */
  start_date: string | null;
  dagarSedan: number | null;
  forsenade: number;
  oppna: number;
  fokus: string[];
  /**
   * DE OPPNA UPPGIFTERNA, INTE BARA ANTALET.
   *
   * Fram till 2026-09-02 raknade den har funktionen fram `oppna` och slangde
   * raderna. Det var ett underligt val: den dyra delen — att hamta varje uppgift,
   * varje handelse och varje sjalvsann kalla och rakna fram ett lage — gjordes
   * anda, och sedan kastades allt utom en siffra. Chefen fick klicka in pa var
   * person for att se vad siffran bestod av.
   *
   * Att bara behalla listan kostar noll extra fragor.
   */
  uppgifter: Lagsuppgift[];
  /** Inlamningar som vantar pa just den inloggades bock. */
  vantarPaMig: number;
};

/**
 * VAD SOM RAKNAS SOM COACHNING.
 *
 * Att nagon LADE UPP en uppgift ar inte coachning. Rakas det med hade en chef
 * kunnat nolla sin egen siffra genom att skapa tio uppgifter och aldrig folja
 * upp dem — och siffran finns just for att den chefen ska synas.
 *
 * Det som raknas ar att nagot HANDE: en kvittering, en bedomning, eller ett
 * hallet coachningssamtal. `tilldelad` star darfor inte med i listan.
 */
const RAKNAS_SOM_COACHNING = ["kvitterad", "underkand", "inlamnad"];

/**
 * @param betraktareId Den inloggades employee-id. Avgor vilka inlamningar som
 *   markeras som "vantar pa din bock". Utelamnas den markeras ingen.
 */
export async function hamtaLag(nu = new Date(), betraktareId?: string): Promise<Lagperson[]> {
  const supabase = await supabaseServer();

  const [{ data: personal }, { data: uppgifter }, { data: samtal }, { data: lag }] = await Promise.all([
    supabase
      .from("employee")
      .select("id, first_name, last_name, team_id, status, start_date")
      .neq("status", "offboarded")
      .order("first_name"),
    supabase.from("coaching_task").select(UPPGIFTSFALT),
    supabase.from("coaching_session").select("employee_id, held_on"),
    supabase.from("team").select("id, name"),
  ]);

  const teamnamn = new Map((lag ?? []).map((t) => [t.id, t.name as string]));

  const byggda = await bygg((uppgifter ?? []) as unknown as Rad[], nu);

  const perPerson = new Map<string, Uppgiftsrad[]>();
  for (const u of byggda) {
    perPerson.set(u.assignee_id, [...(perPerson.get(u.assignee_id) ?? []), u]);
  }

  return (personal ?? []).map((p) => {
    const mina = perPerson.get(p.id) ?? [];
    const oppna = mina.filter((u) => u.lage !== "klar" && u.lage !== "avbruten");

    /**
     * Handelserna och samtalen slas ihop till EN tidslinje innan avstandet
     * raknas. Tva separata "senast"-tal hade krävt att vyn valjer det minsta,
     * och det valet ar precis vad funktionen finns for att gora.
     */
    const rorelser: { at: string }[] = [
      ...mina.flatMap((u) => u.handelser.filter((h) => RAKNAS_SOM_COACHNING.includes(h.type)).map((h) => ({ at: h.at }))),
      ...(samtal ?? []).filter((s) => s.employee_id === p.id).map((s) => ({ at: `${s.held_on}T12:00:00Z` })),
    ];

    /**
     * `arChef = true` skickas in med flit.
     *
     * Lagvyn visar bara personer RLS slappt fram, och de raderna kommer ur
     * `leads_employee()` eller `can_read_all_employees()` — samma tva villkor
     * som `arChefFor()` svarar ja pa. Att sla upp chefskapet en gang per person
     * hade varit en databasfraga per kort for att fa fram ett svar vi redan har.
     *
     * Den inloggades EGET kort ritas inte i rutnatet (sidan lyfter ur det), sa
     * fallet "chef over sig sjalv" uppstar aldrig har.
     */
    const uppgifter = sorteraUppgifter(
      oppna.map((u) => ({
        ...u,
        kraverDinBock:
          u.lage === "inlamnad" &&
          betraktareId !== undefined &&
          farKvittera(u, betraktareId, true),
      })),
    );

    return {
      employee_id: p.id,
      namn: fullName(p),
      team_id: p.team_id,
      team: p.team_id ? (teamnamn.get(p.team_id) ?? null) : null,
      status: p.status,
      start_date: p.start_date ?? null,
      dagarSedan: dagarSedanCoachning(rorelser, nu),
      forsenade: oppna.filter((u) => u.forsenad).length,
      oppna: oppna.length,
      fokus: [...new Set(oppna.flatMap((u) => u.fokus))],
      uppgifter,
      vantarPaMig: uppgifter.filter((u) => u.kraverDinBock).length,
    };
  });
}

// -----------------------------------------------------------------------------
// Personkortet
// -----------------------------------------------------------------------------

export type Kvomrade = { label: string; senaste: number | null; tak: number | null };

/**
 * K&V-utfallet per omrade for en person — den halva av slingan som visar OM
 * coachningen flyttade nagot.
 *
 * Bara omraden som ar lankade till ett `kv_criterion` far ett tal. For en
 * projektledare ar listan tom, och det ar ratt: hennes fokusomraden mats inte i
 * K&V, och en nolla hade sett ut som ett dalig resultat i stallet for som en
 * matning som inte finns.
 */
export async function kvPerOmrade(employeeId: string): Promise<Kvomrade[]> {
  const supabase = await supabaseServer();

  const { data: fokus } = await supabase
    .from("coaching_focus")
    .select("label, sort, kv_criterion_id")
    .eq("active", true)
    .not("kv_criterion_id", "is", null)
    .order("sort");

  if (!fokus || fokus.length === 0) return [];

  const { data: samtal } = await supabase
    .from("kv_call")
    .select("id, call_date")
    .eq("employee_id", employeeId)
    .order("call_date", { ascending: false })
    .limit(1);

  const senaste = samtal?.[0];
  if (!senaste) return fokus.map((f) => ({ label: f.label, senaste: null, tak: null }));

  const [{ data: poang }, { data: kriterier }] = await Promise.all([
    supabase.from("kv_score").select("criterion_id, points").eq("call_id", senaste.id),
    supabase.from("kv_criterion").select("id, max_points"),
  ]);

  const per = new Map((poang ?? []).map((p) => [p.criterion_id, Number(p.points)]));
  const tak = new Map((kriterier ?? []).map((k) => [k.id, k.max_points === null ? null : Number(k.max_points)]));

  return fokus.map((f) => ({
    label: f.label,
    senaste: per.get(f.kv_criterion_id!) ?? null,
    tak: tak.get(f.kv_criterion_id!) ?? null,
  }));
}

export type Samtalsrad = {
  id: string;
  held_on: string;
  coach_id: string;
  goal_md: string;
  reality_md: string;
  options_md: string;
  will_md: string;
};

export async function samtalFor(employeeId: string): Promise<Samtalsrad[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("coaching_session")
    .select("id, held_on, coach_id, goal_md, reality_md, options_md, will_md")
    .eq("employee_id", employeeId)
    .order("held_on", { ascending: false });
  return (data ?? []) as Samtalsrad[];
}

// -----------------------------------------------------------------------------
// Tidslinjen
// -----------------------------------------------------------------------------

export type Tidslinjeslag = "uppgift" | "samtal" | "rollspel" | "kurs" | "certifikat" | "kv";

export type Tidslinjepost = {
  nyckel: string;
  /** ISO-tidpunkt. Sorteringen ar fallande pa den har och ingenting annat. */
  at: string;
  slag: Tidslinjeslag;
  rubrik: string;
  detalj: string | null;
  /** employee_id pa den som gjorde det. Namnet slas upp av vyn. */
  av: string | null;
  href: string | null;
  ton: "ok" | "warn" | "danger" | "info" | "neutral";
};

/** Handelser som INTE hor hemma i tidslinjen, och varfor. */
const TYST_HANDELSE: Handelsetyp[] = [
  // "Paborjad" ar ett klick, inte en handelse. Den som oppnar en uppgift har
  // inte gjort nagot an, och en tidslinje dar varje oppnande star med begraver
  // de tva rader som faktiskt betyder nagot.
  "paborjad",
];

const HANDELSE_RUBRIK: Record<Handelsetyp, string> = {
  tilldelad: "Fick uppgiften",
  paborjad: "Påbörjade",
  inlamnad: "Lämnade in",
  kvitterad: "Klarade",
  underkand: "Underkänd på",
  avbruten: "Avbruten",
};

const HANDELSE_TON: Record<Handelsetyp, Tidslinjepost["ton"]> = {
  tilldelad: "neutral",
  paborjad: "neutral",
  inlamnad: "warn",
  kvitterad: "ok",
  underkand: "danger",
  avbruten: "neutral",
};

/**
 * HELA BILDEN AV EN PERSONS UTVECKLING, I KRONOLOGISK ORDNING.
 *
 * Utredningens avsnitt 3.2 beskrev den har vyn men fas 1 byggde den inte:
 * uppgifterna lag i en lista, samtalen i en annan, certifikaten pa en helt
 * annan sida. Det gick att se VAD nagon har gjort, men inte NAR — och en
 * coachningshistorik utan tidsaxel svarar inte pa den enda fraga den finns for:
 * hande det nagot efter forra samtalet?
 *
 * SEX KALLOR, INGEN NY TABELL. Varje post raknas fram ur en rad som redan
 * finns. Det ar samma linje som resten av modulen: dar sanningen bor nagon
 * annanstans hamtas den darifran, och en kopia sparas aldrig.
 *
 * RLS AVGOR VAD SOM KOMMER UT, och det syns i vyn. Tydligast pa `kv_call`, som
 * bara ar lasbar for personen sjalv och for dem som hanterar provisionen
 * (0036) — en teamledare far darfor en tidslinje UTAN K&V-samtal, och det ar
 * ratt svar och inte ett fel. Alternativet hade varit att vidga
 * behorigheten for att fa en snyggare vy.
 */
export async function tidslinjeFor(employeeId: string, grans = 120): Promise<Tidslinjepost[]> {
  const supabase = await supabaseServer();

  const [uppgifter, samtal] = await Promise.all([uppgifterFor(employeeId), samtalFor(employeeId)]);

  const [{ data: inlamningar }, { data: forsok }, { data: certifikat }, { data: kvsamtal }] =
    await Promise.all([
      supabase
        .from("roleplay_submission")
        .select("id, module_id, submitted_at, graded_at, graded_by")
        .eq("employee_id", employeeId),
      supabase
        .from("course_attempt")
        .select("id, course_id, module_id, score, passed, created_at, graded_by")
        .eq("employee_id", employeeId),
      supabase
        .from("certification")
        .select("id, course_id, issued_at, expires_at")
        .eq("employee_id", employeeId),
      supabase
        .from("kv_call")
        .select("id, call_date, customer")
        .eq("employee_id", employeeId),
    ]);

  // Rubrikerna slas upp i EN omgang for alla kallor tillsammans. Ett uppslag per
  // rad hade blivit trettio fragor pa ett kort med tre ars historik.
  const kursIds = [
    ...new Set(
      [...(forsok ?? []).map((f) => f.course_id), ...(certifikat ?? []).map((c) => c.course_id)].filter(
        Boolean,
      ) as string[],
    ),
  ];
  const modulIds = [
    ...new Set(
      [...(inlamningar ?? []).map((i) => i.module_id), ...(forsok ?? []).map((f) => f.module_id)].filter(
        Boolean,
      ) as string[],
    ),
  ];

  const [{ data: kurser }, { data: moduler }, { data: poang }] = await Promise.all([
    supabase.from("course").select("id, title, slug").in("id", kursIds),
    supabase.from("course_module").select("id, title").in("id", modulIds),
    supabase
      .from("kv_score")
      .select("call_id, points")
      .in("call_id", (kvsamtal ?? []).map((k) => k.id)),
  ]);

  const kurs = new Map((kurser ?? []).map((k) => [k.id, { titel: k.title as string, slug: k.slug as string }]));
  const modul = new Map((moduler ?? []).map((m) => [m.id, m.title as string]));

  const kvPoang = new Map<string, number>();
  for (const p of poang ?? []) {
    kvPoang.set(p.call_id, (kvPoang.get(p.call_id) ?? 0) + Number(p.points));
  }

  const poster: Tidslinjepost[] = [];

  for (const u of uppgifter) {
    for (const [i, h] of u.handelser.entries()) {
      if (TYST_HANDELSE.includes(h.type)) continue;
      poster.push({
        nyckel: `uppgift:${u.id}:${i}`,
        at: h.at,
        slag: "uppgift",
        rubrik: `${HANDELSE_RUBRIK[h.type]}: ${u.title}`,
        detalj: TYP_ETIKETT[u.kind],
        av: h.by ?? null,
        href: `/coachning/uppgift/${u.id}`,
        ton: HANDELSE_TON[h.type],
      });
    }
  }

  for (const s of samtal) {
    poster.push({
      nyckel: `samtal:${s.id}`,
      // `held_on` ar ett datum utan klockslag. Middag valjs sa att samtalet
      // hamnar mitt bland dagens ovriga poster i stallet for att alltid ligga
      // forst (00:00) eller sist (23:59) — vilket hade sett ut som en ordning.
      at: `${s.held_on}T12:00:00Z`,
      slag: "samtal",
      rubrik: "Coachningssamtal",
      detalj: s.will_md ? `Slutsats: ${s.will_md}` : null,
      av: s.coach_id,
      href: null,
      ton: "info",
    });
  }

  for (const i of inlamningar ?? []) {
    const titel = modul.get(i.module_id) ?? "Rollspel";
    poster.push({
      nyckel: `rollspel-in:${i.id}`,
      at: i.submitted_at,
      slag: "rollspel",
      rubrik: `Lämnade in rollspel: ${titel}`,
      detalj: null,
      av: null,
      href: null,
      ton: "warn",
    });
    if (i.graded_at) {
      poster.push({
        nyckel: `rollspel-bed:${i.id}`,
        at: i.graded_at,
        slag: "rollspel",
        rubrik: `Rollspel bedömt: ${titel}`,
        detalj: null,
        av: i.graded_by,
        href: null,
        ton: "info",
      });
    }
  }

  for (const f of forsok ?? []) {
    const titel = (f.module_id && modul.get(f.module_id)) || kurs.get(f.course_id)?.titel || "Kurs";
    poster.push({
      nyckel: `forsok:${f.id}`,
      at: f.created_at,
      slag: "kurs",
      rubrik: `${f.passed ? "Godkänd" : "Underkänd"}: ${titel}`,
      detalj: `${f.score} %`,
      av: f.graded_by,
      href: kurs.get(f.course_id) ? `/utbildning/${kurs.get(f.course_id)!.slug}` : null,
      ton: f.passed ? "ok" : "danger",
    });
  }

  const nu = new Date();
  for (const c of certifikat ?? []) {
    const k = kurs.get(c.course_id);
    const utgangen = Boolean(c.expires_at && new Date(c.expires_at) <= nu);
    poster.push({
      nyckel: `cert:${c.id}`,
      at: c.issued_at,
      slag: "certifikat",
      rubrik: `Certifierad: ${k?.titel ?? "Kurs"}`,
      // Ett utganget certifikat sags med ord pa den rad det galler. Att bara
      // rita det gratt hade brutit AC-U5.2, och att utelamna det hade gjort
      // tidslinjen till en lista over saker som en gang var sanna.
      detalj: c.expires_at ? (utgangen ? `Gick ut ${c.expires_at.slice(0, 10)}` : `Giltigt till ${c.expires_at.slice(0, 10)}`) : null,
      av: null,
      href: k ? `/utbildning/${k.slug}` : null,
      ton: utgangen ? "warn" : "ok",
    });
  }

  for (const k of kvsamtal ?? []) {
    const summa = kvPoang.get(k.id);
    poster.push({
      nyckel: `kv:${k.id}`,
      at: `${k.call_date}T12:00:00Z`,
      slag: "kv",
      rubrik: `K&V-samtal: ${k.customer}`,
      detalj: summa === undefined ? "Ej bedömt" : `${summa} poäng`,
      av: null,
      href: `/kv/${k.id}`,
      ton: summa === undefined ? "neutral" : "info",
    });
  }

  return poster.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, grans);
}

/** Namnen som vyerna behover for att skriva ut vem som ar vem. */
export async function namnkarta(ids: string[]): Promise<Map<string, string>> {
  const unika = [...new Set(ids.filter(Boolean))];
  if (unika.length === 0) return new Map();
  const supabase = await supabaseServer();
  const { data } = await supabase.from("employee").select("id, first_name, last_name").in("id", unika);
  return new Map((data ?? []).map((e) => [e.id, fullName(e)]));
}

export async function fokusomraden(): Promise<{ id: string; label: string }[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("coaching_focus")
    .select("id, label")
    .eq("active", true)
    .order("sort");
  return data ?? [];
}

// -----------------------------------------------------------------------------
// Klockan
// -----------------------------------------------------------------------------

/**
 * Coachningens poster i notisklockan.
 *
 * LIGGER HAR OCH INTE I `notiser-server.ts`, med flit. Den filen ar redan 645
 * rader och hamtar tjugo tabeller i ETT destrukturerat `Promise.all` — en ny
 * gren mitt i det hade varit fyra andringar i en lista dar ordningen betyder
 * allt. Klockan anropar i stallet den har funktionen med en rad.
 *
 * Posterna RAKNAS FRAM, de lagras inte. Det ar 0018:s linje: en notistabell
 * kraver att varje producent kommer ihag att skriva sin rad, och den som
 * glommer ger en tyst lucka.
 *
 * TRAPPAN AR SYSTEMGUIDERNAS, inte en egen. 3 dygn utan rorelse till personen,
 * 7 till chefen. Tva olika trappor i samma nav hade betytt att en paminnelse
 * inte langre sager nagot om hur bradskande saken ar.
 */
export async function coachningsnotiser(user: CurrentUser): Promise<Notis[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;
  const nu = new Date();

  const supabase = await supabaseServer();
  const [{ data: rader }, { data: samtal }] = await Promise.all([
    supabase.from("coaching_task").select(UPPGIFTSFALT).is("cancelled_at", null),
    supabase.from("coaching_session").select("employee_id, held_on"),
  ]);

  const uppgifter = await bygg((rader ?? []) as unknown as Rad[], nu);
  const oppna = uppgifter.filter((u) => u.lage !== "klar" && u.lage !== "avbruten");
  if (oppna.length === 0 && !farCoacha(user)) return [];

  const notiser: Notis[] = [];
  const namn = await namnkarta([
    ...oppna.map((u) => u.assignee_id),
    ...oppna.map((u) => u.created_by),
  ]);

  /** Nyss upplagda uppgifter som ar mina. Blir poster langre ner, i omgangar. */
  const nya: Uppgiftsrad[] = [];

  /**
   * MIN EGEN PAMINNELSE. Bara nar det faktiskt star still — den som arbetar med
   * en uppgift i dag ska inte samtidigt fa en notis om att hon inte gjort den.
   *
   * Tidpunkten ar senaste rorelsen, och den ar inte kosmetisk: en post utan
   * tidpunkt filtreras bort langst ner i `hamtaNotiser`, och en paminnelse som
   * aldrig syns ar samre an ingen.
   *
   * ID:T BAR ANTALET VECKOR, sa posten aterupstar en gang i veckan for den som
   * klickat bort den och fortfarande inte gjort nagot at saken.
   */
  for (const u of oppna.filter((u) => u.assignee_id === mig)) {
    const senast = senasteRorelse(u) ?? u.created_at;
    const stilla = Math.floor((nu.getTime() - Date.parse(senast)) / 86_400_000);
    const underkand = u.lage === "underkand";

    /**
     * NY UPPGIFT — ETT BESKED, INTE EN PAMINNELSE.
     *
     * Fram till 2026-09-02 var klockan TYST i tre dygn efter att en uppgift
     * lagts upp. Det foljde av paminnelseregeln nedan, som mater stillestand:
     * en uppgift som just skapats har statt still i noll dagar och slapptes
     * darfor igenom. Foljden var att den som fick en uppgift inte fick veta
     * det — hon fick veta det tre dagar senare, formulerat som en tillsagelse
     * om nagot hon inte hunnit gora.
     *
     * Beskedet ar darfor en EGEN post med en egen kalla. Den star sa lange
     * uppgiften ar orord och yngre an paminnelsetrappans forsta steg, och
     * lamnar sedan over till paminnelsen utan lucka och utan overlapp.
     *
     * ID:T BAR INGEN RAKNARE. En ny uppgift blir ny en gang. Den som klickar
     * bort beskedet har last det, och att lata det ateruppsta hade gjort en
     * upplysning till en gnallspik — paminnelsen nedan tar over den rollen.
     */
    if (u.lage === "ej_paborjad" && stilla < PAMINNELSE_PERSON_DYGN) {
      // Samlas, skrivs inte. Vilken post de blir avgors av hur MANGA de ar,
      // och det gar inte att veta mitt i slingan som producerar dem.
      nya.push(u);
      continue;
    }

    // En underkand uppgift sager till DIREKT. Den ar inte en paminnelse om
    // nagot ogjort utan ett besked fran en manniska, och att vanta tre dygn med
    // det hade varit att dolja att nagon faktiskt tittat.
    if (!underkand && stilla < PAMINNELSE_PERSON_DYGN) continue;

    notiser.push({
      id: notisId("coachning", u.id, underkand ? "u" : Math.floor(stilla / 7)),
      typ: "coachning",
      rubrik: underkand ? `Underkänd: ${u.title}` : u.title,
      detalj: underkand
        ? "Läs återkopplingen och gör om"
        : [
            TYP_ETIKETT[u.kind],
            u.forsenad ? "försenad" : u.due_date ? `klar senast ${u.due_date}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
      href: `/coachning/uppgift/${u.id}`,
      tidpunkt: senast,
      olast: true,
    });
  }

  /**
   * NYA UPPGIFTER — EN POST PER OMGANG, INTE PER UPPGIFT.
   *
   * En rampplan lagger upp tolv uppgifter pa en knapptryckning och ett
   * GROW-samtal fyra atagandan. Som tolv poster i klockan ar det inte tolv
   * besked utan ett besked som skriker, och den som moter det slutar oppna
   * klockan — vilket kostar de poster som faktiskt bar nagot bradskande.
   *
   * En omgang pa EN uppgift ar ingen omgang. "Du har fatt 1 ny uppgift" sager
   * mindre an uppgiftens egen rubrik, sa den posten ser ut precis som den
   * handpalagda uppgiftens.
   *
   * ID:T BAR OMGANGEN, INTE UPPGIFTERNA. Bockar saljaren av tre av tolv krymper
   * posten till nio — men det ar samma post, med samma id, och den forblir
   * bortklickad for den som redan last den. Ett id raknat pa antalet hade latit
   * nyheten ateruppsta varje gang hon gjorde nagot at den.
   */
  const omgangar = grupperaOmgangar(nya);
  const flerpost = omgangar.filter((o) => o.uppgifter.length > 1);

  /**
   * Mallnamnen slas upp bara nar det FINNS en omgang att namnge.
   *
   * "Från Ny säljare vecka 1–4" ar hela skillnaden mot "Från en mall": det
   * forsta sager vad som hant, det andra sager att nagot hant. Men fragan ar
   * ovardig att stalla pa varje sidvisning for de allra flesta, som inte har
   * nagon fardig omgang liggande.
   */
  const mallnamn = new Map<string, string>();
  const mallIds = [...new Set(flerpost.map((o) => o.uppgifter[0].template_id).filter(Boolean) as string[])];
  if (mallIds.length > 0) {
    const { data: mallar } = await supabase.from("coaching_template").select("id, name").in("id", mallIds);
    for (const m of mallar ?? []) mallnamn.set(m.id, m.name as string);
  }

  for (const omgang of omgangar) {
    const forsta = omgang.uppgifter[0];
    const enda = omgang.uppgifter.length === 1;

    // Narmaste frist i omgangen. Uppgifter utan frist raknas inte med — de
    // brinner inte, och en tom sortering hade gett dem forsta platsen.
    const frister = omgang.uppgifter.map((u) => u.due_date).filter(Boolean) as string[];
    const narmast = frister.length > 0 ? frister.reduce((a, b) => (a < b ? a : b)) : null;

    const varifran = forsta.template_id
      ? `Från "${mallnamn.get(forsta.template_id) ?? "en rampplan"}"`
      : forsta.session_id
        ? "Från ert coachningssamtal"
        : `Upplagd av ${namn.get(forsta.created_by) ?? "din chef"}`;

    notiser.push({
      /**
       * OMGANGENS ID BYGGS AV KALLAN OCH ETT TAL, inte av `omgang.nyckel`.
       *
       * Nyckeln bar tidsstampeln i sitt ratta format — `2026-09-02T08:18:28.12+00:00`
       * — och den innehaller bade kolon, punkt och plus. `arNotisId()` slapper
       * bara igenom siffror, bokstaver och bindestreck, sa ett id byggt pa
       * nyckeln hade sett riktigt ut och tyst vagrat avfardas. Millisekunderna
       * ar lika unika och bara siffror.
       */
      id: enda
        ? notisId("coachning-ny", forsta.id)
        : notisId(
            "coachning-ny",
            forsta.template_id ?? forsta.session_id!,
            Date.parse(forsta.created_at),
          ),
      typ: "coachning",
      rubrik: enda ? `Ny uppgift: ${forsta.title}` : `Du har fått ${omgang.uppgifter.length} nya uppgifter`,
      detalj: [varifran, narmast ? `närmaste ${enda ? "frist" : "förfallodag"} ${narmast}` : null]
        .filter(Boolean)
        .join(" · "),
      // En omgang pekar pa personkortet, dar alla tolv star. En ensam uppgift
      // pekar pa sig sjalv — en mellanlandning for att lasa en rad ar ett klick
      // for mycket.
      href: enda ? `/coachning/uppgift/${forsta.id}` : `/coachning/${mig}`,
      // Tidpunkten ar tilldelningen och inte "nu": posten ska hamna pa sin
      // plats i klockans ordning, och en nyss upplagd uppgift ligger da
      // overst av sig sjalv.
      tidpunkt: forsta.created_at,
      olast: true,
    });
  }

  /**
   * VANTAR PA MIN BOCK. Fragan stalls med `farKvittera()` — samma funktion som
   * sidan och som server action anvander, sa en post i klockan betyder alltid en
   * knapp som faktiskt fungerar.
   *
   * `arChef` skickas som falskt har med flit. Den som kvitterar pa rollen `chef`
   * far raden via lagvyn i stallet; att slå upp chefskapet per uppgift hade
   * betytt en databasfraga per rad i en klocka som redan staller sjutton.
   */
  for (const u of oppna.filter((u) => u.lage === "inlamnad" && u.assignee_id !== mig)) {
    if (!farKvittera(u, mig, false)) continue;
    const senast = senasteRorelse(u) ?? u.created_at;
    notiser.push({
      // Inlamningens tidpunkt gor id:t nytt vid varje ny inlamning, sa en
      // omgjord uppgift dyker upp igen aven for den som klickat bort forra.
      id: notisId("coachning-kvittering", u.id, Date.parse(senast)),
      typ: "coachning",
      rubrik: `${namn.get(u.assignee_id) ?? "Någon"} väntar på din kvittering`,
      detalj: u.title,
      href: `/coachning/uppgift/${u.id}`,
      tidpunkt: senast,
      olast: true,
    });
  }

  /**
   * U3. CHEFENS RAD — den matning som faktiskt andrar nagot, och den andrar
   * beteendet hos chefen och inte hos den som coachas.
   *
   * Raknas ur samma tidslinje som lagvyn: kvitteringar, bedomningar och hallna
   * samtal. Att nagon LADE UPP en uppgift raknas inte, annars hade raden gatt
   * att tysta genom att skapa uppgifter man aldrig foljer upp.
   */
  if (farCoacha(user)) {
    const perPerson = new Map<string, { at: string }[]>();
    for (const u of uppgifter) {
      if (u.assignee_id === mig) continue;
      const lista = perPerson.get(u.assignee_id) ?? [];
      for (const h of u.handelser) {
        if (RAKNAS_SOM_COACHNING.includes(h.type)) lista.push({ at: h.at });
      }
      perPerson.set(u.assignee_id, lista);
    }
    for (const s of samtal ?? []) {
      if (s.employee_id === mig) continue;
      const lista = perPerson.get(s.employee_id) ?? [];
      lista.push({ at: `${s.held_on}T12:00:00Z` });
      perPerson.set(s.employee_id, lista);
    }

    for (const [personId, rorelser] of perPerson) {
      const dagar = dagarSedanCoachning(rorelser, nu);
      if (!larmar(dagar)) continue;
      const veckor = dagar === null ? 0 : Math.floor(dagar / 7);
      notiser.push({
        id: notisId("coachning-team", personId, veckor),
        typ: "coachning",
        rubrik: `${namn.get(personId) ?? "En medarbetare"} har inte coachats`,
        detalj: dagar === null ? "Ingen coachning alls är bokförd" : `Senast för ${dagar} dagar sedan`,
        href: `/coachning/${personId}`,
        tidpunkt:
          dagar === null
            ? new Date(nu.getTime() - LARMGRANS_DAGAR * 86_400_000).toISOString()
            : new Date(nu.getTime() - dagar * 86_400_000).toISOString(),
        olast: true,
      });
    }
  }

  return notiser;
}

/** Senaste handelsen pa en uppgift, oavsett sort. Null om ingen finns. */
function senasteRorelse(u: Uppgiftsrad): string | null {
  if (u.handelser.length === 0) return null;
  return u.handelser.reduce((a, b) => (a.at > b.at ? a : b)).at;
}

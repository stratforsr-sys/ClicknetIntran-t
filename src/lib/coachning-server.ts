import { supabaseServer } from "@/lib/supabase/server";
import { canReadAllEmployees, fullName, type CurrentUser } from "@/lib/auth";
import {
  arSjalvsann,
  dagarSedanCoachning,
  forsenad,
  lageFor,
  type Handelse,
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
  created_at: string;
  handelser: Handelse[];
  lage: Uppgiftslage;
  forsenad: boolean;
  fokus: string[];
};

const UPPGIFTSFALT =
  "id, title, description_md, kind, assignee_id, partner_id, created_by, verify_by," +
  " evidence, due_date, starts_on, cancelled_at, course_id, module_id, document_id, created_at";

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

  const [cert, forsok, ack, dok] = await Promise.all([
    kurser.length
      ? supabase.from("certification").select("employee_id, course_id, expires_at").in("employee_id", personer).in("course_id", kurser)
      : Promise.resolve({ data: [] as { employee_id: string; course_id: string; expires_at: string | null }[] }),
    moduler.length
      ? supabase.from("course_attempt").select("employee_id, module_id, passed").in("employee_id", personer).in("module_id", moduler).eq("passed", true)
      : Promise.resolve({ data: [] as { employee_id: string; module_id: string | null }[] }),
    dokument.length
      ? supabase.from("document_ack").select("employee_id, document_id, version").in("employee_id", personer).in("document_id", dokument)
      : Promise.resolve({ data: [] as { employee_id: string; document_id: string; version: number }[] }),
    dokument.length
      ? supabase.from("document").select("id, version").in("id", dokument)
      : Promise.resolve({ data: [] as { id: string; version: number }[] }),
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

type Rad = Record<string, unknown>;

async function bygg(rader: Rad[], nu: Date): Promise<Uppgiftsrad[]> {
  if (rader.length === 0) return [];
  const supabase = await supabaseServer();
  const ids = rader.map((r) => String(r.id));

  const [{ data: handelser }, { data: fokus }] = await Promise.all([
    supabase.from("coaching_task_event").select("task_id, type, at").in("task_id", ids),
    supabase
      .from("coaching_task_focus")
      .select("task_id, coaching_focus(label)")
      .in("task_id", ids),
  ]);

  const perUppgift = new Map<string, Handelse[]>();
  for (const h of handelser ?? []) {
    const lista = perUppgift.get(h.task_id) ?? [];
    lista.push({ type: h.type as Handelse["type"], at: h.at });
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
  return bygg((data ?? []) as Rad[], nu);
}

export async function uppgift(id: string, nu = new Date()): Promise<Uppgiftsrad | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("coaching_task").select(UPPGIFTSFALT).eq("id", id).maybeSingle();
  if (!data) return null;
  return (await bygg([data as Rad], nu))[0] ?? null;
}

// -----------------------------------------------------------------------------
// Lagvyn
// -----------------------------------------------------------------------------

export type Lagperson = {
  employee_id: string;
  namn: string;
  team_id: string | null;
  status: string;
  dagarSedan: number | null;
  forsenade: number;
  oppna: number;
  fokus: string[];
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

export async function hamtaLag(nu = new Date()): Promise<Lagperson[]> {
  const supabase = await supabaseServer();

  const [{ data: personal }, { data: uppgifter }, { data: samtal }] = await Promise.all([
    supabase
      .from("employee")
      .select("id, first_name, last_name, team_id, status")
      .neq("status", "offboarded")
      .order("first_name"),
    supabase.from("coaching_task").select(UPPGIFTSFALT),
    supabase.from("coaching_session").select("employee_id, held_on"),
  ]);

  const byggda = await bygg((uppgifter ?? []) as Rad[], nu);

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

    return {
      employee_id: p.id,
      namn: fullName(p),
      team_id: p.team_id,
      status: p.status,
      dagarSedan: dagarSedanCoachning(rorelser, nu),
      forsenade: oppna.filter((u) => u.forsenad).length,
      oppna: oppna.length,
      fokus: [...new Set(oppna.flatMap((u) => u.fokus))],
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

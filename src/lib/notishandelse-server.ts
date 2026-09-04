import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { HANDELSEKALLOR, type Handelsekalla, type Notistyp } from "@/lib/notiser";
import type { Role, Permission } from "@/lib/roles";

/**
 * SKRIVVAGEN IN I KLOCKAN for det som HANDE nagon.
 *
 * ===========================================================================
 * DEN HAR FUNKTIONEN FAR ALDRIG KASTA
 *
 * Samma regel som `skrivHandelse()` och `skrivFel()`, och av samma skal:
 * anroparen ar en server action mitt i sitt riktiga arbete. En notis som inte
 * gar att skriva far inte bli felet som gor att ordern inte godkanns.
 *
 * Foljden ar att en trasig notis blir TYST, och det ar den obehagliga sidan av
 * valet. Motvikten ar `tests/notiser-tackning.mjs`: den faller nar en muterande
 * server action varken notifierar eller star med pa undantagslistan, sa en
 * glomd notis upptacks vid provet i stallet for av den som inte fick den.
 * ===========================================================================
 *
 * FILEN BAR INTE "use server". Allt som exporteras ur en sadan fil blir en
 * publik andpunkt, och `notifiera()` tar bade mottagare och rubrik som
 * argument — den hade alltsa latit vem som helst skriva vad som helst i vems
 * klocka som helst. Det har gatt fel tre ganger i det har repot forut
 * (`skrivFel`, `sattKvitto`, `registreraVisning`).
 */

export type Handelse = {
  /** Mottagaren. Ar den samma som `av` skrivs ingenting — se nedan. */
  till: string;
  /** Vem som gjorde saken. `null` for nattjobbet, som inte har nagon aktor. */
  av: string | null;
  kalla: Handelsekalla;
  typ: Notistyp;
  rubrik: string;
  detalj?: string;
  href: string;
  objekt?: { typ: string; id: string };
};

const KALLOR = new Set<string>(HANDELSEKALLOR);

/**
 * En handelse gar aldrig till den som utloste den.
 *
 * Det ar inte en artighet utan skillnaden mellan en klocka och ett eko. Chefen
 * som godkanner tolv order pa en eftermiddag ska inte mota tolv notiser om att
 * hon godkant tolv order — och den regeln maste ligga HAR och inte hos varje
 * anropare, for det ar tolv stallen att glomma den pa.
 *
 * Undantaget finns inte, och det ar med flit. Behover nagon en rad om sin egen
 * handling ar det en loggpost, inte en notis.
 */
export async function notifiera(handelse: Handelse): Promise<boolean> {
  try {
    if (!handelse.till) return false;
    if (handelse.av && handelse.av === handelse.till) return false;
    if (!KALLOR.has(handelse.kalla)) return false;

    // Sokvagen hamnar i ett `href`. Villkoret star ocksa i 0047 — det har ar
    // det som gor att skrivningen tyst uteblir i stallet for att fella.
    if (!handelse.href.startsWith("/") || /\s/.test(handelse.href)) return false;

    const { error } = await supabaseAdmin().from("notification_event").insert({
      employee_id: handelse.till,
      actor_id: handelse.av,
      kalla: handelse.kalla,
      typ: handelse.typ,
      rubrik: klipp(handelse.rubrik, 200),
      detalj: klipp(handelse.detalj ?? "", 300),
      href: handelse.href,
      object_type: handelse.objekt?.typ ?? null,
      object_id: handelse.objekt?.id ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Samma handelse till flera mottagare, i EN insert.
 *
 * En slinga med ett anrop per mottagare hade gett samma rader, och det ar inte
 * darfor funktionen finns: `godkannOrder` skickar till en krets pa fem, och fem
 * turer till databasen inuti en action som anvandaren star och vantar pa ar fem
 * turer for mycket. Dubbletter och aktoren sallas bort forst.
 */
export async function notifieraFlera(
  mottagare: readonly string[],
  handelse: Omit<Handelse, "till">,
): Promise<number> {
  try {
    if (!KALLOR.has(handelse.kalla)) return 0;
    if (!handelse.href.startsWith("/") || /\s/.test(handelse.href)) return 0;

    const unika = [...new Set(mottagare)].filter((id) => id && id !== handelse.av);
    if (unika.length === 0) return 0;

    const { error } = await supabaseAdmin()
      .from("notification_event")
      .insert(
        unika.map((till) => ({
          employee_id: till,
          actor_id: handelse.av,
          kalla: handelse.kalla,
          typ: handelse.typ,
          rubrik: klipp(handelse.rubrik, 200),
          detalj: klipp(handelse.detalj ?? "", 300),
          href: handelse.href,
          object_type: handelse.objekt?.typ ?? null,
          object_id: handelse.objekt?.id ?? null,
        })),
      );
    return error ? 0 : unika.length;
  } catch {
    return 0;
  }
}

/**
 * Klipper i STALLET for att lata databasen neka.
 *
 * Kolumnerna har check-villkor pa langden (0047), och en rubrik som rakar bli
 * 201 tecken hade fallt hela insertet — alltsa tystat notisen for att den var
 * for utforlig. Ellipsen ar arligare an tystnaden.
 */
function klipp(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/**
 * Sa lange sparas en handelserad. Klockan visar den i trettio (`HANDELSE_DAGAR`).
 *
 * De sextio dagarna daremellan ar for den som vill kunna backa och titta pa vad
 * som hande — raden bar rubriken som skrevs da, och den ar det enda stallet
 * texten finns. Loggen bar handelsen men inte formuleringen.
 */
const SPARAS_DAGAR = 90;

/**
 * Nattjobbets rensning.
 *
 * Tabellen ar den enda i navet som vaxer med ANVANDNINGEN och inte med
 * verksamheten: en makulerad order ger en rad, en attesterad loneperiod ger
 * trettio. Utan rensningen vaxer den utan tak, och en klocka som blir langsam
 * ar en klocka man slutar oppna.
 *
 * `db` skickas in av samma skal som `hamtaDrift()` gor det: jobbet har ingen
 * inloggad anvandare och kor med service role. Funktionen KASTAR vidare, till
 * skillnad fran resten av filen — nattjobbet fangar varje steg for sig och vill
 * se felet i sitt kvitto. Det ar tvartemot `notifiera()`, som anropas mitt i
 * nagon annans arbete och aldrig far avbryta det.
 */
export async function rensaGamlaNotiser(
  db: ReturnType<typeof supabaseAdmin>,
): Promise<{ raderade: number }> {
  const grans = new Date(Date.now() - SPARAS_DAGAR * 86_400_000).toISOString();
  const { data, error } = await db
    .from("notification_event")
    .delete()
    .lt("created_at", grans)
    .select("id");

  if (error) throw new Error(error.message);
  return { raderade: (data ?? []).length };
}

// =============================================================================
// VILKA SOM SKA VETA
//
// Uppslagningarna gar med SERVICE ROLE, och det ar inte samma sak som att lasa
// forbi behorigheten. De besvarar fragan "vem ar chef for X" — inte "vad far
// den inloggade se" — och svaret anvands bara till att valja mottagare. Med
// anvandarens egen token hade en saljare som skickar in en order inte kunnat
// se vilka som far godkanna den, och notisen hade uteblivit for att avsandaren
// saknade insyn i mottagaren. Det ar fel fraga att stalla.
//
// Ingen av dem kastar. Faller uppslagningen blir kretsen tom, och en notis som
// uteblir far aldrig bli en action som faller.
// =============================================================================

/** Aktiva anstallda. Offboardade far inga notiser — de kan inte logga in. */
const AKTIV = ["active", "onboarding"];

/**
 * Narmaste chef for en person: den som star som `manager_id` OCH den som leder
 * personens team. Samma tva vagar som `leads_employee()` i 0001, och det ar med
 * flit — en notis ska na exakt den krets som far se saken.
 */
export async function cheferFor(employeeId: string): Promise<string[]> {
  try {
    const db = supabaseAdmin();
    const { data: person } = await db
      .from("employee")
      .select("manager_id, team_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (!person) return [];

    const ut = new Set<string>();
    if (person.manager_id) ut.add(person.manager_id as string);

    if (person.team_id) {
      const { data: team } = await db
        .from("team")
        .select("lead_id")
        .eq("id", person.team_id)
        .maybeSingle();
      if (team?.lead_id) ut.add(team.lead_id as string);
    }

    ut.delete(employeeId);
    return [...ut];
  } catch {
    return [];
  }
}

/** Alla aktiva med nagon av rollerna. Kretsen bakom `has_any_role()` i SQL. */
export async function medRoll(...roller: Role[]): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin()
      .from("employee_role")
      .select("employee_id, employee!inner(status)")
      .in("role", roller)
      .in("employee.status", AKTIV);
    return [...new Set((data ?? []).map((r) => r.employee_id as string))];
  } catch {
    return [];
  }
}

/** Alla aktiva med behorigheten. Kretsen bakom `har_behorighet()` i SQL. */
export async function medBehorighet(behorighet: Permission): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin()
      .from("employee_permission")
      .select("employee_id, employee!inner(status)")
      .eq("permission", behorighet)
      .in("employee.status", AKTIV);
    return [...new Set((data ?? []).map((r) => r.employee_id as string))];
  } catch {
    return [];
  }
}

/**
 * Den som far hantera order: saljchef, VD och ekonomi.
 *
 * Kretsen ar SKRIVEN TVA GANGER — har och i `far_hantera_order()` i 0034 — och
 * det gar inte att undvika: SQL-funktionen svarar pa "ar JAG behorig", inte pa
 * "vilka ar det". Skillnaden ar bokford har sa att den som andrar den ena
 * hittar den andra. Teamledaren star utanfor (bestallarbeslut 2026-08-24).
 */
export async function orderkretsen(): Promise<string[]> {
  return medRoll("sales_manager", "ceo", "finance");
}

/** Den som far rekrytera: rollen `recruiter` finns inte — det ar en behorighet. */
export async function rekryteringskretsen(): Promise<string[]> {
  const [behoriga, ledning] = await Promise.all([
    medBehorighet("recruiter"),
    medRoll("sales_manager", "ceo"),
  ]);
  return [...new Set([...behoriga, ...ledning])];
}

/** Den som hanterar personalarenden. Samma krets som `hr_case_read` slapper in. */
export async function arendekretsen(): Promise<string[]> {
  return medRoll("sales_manager", "ceo");
}
